use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::app::archive::service::ArchiveService;
use crate::app::archive::tasks::ArchiveTasks;
use crate::app::args::{CheckoutArgs, CleanupArgs, CommitArgs, StatusMapArgs, UpdateArgs};
use crate::app::error::{CommandError, CommandErrorKind};
use crate::app::files::{FileService, Launcher, SystemLauncher};
use crate::app::operations::{
    OperationContext, OperationError, OperationId, OperationManager, Operations, ProgressSink,
    locked,
};
use crate::app::ui_state::{UiStateView, describe, normalize};
use crate::app::wc_status::{StatusCache, StatusQuery, WcStatusMap, WcStatusReader};
use crate::app::workspace::{ScopedPath, Workspace};
use crate::config::{AppConfig, ConfigStore, UiState};
use crate::svn::bundled::{BUNDLE_DIR, MANIFEST_JSON};
use crate::svn::client::SvnClient;
use crate::svn::commands::{
    CheckoutRequest, CommitRequest, InfoRequest, StatusRequest, UpdateRequest, is_safe_checkout_url,
};
use crate::svn::locator::{
    Bundle, Located, LocatorError, RECOMMENDED_VERSION, SVN_EXE, SvnBinary, SvnOrigin, SvnVersion,
    default_search_dirs, locate, locate_full,
};
use crate::svn::models::{InfoEntry, StatusReport};
use crate::svn::runner::{Password, RunOptions, SvnRunner};

const MESSAGE_PASSWORD_WITHOUT_USER: &str = "Indica el usuario junto con la contraseña.";
const MESSAGE_CONFIG_UNREADABLE: &str =
    "la configuración existente no se pudo leer; no se sobrescribe para no perderla";
const MESSAGE_WORKSPACE_CHANGED: &str =
    "la carpeta raíz cambió mientras se guardaba el estado de la interfaz";

pub type DoneSink = Arc<dyn Fn(OperationId, OperationResult) + Send + Sync>;

#[derive(Clone)]
pub struct Sinks {
    pub progress: ProgressSink,
    pub done: DoneSink,
}

struct Launch {
    sinks: Sinks,
    password: Option<Password>,
    stale: StaleStatus,
}

struct StaleStatus {
    cache: Arc<StatusCache>,
    target: PathBuf,
}

impl StaleStatus {
    fn invalidate(&self) {
        self.cache.invalidate(&self.target);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OperationResult {
    Ok { revision: Option<u64> },
    Err(CommandError),
}

impl From<Result<Option<u64>, OperationError>> for OperationResult {
    fn from(result: Result<Option<u64>, OperationError>) -> Self {
        match result {
            Ok(revision) => Self::Ok { revision },
            Err(error) => Self::Err(error.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SvnBinaryInfo {
    pub path: String,
    pub version: String,
    pub origin: SvnOrigin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SvnDetection {
    pub binary: Option<SvnBinaryInfo>,
    pub error: Option<String>,
    pub warning: Option<String>,
}

impl From<Result<Located, LocatorError>> for SvnDetection {
    fn from(result: Result<Located, LocatorError>) -> Self {
        match result {
            Ok(located) => {
                let mut detection = Self::found(&located.binary);
                detection.warning = joined(bundle_warning(&located), detection.warning);
                detection
            }
            Err(error) => Self::failed(error),
        }
    }
}

impl SvnDetection {
    fn found(binary: &SvnBinary) -> Self {
        Self {
            binary: Some(SvnBinaryInfo {
                path: binary.path.to_string_lossy().into_owned(),
                version: binary.version.to_string(),
                origin: binary.origin,
            }),
            error: None,
            warning: outdated_warning(binary.version),
        }
    }

    fn failed(error: LocatorError) -> Self {
        Self {
            binary: None,
            error: Some(error.to_string()),
            warning: None,
        }
    }
}

fn outdated_warning(version: SvnVersion) -> Option<String> {
    (version < RECOMMENDED_VERSION).then(|| {
        format!(
            "svn {version} es anterior a {RECOMMENDED_VERSION}: tiene una vulnerabilidad conocida de inyección de argumentos en Windows (CVE-2024-45720). Se puede usar, pero conviene actualizarlo o usar el svn incluido con la aplicación."
        )
    })
}

fn joined(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(first), Some(second)) => Some(format!("{first} {second}")),
        (first, second) => first.or(second),
    }
}

fn bundle_warning(located: &Located) -> Option<String> {
    located.skipped_bundle.as_ref().map(|problem| {
        format!(
            "El svn incluido con la aplicación se ignoró porque {problem}; se usa otro svn.exe."
        )
    })
}

#[derive(Clone)]
struct ConfigHandle {
    store: ConfigStore,
    is_readable: bool,
    current: Arc<Mutex<AppConfig>>,
}

impl ConfigHandle {
    fn new(store: ConfigStore) -> Self {
        let loaded = store.load();
        Self {
            store,
            is_readable: loaded.is_ok(),
            current: Arc::new(Mutex::new(loaded.unwrap_or_default())),
        }
    }

    fn read<T>(&self, pick: impl FnOnce(&AppConfig) -> T) -> T {
        pick(&locked(&self.current))
    }

    fn update(&self, change: impl FnOnce(&mut AppConfig)) -> io::Result<()> {
        if !self.is_readable {
            return Err(io::Error::other(MESSAGE_CONFIG_UNREADABLE));
        }
        let mut config = locked(&self.current);
        let mut updated = config.clone();
        change(&mut updated);
        self.store.save(&updated)?;
        *config = updated;
        Ok(())
    }
}

struct UiCommit {
    config: ConfigHandle,
    workspace: Arc<Mutex<Option<Workspace>>>,
    expected: Workspace,
}

impl UiCommit {
    fn persist(self, ui: UiState) -> Result<(), CommandError> {
        let slot = locked(&self.workspace);
        let current = slot.as_ref().map(Workspace::root);
        if current != Some(self.expected.root()) {
            return Err(CommandError::new(
                CommandErrorKind::Io,
                MESSAGE_WORKSPACE_CHANGED,
            ));
        }
        Ok(self.config.update(|config| config.ui = ui)?)
    }
}

pub struct AppState {
    config: ConfigHandle,
    workspace: Arc<Mutex<Option<Workspace>>>,
    svn: Arc<Mutex<Option<SvnBinary>>>,
    bundle_dir: Option<PathBuf>,
    manager: Arc<OperationManager>,
    statuses: Arc<StatusCache>,
    archives: Arc<ArchiveTasks>,
    launcher: Arc<dyn Launcher>,
}

impl AppState {
    pub fn new(store: ConfigStore) -> Self {
        let config = ConfigHandle::new(store);
        let workspace = config
            .read(|config| config.workspace_root.clone())
            .and_then(|root| Workspace::new(&root).ok());
        Self {
            config,
            workspace: Arc::new(Mutex::new(workspace)),
            svn: Arc::default(),
            bundle_dir: None,
            manager: Arc::default(),
            statuses: Arc::default(),
            archives: Arc::default(),
            launcher: Arc::new(SystemLauncher),
        }
    }

    pub fn with_bundled_svn(self, resource_dir: &Path) -> Self {
        Self {
            bundle_dir: Some(resource_dir.join(BUNDLE_DIR)),
            ..self
        }
    }

    pub fn with_launcher(self, launcher: Arc<dyn Launcher>) -> Self {
        Self { launcher, ..self }
    }

    pub fn launcher(&self) -> Arc<dyn Launcher> {
        self.launcher.clone()
    }

    pub fn workspace_get(&self) -> Option<PathBuf> {
        let workspace = locked(&self.workspace);
        workspace
            .as_ref()
            .map(|workspace| workspace.root().as_path().to_path_buf())
    }

    pub fn workspace_set(&self, path: &Path) -> Result<PathBuf, CommandError> {
        let workspace = Workspace::new(path)?;
        let root = workspace.root().as_path().to_path_buf();
        let mut slot = locked(&self.workspace);
        self.config
            .update(|config| config.workspace_root = Some(root.clone()))?;
        *slot = Some(workspace);
        Ok(root)
    }

    pub fn svn_detect(&self) -> SvnDetection {
        self.detect().into()
    }

    pub fn svn_set_path(&self, path: &Path) -> SvnDetection {
        if !is_svn_executable(path) {
            return SvnDetection::failed(LocatorError::Invalid(path.to_path_buf()));
        }
        match locate(Some(path)) {
            Ok(binary) => self.adopt_svn(binary, path),
            Err(error) => SvnDetection::failed(error),
        }
    }

    pub async fn wc_info(&self, path: &str) -> Result<InfoEntry, CommandError> {
        let (ops, target) = self.scoped(path, true)?;
        let req = InfoRequest {
            target: target.as_path().to_path_buf(),
        };
        Ok(ops.client().info(&req, RunOptions::default()).await?)
    }

    pub async fn wc_status(&self, path: &str, remote: bool) -> Result<StatusReport, CommandError> {
        let (ops, target) = self.scoped(path, true)?;
        let req = StatusRequest {
            target: target.as_path().to_path_buf(),
            remote,
            ignored: false,
            username: None,
        };
        Ok(ops.client().status(&req, RunOptions::default()).await?)
    }

    pub async fn wc_status_map(&self, args: StatusMapArgs) -> Result<WcStatusMap, CommandError> {
        require_username_with_password(&args.username, &args.password)?;
        let workspace = self.workspace()?;
        let wc = workspace.resolve(Path::new(&args.wc_root), true)?;
        let reader = WcStatusReader::new(workspace, self.svn_client()?, self.statuses.clone());
        let query = StatusQuery {
            wc,
            remote: args.remote,
            refresh: args.refresh,
            username: args.username,
            password: args.password.map(Password::from),
        };
        Ok(reader.read(query).await?)
    }

    pub async fn ui_state_get(&self) -> Result<UiStateView, CommandError> {
        let state = self.config.read(|config| config.ui.clone());
        let workspace = locked(&self.workspace).clone();
        blocking(move || describe(state, workspace.as_ref())).await
    }

    pub async fn ui_state_set(&self, state: UiState) -> Result<UiStateView, CommandError> {
        let workspace = self.workspace()?;
        let checked = workspace.clone();
        let normalized = blocking(move || normalize(state, &checked)).await??;
        let (commit, saved) = (self.ui_commit(&workspace), normalized.clone());
        blocking(move || commit.persist(saved)).await??;
        blocking(move || describe(normalized, Some(&workspace))).await
    }

    pub fn file_service(&self) -> Result<FileService, CommandError> {
        let service = FileService::new(self.workspace()?, self.manager.clone());
        Ok(service.with_statuses(self.statuses.clone()))
    }

    pub fn archive_service(&self) -> Result<ArchiveService, CommandError> {
        let service = ArchiveService::new(self.workspace()?, self.manager.clone());
        Ok(service.with_statuses(self.statuses.clone()))
    }

    pub fn archive_tasks(&self) -> Arc<ArchiveTasks> {
        self.archives.clone()
    }

    pub fn start_checkout(
        &self,
        args: CheckoutArgs,
        sinks: Sinks,
    ) -> Result<OperationId, CommandError> {
        if !is_safe_checkout_url(&args.url) {
            return Err(OperationError::InvalidUrl.into());
        }
        require_username_with_password(&args.username, &args.password)?;
        let (ops, dest) = self.scoped(&args.dest, false)?;
        let req = CheckoutRequest {
            url: args.url,
            dest: dest.as_path().to_path_buf(),
            revision: args.revision,
            depth: args.depth,
            ignore_externals: args.ignore_externals,
            username: args.username,
        };
        let launch = launch(sinks, args.password, self.stale(&dest));
        Ok(spawn_operation(ops, launch, move |ops, ctx| async move {
            ops.checkout(&dest, req, &ctx).await
        }))
    }

    pub fn start_update(
        &self,
        args: UpdateArgs,
        sinks: Sinks,
    ) -> Result<OperationId, CommandError> {
        require_username_with_password(&args.username, &args.password)?;
        let (ops, target) = self.scoped(&args.path, true)?;
        let req = UpdateRequest {
            target: target.as_path().to_path_buf(),
            revision: args.revision,
            ignore_externals: args.ignore_externals,
            username: args.username,
        };
        let launch = launch(sinks, args.password, self.stale(&target));
        Ok(spawn_operation(ops, launch, move |ops, ctx| async move {
            ops.update(&target, req, &ctx).await
        }))
    }

    pub fn start_commit(
        &self,
        args: CommitArgs,
        sinks: Sinks,
    ) -> Result<OperationId, CommandError> {
        require_username_with_password(&args.username, &args.password)?;
        let (ops, target) = self.scoped(&args.path, true)?;
        let req = CommitRequest {
            target: target.as_path().to_path_buf(),
            message: args.message,
            username: args.username,
        };
        let launch = launch(sinks, args.password, self.stale(&target));
        Ok(spawn_operation(ops, launch, move |ops, ctx| async move {
            let outcome = ops.commit(&target, req, &ctx).await?;
            Ok(outcome.revision)
        }))
    }

    pub fn start_cleanup(
        &self,
        args: CleanupArgs,
        sinks: Sinks,
    ) -> Result<OperationId, CommandError> {
        let (ops, target) = self.scoped(&args.path, true)?;
        let launch = launch(sinks, None, self.stale(&target));
        Ok(spawn_operation(ops, launch, move |ops, ctx| async move {
            ops.cleanup(&target, &ctx).await.map(|()| None)
        }))
    }

    pub fn wc_needs_cleanup(&self, path: &str) -> Result<bool, CommandError> {
        let target = self.workspace()?.resolve(Path::new(path), true)?;
        Ok(self.manager.needs_cleanup(target.as_path()))
    }

    pub fn op_cancel(&self, id: OperationId) -> bool {
        self.manager.cancel(id)
    }

    fn ui_commit(&self, expected: &Workspace) -> UiCommit {
        UiCommit {
            config: self.config.clone(),
            workspace: self.workspace.clone(),
            expected: expected.clone(),
        }
    }

    pub async fn warm_svn(&self) {
        if locked(&self.svn).is_some() {
            return;
        }
        let (config, slot, bundle) = (
            self.config.clone(),
            self.svn.clone(),
            self.bundle_dir.clone(),
        );
        blocking(move || detect_svn(&config, &slot, bundle.as_deref()))
            .await
            .ok();
    }

    fn detect(&self) -> Result<Located, LocatorError> {
        detect_svn(&self.config, &self.svn, self.bundle_dir.as_deref())
    }

    fn adopt_svn(&self, binary: SvnBinary, path: &Path) -> SvnDetection {
        let saved = self
            .config
            .update(|config| config.svn_path = Some(path.to_path_buf()));
        let mut detection = SvnDetection::found(&binary);
        *locked(&self.svn) = Some(binary);
        detection.error = saved
            .err()
            .map(|error| format!("no se pudo guardar la configuración: {error}"));
        detection
    }

    fn svn_binary(&self) -> Result<SvnBinary, CommandError> {
        let cached = locked(&self.svn).clone();
        cached.map_or_else(|| Ok(self.detect()?.binary), Ok)
    }

    fn workspace(&self) -> Result<Workspace, CommandError> {
        let workspace = locked(&self.workspace).clone();
        workspace.ok_or_else(CommandError::no_workspace)
    }

    fn scoped(
        &self,
        path: &str,
        allow_overwrite: bool,
    ) -> Result<(Operations, ScopedPath), CommandError> {
        let workspace = self.workspace()?;
        let scoped = workspace.resolve(Path::new(path), allow_overwrite)?;
        let ops = Operations::new(workspace, self.svn_client()?, self.manager.clone());
        Ok((ops, scoped))
    }

    fn svn_client(&self) -> Result<SvnClient, CommandError> {
        Ok(SvnClient::new(SvnRunner::new(self.svn_binary()?.path)))
    }

    fn stale(&self, target: &ScopedPath) -> StaleStatus {
        StaleStatus {
            cache: self.statuses.clone(),
            target: target.as_path().to_path_buf(),
        }
    }
}

fn detect_svn(
    config: &ConfigHandle,
    slot: &Mutex<Option<SvnBinary>>,
    bundle_dir: Option<&Path>,
) -> Result<Located, LocatorError> {
    let bundle = bundle_dir.map(|dir| Bundle {
        dir,
        manifest: MANIFEST_JSON,
    });
    detect_svn_in(config, slot, bundle, &default_search_dirs())
}

fn detect_svn_in(
    config: &ConfigHandle,
    slot: &Mutex<Option<SvnBinary>>,
    bundle: Option<Bundle<'_>>,
    dirs: &[PathBuf],
) -> Result<Located, LocatorError> {
    let manual = config.read(|config| config.svn_path.clone());
    let located = match manual.as_deref() {
        Some(path) => locate_full(Some(path), bundle, dirs)
            .or_else(|error| locate_full(None, bundle, dirs).map_err(|_| error)),
        None => locate_full(None, bundle, dirs),
    };
    *locked(slot) = located.as_ref().ok().map(|found| found.binary.clone());
    located
}

pub(crate) async fn blocking<T, F>(job: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|error| CommandError::new(CommandErrorKind::Io, error.to_string()))
}

fn launch(sinks: Sinks, password: Option<String>, stale: StaleStatus) -> Launch {
    Launch {
        sinks,
        password: password.map(Password::from),
        stale,
    }
}

fn is_svn_executable(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case(SVN_EXE))
}

fn require_username_with_password(
    username: &Option<String>,
    password: &Option<String>,
) -> Result<(), CommandError> {
    if password.is_some() && username.is_none() {
        return Err(CommandError::new(
            CommandErrorKind::InvalidPath,
            MESSAGE_PASSWORD_WITHOUT_USER,
        ));
    }
    Ok(())
}

fn spawn_operation<F, Fut>(ops: Operations, launch: Launch, run: F) -> OperationId
where
    F: FnOnce(Operations, OperationContext) -> Fut + Send + 'static,
    Fut: Future<Output = Result<Option<u64>, OperationError>> + Send + 'static,
{
    let (id, _) = ops.manager().begin();
    let ctx = OperationContext {
        id,
        progress: Some(launch.sinks.progress),
        password: launch.password,
    };
    let (done, stale) = (launch.sinks.done, launch.stale);
    let manager = ops.manager().clone();
    tokio::spawn(async move {
        let result = run(ops, ctx).await;
        manager.finish(id);
        stale.invalidate();
        done(id, result.into());
    });
    id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::CONFIG_FILE_NAME;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::process::Command;
    use tempfile::TempDir;

    const MISSING: &str = "C:/no/existe/svn.exe";
    const OLD: SvnVersion = SvnVersion {
        major: 1,
        minor: 14,
        patch: 2,
    };

    fn compiled_fake_svn(version: &str) -> Vec<u8> {
        let scratch = TempDir::new().unwrap();
        let source = scratch.path().join("fake.rs");
        std::fs::write(&source, format!("fn main() {{ println!({version:?}); }}")).unwrap();
        let exe = scratch.path().join("fake.exe");
        let built = Command::new("rustc")
            .arg(&source)
            .arg("-o")
            .arg(&exe)
            .status();
        assert!(built.unwrap().success());
        std::fs::read(exe).unwrap()
    }

    fn bundle_of(bytes: &[u8]) -> (TempDir, String) {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join(SVN_EXE), bytes).unwrap();
        let entry = json!({
            "name": SVN_EXE,
            "bytes": bytes.len(),
            "sha256": format!("{:x}", Sha256::digest(bytes)),
        });
        (dir, json!({ "files": [entry] }).to_string())
    }

    fn config_saving(path: Option<&str>) -> (TempDir, ConfigHandle) {
        let dir = TempDir::new().unwrap();
        let store = ConfigStore {
            path: dir.path().join("cfg").join(CONFIG_FILE_NAME),
        };
        let config = ConfigHandle::new(store);
        if let Some(path) = path {
            config
                .update(|c| c.svn_path = Some(PathBuf::from(path)))
                .unwrap();
        }
        (dir, config)
    }

    #[test]
    fn a_broken_saved_client_falls_back_to_the_verified_bundled_svn() {
        let (_cfg, config) = config_saving(Some(MISSING));
        let (dir, manifest) = bundle_of(&compiled_fake_svn("1.14.5"));
        let bundle = Bundle {
            dir: dir.path(),
            manifest: &manifest,
        };
        let found = detect_svn_in(&config, &Mutex::default(), Some(bundle), &[]).unwrap();
        assert_eq!(found.binary.origin, SvnOrigin::Bundled);
    }

    #[test]
    fn a_broken_saved_client_with_nothing_else_reports_the_saved_clients_error() {
        let (_cfg, config) = config_saving(Some(MISSING));
        let outcome = detect_svn_in(&config, &Mutex::default(), None, &[]);
        assert_eq!(outcome, Err(LocatorError::Invalid(PathBuf::from(MISSING))));
    }

    #[test]
    fn a_cached_svn_is_not_detected_again_by_warm_svn() {
        let (_cfg, config) = config_saving(None);
        let state = AppState::new(config.store.clone());
        let cached = SvnBinary {
            path: PathBuf::from("C:/cache/svn.exe"),
            version: SvnVersion {
                major: 1,
                minor: 14,
                patch: 5,
            },
            origin: SvnOrigin::Configured,
        };
        *locked(&state.svn) = Some(cached.clone());
        tauri::async_runtime::block_on(state.warm_svn());
        assert_eq!(locked(&state.svn).clone(), Some(cached));
    }

    #[test]
    fn the_bundle_lives_in_the_svn_subfolder_of_the_resource_directory() {
        let (_cfg, config) = config_saving(None);
        let state = AppState::new(config.store).with_bundled_svn(Path::new("C:/recursos"));
        assert_eq!(
            state.bundle_dir,
            Some(PathBuf::from("C:/recursos").join(BUNDLE_DIR))
        );
    }

    #[test]
    fn the_cve_warning_is_not_lost_when_the_bundle_was_ignored() {
        let old = SvnBinary {
            path: PathBuf::from("C:/svn/svn.exe"),
            version: OLD,
            origin: SvnOrigin::System,
        };
        let located = Located {
            binary: old,
            skipped_bundle: Some(crate::svn::bundled::BundleProblem::Unusable),
        };
        let warning = SvnDetection::from(Ok(located)).warning.unwrap();
        assert!(warning.contains("se ignoró") && warning.contains("CVE-2024-45720"));
    }
}

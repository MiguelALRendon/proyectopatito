use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::app::args::{CheckoutArgs, CleanupArgs, CommitArgs, UpdateArgs};
use crate::app::error::{CommandError, CommandErrorKind};
use crate::app::operations::{
    OperationContext, OperationError, OperationId, OperationManager, Operations, ProgressSink,
    locked,
};
use crate::app::svn_locator::{LocatorError, SVN_EXE, SvnBinary, locate};
use crate::app::workspace::{ScopedPath, Workspace};
use crate::config::{AppConfig, ConfigStore};
use crate::svn::client::SvnClient;
use crate::svn::commands::{
    CheckoutRequest, CommitRequest, InfoRequest, StatusRequest, UpdateRequest, is_safe_checkout_url,
};
use crate::svn::models::{InfoEntry, StatusReport};
use crate::svn::runner::{Password, RunOptions, SvnRunner};

const MESSAGE_PASSWORD_WITHOUT_USER: &str = "Indica el usuario junto con la contraseña.";
const MESSAGE_CONFIG_UNREADABLE: &str =
    "la configuración existente no se pudo leer; no se sobrescribe para no perderla";

pub type DoneSink = Arc<dyn Fn(OperationId, OperationResult) + Send + Sync>;

#[derive(Clone)]
pub struct Sinks {
    pub progress: ProgressSink,
    pub done: DoneSink,
}

struct Launch {
    sinks: Sinks,
    password: Option<Password>,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SvnDetection {
    pub binary: Option<SvnBinaryInfo>,
    pub error: Option<String>,
}

impl From<Result<SvnBinary, LocatorError>> for SvnDetection {
    fn from(result: Result<SvnBinary, LocatorError>) -> Self {
        match result {
            Ok(binary) => Self::found(&binary),
            Err(error) => Self {
                binary: None,
                error: Some(error.to_string()),
            },
        }
    }
}

impl SvnDetection {
    fn found(binary: &SvnBinary) -> Self {
        Self {
            binary: Some(SvnBinaryInfo {
                path: binary.path.to_string_lossy().into_owned(),
                version: binary.version.to_string(),
            }),
            error: None,
        }
    }
}

pub struct AppState {
    store: ConfigStore,
    config_readable: bool,
    config: Mutex<AppConfig>,
    workspace: Mutex<Option<Workspace>>,
    svn: Mutex<Option<SvnBinary>>,
    manager: Arc<OperationManager>,
}

impl AppState {
    pub fn new(store: ConfigStore) -> Self {
        let loaded = store.load();
        let config_readable = loaded.is_ok();
        let config = loaded.unwrap_or_default();
        let workspace = config
            .workspace_root
            .as_deref()
            .and_then(|root| Workspace::new(root).ok());
        Self {
            store,
            config_readable,
            config: Mutex::new(config),
            workspace: Mutex::new(workspace),
            svn: Mutex::new(None),
            manager: Arc::default(),
        }
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
        self.update_config(|config| config.workspace_root = Some(root.clone()))?;
        *locked(&self.workspace) = Some(workspace);
        Ok(root)
    }

    pub fn svn_detect(&self) -> SvnDetection {
        self.detect().into()
    }

    pub fn svn_set_path(&self, path: &Path) -> SvnDetection {
        if !is_svn_executable(path) {
            return SvnDetection::from(Err(LocatorError::Invalid(path.to_path_buf())));
        }
        match locate(Some(path)) {
            Ok(binary) => self.adopt_svn(binary, path),
            Err(error) => SvnDetection::from(Err(error)),
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
        };
        Ok(ops.client().status(&req, RunOptions::default()).await?)
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
        let launch = launch(sinks, args.password);
        Ok(spawn_operation(ops, launch, move |ops, ctx| async move {
            ops.checkout(&dest, req, &ctx).await.map(Some)
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
        let launch = launch(sinks, args.password);
        Ok(spawn_operation(ops, launch, move |ops, ctx| async move {
            ops.update(&target, req, &ctx).await.map(Some)
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
        let launch = launch(sinks, args.password);
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
        let launch = launch(sinks, None);
        Ok(spawn_operation(ops, launch, move |ops, ctx| async move {
            ops.cleanup(&target, &ctx).await.map(|()| None)
        }))
    }

    pub fn op_cancel(&self, id: OperationId) -> bool {
        self.manager.cancel(id)
    }

    fn update_config(&self, change: impl FnOnce(&mut AppConfig)) -> io::Result<()> {
        if !self.config_readable {
            return Err(io::Error::other(MESSAGE_CONFIG_UNREADABLE));
        }
        let mut config = locked(&self.config);
        let mut updated = config.clone();
        change(&mut updated);
        self.store.save(&updated)?;
        *config = updated;
        Ok(())
    }

    fn detect(&self) -> Result<SvnBinary, LocatorError> {
        let manual = locked(&self.config).svn_path.clone();
        let located = locate(manual.as_deref());
        *locked(&self.svn) = located.as_ref().ok().cloned();
        located
    }

    fn adopt_svn(&self, binary: SvnBinary, path: &Path) -> SvnDetection {
        let saved = self.update_config(|config| config.svn_path = Some(path.to_path_buf()));
        let mut detection = SvnDetection::found(&binary);
        *locked(&self.svn) = Some(binary);
        detection.error = saved
            .err()
            .map(|error| format!("no se pudo guardar la configuración: {error}"));
        detection
    }

    fn svn_binary(&self) -> Result<SvnBinary, CommandError> {
        let cached = locked(&self.svn).clone();
        cached.map_or_else(|| Ok(self.detect()?), Ok)
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
        let binary = self.svn_binary()?;
        let client = SvnClient::new(SvnRunner::new(binary.path));
        let ops = Operations::new(workspace, client, self.manager.clone());
        Ok((ops, scoped))
    }
}

fn launch(sinks: Sinks, password: Option<String>) -> Launch {
    Launch {
        sinks,
        password: password.map(Password::from),
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
    let done = launch.sinks.done;
    let manager = ops.manager().clone();
    tokio::spawn(async move {
        let result = run(ops, ctx).await;
        manager.finish(id);
        done(id, result.into());
    });
    id
}

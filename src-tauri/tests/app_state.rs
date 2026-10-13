#![cfg(windows)]

mod common;

use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use common::TestRepo;
use dakedaduck_svn_lib::app::args::{CheckoutArgs, CleanupArgs, CommitArgs, UpdateArgs};
use dakedaduck_svn_lib::app::error::{CommandError, CommandErrorKind};
use dakedaduck_svn_lib::app::operations::{OperationError, OperationId};
use dakedaduck_svn_lib::app::state::{AppState, OperationResult, Sinks};
use dakedaduck_svn_lib::app::svn_locator::{LocatorError, SvnVersion};
use dakedaduck_svn_lib::app::workspace::WorkspaceError;
use dakedaduck_svn_lib::config::{AppConfig, CONFIG_FILE_NAME, ConfigStore};
use dakedaduck_svn_lib::svn::commands::Depth;
use dakedaduck_svn_lib::svn::error::{Captured, SvnError, SvnErrorKind};
use dakedaduck_svn_lib::svn::runner::Password;
use tempfile::TempDir;
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

const DONE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_DETAIL_CHARS: usize = 2000;

struct Sandbox {
    _dir: TempDir,
    root: PathBuf,
    store: ConfigStore,
}

fn sandbox() -> Sandbox {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("raiz");
    fs::create_dir(&root).unwrap();
    let store = ConfigStore {
        path: dir.path().join("cfg").join(CONFIG_FILE_NAME),
    };
    Sandbox {
        _dir: dir,
        root,
        store,
    }
}

fn state_with_workspace(sandbox: &Sandbox) -> AppState {
    let state = AppState::new(sandbox.store.clone());
    state.workspace_set(&sandbox.root).unwrap();
    state
}

fn sinks() -> (Sinks, UnboundedReceiver<(OperationId, OperationResult)>) {
    let (sender, receiver) = unbounded_channel();
    let sinks = Sinks {
        progress: Arc::new(|_, _| {}),
        done: Arc::new(move |id, result| {
            sender.send((id, result)).ok();
        }),
    };
    (sinks, receiver)
}

async fn finished(
    receiver: &mut UnboundedReceiver<(OperationId, OperationResult)>,
) -> OperationResult {
    tokio::time::timeout(DONE_TIMEOUT, receiver.recv())
        .await
        .expect("la operacion no termino")
        .expect("el canal se cerro")
        .1
}

fn checkout_args(repo: &TestRepo, dest: &str) -> CheckoutArgs {
    CheckoutArgs {
        url: repo.url.clone(),
        dest: dest.into(),
        revision: None,
        depth: Depth::Infinity,
        ignore_externals: false,
        username: None,
        password: None,
    }
}

fn kind_of(result: Result<impl std::fmt::Debug, CommandError>) -> CommandErrorKind {
    result.unwrap_err().kind
}

fn svn_error_with(stderr: &str) -> SvnError {
    let captured = Captured {
        stderr: stderr.into(),
        exit_code: Some(1),
        ..Captured::default()
    };
    SvnError::from_process(&[OsString::from("update")], captured)
}

#[test]
fn config_load_returns_default_when_the_file_is_missing() {
    let sandbox = sandbox();
    assert_eq!(sandbox.store.load().unwrap(), AppConfig::default());
}

#[test]
fn config_load_quarantines_corrupt_json_instead_of_losing_it() {
    let sandbox = sandbox();
    fs::create_dir_all(sandbox.store.path.parent().unwrap()).unwrap();
    fs::write(&sandbox.store.path, "{ no es json").unwrap();
    assert_eq!(sandbox.store.load().unwrap(), AppConfig::default());
    let quarantined = sandbox.store.path.with_extension("json.bad");
    assert_eq!(fs::read_to_string(quarantined).unwrap(), "{ no es json");
    assert!(!sandbox.store.path.exists());
}

#[test]
fn config_load_tolerates_missing_and_unknown_fields() {
    let sandbox = sandbox();
    fs::create_dir_all(sandbox.store.path.parent().unwrap()).unwrap();
    fs::write(
        &sandbox.store.path,
        r#"{"campo_futuro": 1, "svn_path": "C:\\x\\svn.exe"}"#,
    )
    .unwrap();
    let config = sandbox.store.load().unwrap();
    assert_eq!(config.svn_path, Some(PathBuf::from(r"C:\x\svn.exe")));
    assert_eq!(config.workspace_root, None);
}

#[test]
fn config_file_never_contains_credentials_keys() {
    let sandbox = sandbox();
    let config = AppConfig {
        workspace_root: Some(sandbox.root.clone()),
        svn_path: Some(PathBuf::from(r"C:\svn.exe")),
    };
    sandbox.store.save(&config).unwrap();
    let text = fs::read_to_string(&sandbox.store.path)
        .unwrap()
        .to_lowercase();
    for secret in ["password", "contrasena", "token", "secret"] {
        assert!(!text.contains(secret), "{secret}");
    }
}

#[test]
fn config_save_creates_parent_directories_and_round_trips_without_leftovers() {
    let sandbox = sandbox();
    let config = AppConfig {
        workspace_root: Some(sandbox.root.clone()),
        svn_path: None,
    };
    sandbox.store.save(&config).unwrap();
    assert_eq!(sandbox.store.load().unwrap(), config);
    assert!(!sandbox.store.path.with_extension("json.tmp").exists());
}

#[test]
fn every_svn_error_kind_maps_to_its_command_error_kind() {
    let expected = [
        ("svn: E170001: x", CommandErrorKind::AuthRequired),
        ("svn: E230001: x", CommandErrorKind::UntrustedCertificate),
        ("svn: E155036: x", CommandErrorKind::WorkingCopyTooOld),
        ("svn: E155004: x", CommandErrorKind::WorkingCopyLocked),
        ("svn: E999999: x", CommandErrorKind::SvnFailed),
    ];
    for (stderr, kind) in expected {
        assert_eq!(
            CommandError::from(svn_error_with(stderr)).kind,
            kind,
            "{stderr}"
        );
    }
}

#[test]
fn interrupted_svn_errors_map_to_cancelled_and_timed_out() {
    let cancelled = SvnError::interrupted(SvnErrorKind::Cancelled, &[], Captured::default());
    let timed_out = SvnError::interrupted(SvnErrorKind::TimedOut, &[], Captured::default());
    assert_eq!(
        CommandError::from(cancelled).kind,
        CommandErrorKind::Cancelled
    );
    assert_eq!(
        CommandError::from(timed_out).kind,
        CommandErrorKind::TimedOut
    );
}

#[test]
fn untrusted_certificate_and_old_working_copy_messages_guide_the_user() {
    let tls = CommandError::from(svn_error_with("svn: E230001: x")).message;
    let old = CommandError::from(svn_error_with("svn: E155036: x")).message;
    let locked = CommandError::from(svn_error_with("svn: E155004: x")).message;
    assert!(tls.contains("otro cliente"));
    assert!(old.contains("svn upgrade"));
    assert!(locked.contains("cleanup"));
}

#[test]
fn command_error_keeps_codes_and_trims_long_stderr_detail() {
    let long = format!("svn: E170001: {}", "x".repeat(MAX_DETAIL_CHARS * 2));
    let error = CommandError::from(svn_error_with(&long));
    assert_eq!(error.codes, vec!["E170001".to_string()]);
    assert_eq!(error.detail.unwrap().chars().count(), MAX_DETAIL_CHARS);
}

#[test]
fn command_error_has_no_detail_for_blank_stderr() {
    let interrupted = SvnError::interrupted(SvnErrorKind::Cancelled, &[], Captured::default());
    assert_eq!(CommandError::from(interrupted).detail, None);
}

#[test]
fn redacted_command_and_password_debug_never_expose_the_secret() {
    let args = [
        OsString::from("--password"),
        OsString::from("s3cret"),
        OsString::from("--password=otro"),
    ];
    let error = SvnError::from_process(&args, Captured::default());
    assert!(error.command.contains("***"));
    assert!(!error.command.contains("s3cret"));
    assert!(!error.command.contains("otro"));
    assert_eq!(format!("{:?}", Password::from("s3cret")), "Password(***)");
}

#[test]
fn workspace_and_locator_errors_map_to_specific_kinds() {
    let cases = [
        (
            WorkspaceError::OutsideWorkspace,
            CommandErrorKind::OutsideWorkspace,
        ),
        (
            WorkspaceError::DestinationExists,
            CommandErrorKind::DestinationExists,
        ),
        (
            WorkspaceError::ParentTraversal,
            CommandErrorKind::InvalidPath,
        ),
        (
            WorkspaceError::DeviceOrReservedPath,
            CommandErrorKind::InvalidPath,
        ),
        (WorkspaceError::RootInvalid, CommandErrorKind::InvalidPath),
    ];
    for (error, kind) in cases {
        assert_eq!(CommandError::from(error).kind, kind);
    }
    let too_old = LocatorError::TooOld {
        path: PathBuf::from("svn.exe"),
        found: SvnVersion {
            major: 1,
            minor: 9,
            patch: 0,
        },
        required: SvnVersion {
            major: 1,
            minor: 10,
            patch: 0,
        },
    };
    assert_eq!(CommandError::from(too_old).kind, CommandErrorKind::NoSvn);
    assert_eq!(
        CommandError::from(LocatorError::NotFound).kind,
        CommandErrorKind::NoSvn
    );
}

#[test]
fn invalid_url_operation_error_maps_to_invalid_path() {
    let error = CommandError::from(OperationError::InvalidUrl);
    assert_eq!(error.kind, CommandErrorKind::InvalidPath);
    assert!(error.message.contains("URL"));
}

#[test]
fn state_without_workspace_has_none_and_rejects_working_copy_paths() {
    let sandbox = sandbox();
    let state = AppState::new(sandbox.store.clone());
    assert_eq!(state.workspace_get(), None);
    let result = tokio_test_block(state.wc_info("cualquiera"));
    assert_eq!(kind_of(result), CommandErrorKind::NoWorkspace);
}

#[test]
fn workspace_set_rejects_a_missing_directory_and_keeps_the_previous_one() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let missing = sandbox.root.join("no-existe");
    assert_eq!(
        kind_of(state.workspace_set(&missing)),
        CommandErrorKind::InvalidPath
    );
    assert_eq!(state.workspace_get().map(|p| p.exists()), Some(true));
}

#[test]
fn workspace_survives_a_restart_and_is_dropped_if_the_folder_disappears() {
    let sandbox = sandbox();
    let chosen = state_with_workspace(&sandbox).workspace_get().unwrap();
    assert_eq!(
        AppState::new(sandbox.store.clone()).workspace_get(),
        Some(chosen)
    );
    fs::remove_dir(&sandbox.root).unwrap();
    assert_eq!(AppState::new(sandbox.store.clone()).workspace_get(), None);
}

#[test]
fn working_copy_paths_outside_the_workspace_are_rejected_before_any_svn_call() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let outside = sandbox.root.parent().unwrap().join("fuera");
    fs::create_dir(&outside).unwrap();
    let result = tokio_test_block(state.wc_info(&outside.to_string_lossy()));
    assert_eq!(kind_of(result), CommandErrorKind::OutsideWorkspace);
    let status = tokio_test_block(state.wc_status("..\\fuera", false));
    assert_eq!(kind_of(status), CommandErrorKind::InvalidPath);
}

#[test]
fn svn_set_path_rejects_an_invalid_binary_and_does_not_persist_it() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let detection = state.svn_set_path(Path::new(r"C:\no\existe\svn.exe"));
    assert!(detection.binary.is_none());
    assert!(detection.error.is_some());
    assert_eq!(sandbox.store.load().unwrap().svn_path, None);
}

#[test]
fn svn_detect_and_set_path_find_the_real_client_and_persist_a_valid_path() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let found = state
        .svn_detect()
        .binary
        .expect("se necesita Subversion >= 1.10");
    let detection = state.svn_set_path(Path::new(&found.path));
    assert_eq!(detection.error, None);
    assert_eq!(
        sandbox.store.load().unwrap().svn_path,
        Some(PathBuf::from(&found.path))
    );
    assert_eq!(state.svn_detect().binary.unwrap().version, found.version);
}

#[test]
fn op_cancel_reports_false_for_unknown_operations() {
    let sandbox = sandbox();
    assert!(!AppState::new(sandbox.store.clone()).op_cancel(OperationId(12345)));
}

#[tokio::test]
async fn start_operations_reject_bad_paths_synchronously_without_launching() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let (sinks, mut receiver) = sinks();
    let update = UpdateArgs {
        path: "..\\fuera".into(),
        revision: None,
        ignore_externals: false,
        username: None,
        password: None,
    };
    assert_eq!(
        kind_of(state.start_update(update, sinks)),
        CommandErrorKind::InvalidPath
    );
    assert!(receiver.try_recv().is_err());
}

#[tokio::test]
async fn checkout_with_an_unsafe_url_is_rejected_synchronously_without_leaking_the_secret() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let (sinks, mut receiver) = sinks();
    let repo = TestRepo::create();
    let args = CheckoutArgs {
        url: "https://usuario:clave@host/repo".into(),
        ..checkout_args(&repo, "copia")
    };
    let error = state.start_checkout(args, sinks).unwrap_err();
    assert_eq!(error.kind, CommandErrorKind::InvalidPath);
    assert!(!serde_json::to_string(&error).unwrap().contains("clave"));
    assert!(receiver.try_recv().is_err());
}

#[tokio::test]
async fn operations_reject_a_password_without_a_username() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let repo = TestRepo::create();
    let (sinks_a, _a) = sinks();
    let checkout = CheckoutArgs {
        password: Some("s3cret".into()),
        ..checkout_args(&repo, "copia")
    };
    assert_eq!(
        kind_of(state.start_checkout(checkout, sinks_a)),
        CommandErrorKind::InvalidPath
    );
    let (sinks_b, _b) = sinks();
    let commit = CommitArgs {
        path: ".".into(),
        message: "m".into(),
        username: None,
        password: Some("s3cret".into()),
    };
    assert_eq!(
        kind_of(state.start_commit(commit, sinks_b)),
        CommandErrorKind::InvalidPath
    );
}

#[test]
fn svn_set_path_refuses_any_file_that_is_not_svn_exe() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let impostor = sandbox.root.join("calc.bat");
    fs::write(&impostor, "@echo 1.14.2").unwrap();
    let detection = state.svn_set_path(&impostor);
    assert!(detection.binary.is_none());
    assert_eq!(sandbox.store.load().unwrap().svn_path, None);
    let directory = sandbox.root.join("svn.exe");
    fs::create_dir(&directory).unwrap();
    assert!(state.svn_set_path(&directory).binary.is_none());
}

#[test]
fn config_that_could_not_be_read_is_never_overwritten_after_the_lock_is_released() {
    let sandbox = sandbox();
    let original = r#"{"svn_path": "C:\guardado\svn.exe"}"#;
    sandbox.store.save(&AppConfig::default()).unwrap();
    fs::write(&sandbox.store.path, original).unwrap();
    let exclusive = OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&sandbox.store.path)
        .unwrap();
    let state = AppState::new(sandbox.store.clone());
    drop(exclusive);
    let error = state.workspace_set(&sandbox.root).unwrap_err();
    assert_eq!(error.kind, CommandErrorKind::Io);
    assert_eq!(fs::read_to_string(&sandbox.store.path).unwrap(), original);
}

#[tokio::test]
async fn finished_operations_release_their_cancellation_handle() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let repo = TestRepo::create();
    let (sinks, mut receiver) = sinks();
    let id = state
        .start_checkout(checkout_args(&repo, "copia"), sinks)
        .unwrap();
    finished(&mut receiver).await;
    assert!(!state.op_cancel(id));
}

#[tokio::test]
async fn checkout_existing_destination_is_rejected_before_launching() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    fs::create_dir(sandbox.root.join("copia")).unwrap();
    let repo = TestRepo::create();
    let (sinks, _receiver) = sinks();
    let result = state.start_checkout(checkout_args(&repo, "copia"), sinks);
    assert_eq!(kind_of(result), CommandErrorKind::DestinationExists);
}

#[tokio::test]
async fn full_cycle_checkout_commit_update_status_info_and_cleanup_through_the_state() {
    let sandbox = sandbox();
    let state = state_with_workspace(&sandbox);
    let repo = TestRepo::create();
    let (sinks_a, mut done_a) = sinks();
    state
        .start_checkout(checkout_args(&repo, "copia ñ@x"), sinks_a)
        .unwrap();
    assert_eq!(
        finished(&mut done_a).await,
        OperationResult::Ok { revision: Some(0) }
    );

    let wc = sandbox.root.join("copia ñ@x");
    let file = wc.join("a.txt");
    fs::write(&file, "uno").unwrap();
    let added = Command::new(&repo.svn.path)
        .arg("add")
        .arg(format!("{}@", file.display()))
        .output()
        .unwrap();
    assert!(added.status.success());

    let (sinks_b, mut done_b) = sinks();
    let commit = CommitArgs {
        path: wc.to_string_lossy().into_owned(),
        message: "alta ñandú".into(),
        username: None,
        password: None,
    };
    state.start_commit(commit, sinks_b).unwrap();
    assert_eq!(
        finished(&mut done_b).await,
        OperationResult::Ok { revision: Some(1) }
    );

    let info = state.wc_info(&wc.to_string_lossy()).await.unwrap();
    assert_eq!(info.repository_root, repo_root(&repo));
    let status = state.wc_status(&wc.to_string_lossy(), false).await.unwrap();
    assert!(status.entries.is_empty());

    let (sinks_c, mut done_c) = sinks();
    let cleanup = CleanupArgs {
        path: wc.to_string_lossy().into_owned(),
    };
    state.start_cleanup(cleanup, sinks_c).unwrap();
    assert_eq!(
        finished(&mut done_c).await,
        OperationResult::Ok { revision: None }
    );
}

fn repo_root(repo: &TestRepo) -> String {
    repo.url.clone()
}

fn tokio_test_block<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(future)
}

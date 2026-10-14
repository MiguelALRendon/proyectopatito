#![cfg(windows)]

mod common;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::TestRepo;
use dakedaduck_svn_lib::app::operations::{
    CommitOutcome, OperationContext, OperationError, OperationId, OperationManager, Operations,
    ProgressSink,
};
use dakedaduck_svn_lib::app::workspace::{ScopedPath, Workspace, WorkspaceError};
use dakedaduck_svn_lib::svn::client::SvnClient;
use dakedaduck_svn_lib::svn::commands::{
    CheckoutRequest, CleanupRequest, CommitRequest, Depth, StatusRequest, UpdateRequest,
    is_safe_checkout_url,
};
use dakedaduck_svn_lib::svn::error::SvnErrorKind;
use dakedaduck_svn_lib::svn::message_file::MessageFile;
use dakedaduck_svn_lib::svn::models::StatusItem;
use dakedaduck_svn_lib::svn::progress::{
    ProgressAction, ProgressEvent, last_revision, parse_progress_line,
};
use dakedaduck_svn_lib::svn::runner::{RunOptions, SvnRunner};
use tempfile::TempDir;

const WC_NAME: &str = "copia ñ@dir";
const LOCK_WAIT_PROOF: Duration = Duration::from_secs(1);
const LOCK_PROBE: Duration = Duration::from_millis(150);
const UNICODE_MESSAGE: &str = "ñandú ¿qué? 日本語 ✔";
const TINY_TIMEOUT: Duration = Duration::from_millis(1);
const KILL_AFTER: Duration = Duration::from_secs(2);
const STALLING_HOOK: &str = "@echo off
ping -n 9 127.0.0.1 >nul
";

struct Env {
    _root: TempDir,
    workspace: Workspace,
    repo: TestRepo,
    ops: Operations,
}

impl Env {
    fn new() -> Self {
        let repo = TestRepo::create();
        let root = TempDir::new().unwrap();
        let workspace = Workspace::new(root.path()).unwrap();
        let ops = Operations::new(
            workspace.clone(),
            SvnClient::new(SvnRunner::new(repo.svn.path.clone())),
            Arc::new(OperationManager::default()),
        );
        Self {
            _root: root,
            workspace,
            repo,
            ops,
        }
    }

    fn scoped(&self, name: &str) -> ScopedPath {
        self.workspace.resolve(Path::new(name), false).unwrap()
    }

    fn context(&self) -> OperationContext {
        let (id, _) = self.ops.manager().begin();
        OperationContext {
            id,
            progress: None,
            password: None,
        }
    }

    async fn checkout(&self, name: &str) -> ScopedPath {
        let dest = self.scoped(name);
        self.ops
            .checkout(&dest, checkout_request(&self.repo), &self.context())
            .await
            .unwrap();
        dest
    }

    async fn commit_file(&self, wc: &ScopedPath, file: &str, message: &str) -> CommitOutcome {
        let path = wc.as_path().join(file);
        fs::write(&path, "contenido").unwrap();
        self.raw_svn(&["add", &format!("{}@", path.display())]);
        self.ops
            .commit(wc, commit_request(message), &self.context())
            .await
            .unwrap()
    }

    fn raw_svn(&self, args: &[&str]) -> String {
        let output = Command::new(&self.repo.svn.path)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "svn {args:?} fallo");
        String::from_utf8_lossy(&output.stdout).into_owned()
    }
}

fn checkout_request(repo: &TestRepo) -> CheckoutRequest {
    CheckoutRequest {
        url: repo.url.clone(),
        dest: PathBuf::new(),
        revision: None,
        depth: Depth::Infinity,
        ignore_externals: false,
        username: None,
    }
}

fn update_request() -> UpdateRequest {
    UpdateRequest {
        target: PathBuf::new(),
        revision: None,
        ignore_externals: false,
        username: None,
    }
}

fn commit_request(message: &str) -> CommitRequest {
    CommitRequest {
        target: PathBuf::new(),
        message: message.to_string(),
        username: None,
    }
}

fn os_args(parts: &[&str]) -> Vec<OsString> {
    parts.iter().map(OsString::from).collect()
}

#[test]
fn progress_line_reads_update_columns() {
    let expected = [
        ("A    carpeta\\a.txt", ProgressAction::Added),
        ("U    a.txt", ProgressAction::Updated),
        ("D    a.txt", ProgressAction::Deleted),
        ("C    a.txt", ProgressAction::Conflicted),
        ("G    a.txt", ProgressAction::Merged),
        (" U   a.txt", ProgressAction::Updated),
    ];
    for (line, action) in expected {
        let ProgressEvent::Item { action: found, .. } = parse_progress_line(line) else {
            panic!("{line} deberia ser un item");
        };
        assert_eq!(found, action, "{line}");
    }
}

#[test]
fn progress_line_reads_commit_verbs_and_strips_crlf() {
    assert_eq!(
        parse_progress_line("Sending        a.txt\r\n"),
        ProgressEvent::Item {
            action: ProgressAction::Sending,
            path: "a.txt".into()
        }
    );
    assert!(matches!(
        parse_progress_line("Adding         b.txt"),
        ProgressEvent::Item {
            action: ProgressAction::Added,
            ..
        }
    ));
    assert!(matches!(
        parse_progress_line("Transmitting file data ."),
        ProgressEvent::Item {
            action: ProgressAction::Transmitting,
            ..
        }
    ));
}

#[test]
fn progress_line_falls_back_to_other_for_unrecognized_text() {
    for line in ["", "Updating '.':", "Sendingx a.txt", "A"] {
        assert_eq!(
            parse_progress_line(line),
            ProgressEvent::Other(line.to_string()),
            "{line:?}"
        );
    }
}

#[test]
fn progress_line_keeps_unknown_action_letters_as_other_items() {
    assert_eq!(
        parse_progress_line("Z    a.txt"),
        ProgressEvent::Item {
            action: ProgressAction::Other,
            path: "a.txt".into()
        }
    );
}

#[test]
fn progress_line_reads_revision_sentences() {
    for line in [
        "Updated to revision 7.",
        "Checked out revision 7.",
        "Committed revision 7.",
        "At revision 7.",
    ] {
        assert_eq!(
            parse_progress_line(line),
            ProgressEvent::Revision { revision: 7 }
        );
    }
}

#[test]
fn last_revision_takes_the_final_revision_line_or_none() {
    assert_eq!(last_revision(""), None);
    assert_eq!(
        last_revision("Sending a.txt\nTransmitting file data ."),
        None
    );
    assert_eq!(
        last_revision("Committed revision 3.\r\nUpdated to revision 9.\r\n"),
        Some(9)
    );
    assert_eq!(last_revision("Committed revision abc."), None);
}

#[test]
fn checkout_args_put_destination_last_and_without_peg_terminator() {
    let request = CheckoutRequest {
        url: "https://h/r".into(),
        dest: PathBuf::from(r"C:\w\a@b"),
        revision: Some(4),
        depth: Depth::Immediates,
        ignore_externals: true,
        username: Some("alice".into()),
    };
    let args = request.args();
    assert_eq!(args.first(), Some(&OsString::from("checkout")));
    assert_eq!(args.last(), Some(&OsString::from(r"C:\w\a@b")));
    assert!(args.contains(&OsString::from("https://h/r@")));
    for flag in [
        "-r",
        "4",
        "--depth",
        "immediates",
        "--ignore-externals",
        "--username",
        "alice",
    ] {
        assert!(args.contains(&OsString::from(flag)), "falta {flag}");
    }
}

#[test]
fn update_and_cleanup_args_end_with_peg_safe_target() {
    let update = UpdateRequest {
        target: PathBuf::from(r"C:\w\a@b"),
        ..update_request()
    };
    let cleanup = CleanupRequest {
        target: PathBuf::from(r"C:\w\a@b"),
    };
    assert_eq!(update.args(), os_args(&["update", r"C:\w\a@b@"]));
    assert_eq!(cleanup.args(), os_args(&["cleanup", r"C:\w\a@b@"]));
}

#[test]
fn commit_args_read_the_message_from_a_file_instead_of_argv() {
    let request = CommitRequest {
        target: PathBuf::from(r"C:\w\a"),
        message: "secreto".into(),
        username: None,
    };
    let args = request.args(Path::new(r"C:\tmp\msg.txt"));
    assert!(!args.contains(&OsString::from("-m")));
    assert!(!args.contains(&OsString::from("secreto")));
    for flag in ["-F", r"C:\tmp\msg.txt", "--encoding", "UTF-8"] {
        assert!(args.contains(&OsString::from(flag)), "falta {flag}");
    }
}

#[test]
fn message_file_normalizes_line_endings_and_is_removed_on_drop() {
    let file = MessageFile::create("uno\r\ndos\rtres\ncuatro").unwrap();
    let path = file.path().to_path_buf();
    assert_eq!(fs::read_to_string(&path).unwrap(), "uno\ndos\ntres\ncuatro");
    drop(file);
    assert!(!path.exists());
}

#[test]
fn manager_ids_are_unique_and_cancel_only_reaches_live_operations() {
    let manager = OperationManager::default();
    let (first, _) = manager.begin();
    let (second, _) = manager.begin();
    assert_ne!(first, second);
    assert!(!manager.cancel(OperationId(999)));
    assert!(manager.cancel(first));
    manager.finish(first);
    assert!(!manager.cancel(first));
}

#[tokio::test]
async fn manager_cancel_before_waiting_still_wakes_the_operation() {
    let manager = OperationManager::default();
    let (id, signal) = manager.begin();
    manager.cancel(id);
    tokio::time::timeout(LOCK_PROBE, signal.notified())
        .await
        .expect("la cancelacion previa debe quedar guardada");
}

#[tokio::test]
async fn manager_serializes_the_same_working_copy_ignoring_case() {
    let manager = OperationManager::default();
    let held = manager.lock_working_copy(Path::new(r"C:\SVN\WC")).await;
    let blocked = tokio::time::timeout(
        LOCK_PROBE,
        manager.lock_working_copy(Path::new(r"c:\svn\wc")),
    )
    .await;
    assert!(blocked.is_err());
    drop(held);
    let free = tokio::time::timeout(
        LOCK_PROBE,
        manager.lock_working_copy(Path::new(r"c:\svn\wc")),
    )
    .await;
    assert!(free.is_ok());
}

#[tokio::test]
async fn manager_lets_different_working_copies_run_in_parallel() {
    let manager = OperationManager::default();
    let _first = manager.lock_working_copy(Path::new(r"C:\svn\uno")).await;
    let second = tokio::time::timeout(
        LOCK_PROBE,
        manager.lock_working_copy(Path::new(r"C:\svn\dos")),
    )
    .await;
    assert!(second.is_ok());
}

#[test]
fn manager_tracks_cleanup_flag_per_working_copy_ignoring_case() {
    let manager = OperationManager::default();
    manager.mark_needs_cleanup(Path::new(r"C:\SVN\WC"));
    assert!(manager.needs_cleanup(Path::new(r"c:\svn\wc")));
    assert!(!manager.needs_cleanup(Path::new(r"C:\svn\otra")));
    manager.clear_cleanup(Path::new(r"c:\svn\wc"));
    assert!(!manager.needs_cleanup(Path::new(r"C:\SVN\WC")));
}

#[tokio::test]
async fn update_rejects_a_working_copy_swapped_for_an_escaping_junction() {
    let env = Env::new();
    let dest = env.scoped(WC_NAME);
    let outside = TempDir::new().unwrap();
    let status = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(dest.as_path())
        .arg(outside.path())
        .output()
        .unwrap()
        .status;
    assert!(status.success());
    let error = env
        .ops
        .update(&dest, update_request(), &env.context())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        OperationError::Workspace(WorkspaceError::OutsideWorkspace)
    ));
}

#[tokio::test]
async fn cancelled_update_marks_the_working_copy_and_cleanup_clears_it() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let ctx = env.context();
    env.ops.manager().cancel(ctx.id);
    let error = env
        .ops
        .update(&wc, update_request(), &ctx)
        .await
        .unwrap_err();
    assert_eq!(error.svn_kind(), Some(SvnErrorKind::Cancelled));
    assert!(env.ops.manager().needs_cleanup(wc.as_path()));
    env.ops.cleanup(&wc, &env.context()).await.unwrap();
    assert!(!env.ops.manager().needs_cleanup(wc.as_path()));
}

#[tokio::test]
async fn update_outside_a_working_copy_reports_the_svn_failure() {
    let env = Env::new();
    let plain = env.scoped("no-es-wc");
    fs::create_dir(plain.as_path()).unwrap();
    let error = env
        .ops
        .update(&plain, update_request(), &env.context())
        .await
        .unwrap_err();
    assert!(error.svn_kind().is_some());
}

#[tokio::test]
async fn commit_with_nothing_to_commit_returns_no_revision() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let outcome = env
        .ops
        .commit(&wc, commit_request("nada"), &env.context())
        .await
        .unwrap();
    assert_eq!(outcome, CommitOutcome { revision: None });
}

#[tokio::test]
async fn commit_message_with_unicode_and_mixed_line_endings_reaches_the_log_intact() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let message = format!("{UNICODE_MESSAGE}\r\nsegunda linea\nfin");
    let outcome = env.commit_file(&wc, "a.txt", &message).await;
    assert_eq!(outcome.revision, Some(1));
    let log = env.raw_svn(&["log", "--xml", "-r", "1", &env.repo.url]);
    assert!(log.contains(UNICODE_MESSAGE));
    assert!(log.contains("segunda linea"));
}

#[tokio::test]
async fn two_simultaneous_updates_of_the_same_working_copy_both_succeed() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let (first, second) = (env.context(), env.context());
    let (a, b) = tokio::join!(
        env.ops.update(&wc, update_request(), &first),
        env.ops.update(&wc, update_request(), &second)
    );
    assert_eq!(a.unwrap(), 0);
    assert_eq!(b.unwrap(), 0);
}

#[tokio::test]
async fn update_streams_progress_events_and_returns_the_new_revision() {
    let env = Env::new();
    let mine = env.checkout("mia").await;
    let other = env.checkout("otra").await;
    env.commit_file(&other, "nuevo ñ.txt", "alta").await;
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink_events = events.clone();
    let sink: ProgressSink = Arc::new(move |_, event| sink_events.lock().unwrap().push(event));
    let ctx = OperationContext {
        progress: Some(sink),
        ..env.context()
    };
    let revision = env.ops.update(&mine, update_request(), &ctx).await.unwrap();
    assert_eq!(revision, 1);
    let seen = events.lock().unwrap();
    assert!(seen.iter().any(|event| matches!(
        event,
        ProgressEvent::Item { action: ProgressAction::Added, path } if path.contains("nuevo")
    )));
}

#[tokio::test]
async fn runner_streams_stdout_lines_and_still_returns_the_full_output() {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let options = RunOptions {
        progress: Some(sender),
        ..RunOptions::default()
    };
    let output = SvnRunner::new(PathBuf::from("cmd.exe"))
        .run(&os_args(&["/C", "echo", "hola"]), options)
        .await
        .unwrap();
    assert_eq!(
        receiver.recv().await.as_deref(),
        Some("hola --non-interactive")
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("hola"));
}

#[tokio::test]
async fn checkout_into_a_fresh_working_copy_reports_revision_zero() {
    let env = Env::new();
    let dest = env.scoped(WC_NAME);
    let revision = env
        .ops
        .checkout(&dest, checkout_request(&env.repo), &env.context())
        .await
        .unwrap();
    assert_eq!(revision, 0);
}

#[tokio::test]
async fn operation_waits_while_another_operation_holds_the_working_copy() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let held = env.ops.manager().lock_working_copy(wc.as_path()).await;
    let ctx = env.context();
    let mut pending = Box::pin(env.ops.update(&wc, update_request(), &ctx));
    let early = tokio::time::timeout(LOCK_WAIT_PROOF, &mut pending).await;
    assert!(early.is_err(), "la operacion avanzo con la WC bloqueada");
    drop(held);
    assert_eq!(pending.await.unwrap(), 0);
}

#[tokio::test]
async fn queued_operation_cancelled_while_waiting_returns_cancelled_without_marking_cleanup() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let _held = env.ops.manager().lock_working_copy(wc.as_path()).await;
    let ctx = env.context();
    env.ops.manager().cancel(ctx.id);
    let error = tokio::time::timeout(LOCK_WAIT_PROOF, env.ops.update(&wc, update_request(), &ctx))
        .await
        .expect("la cancelacion debe interrumpir la espera del lock")
        .unwrap_err();
    assert_eq!(error.svn_kind(), Some(SvnErrorKind::Cancelled));
    assert!(!env.ops.manager().needs_cleanup(wc.as_path()));
}

#[tokio::test]
async fn checkout_rejects_unsafe_urls_before_touching_svn() {
    let env = Env::new();
    let dest = env.scoped("destino");
    for url in [
        "--config-dir=x",
        "ftp://host/r",
        "https://u:clave@host/r",
        "sin-esquema",
    ] {
        let request = CheckoutRequest {
            url: url.into(),
            ..checkout_request(&env.repo)
        };
        let error = env
            .ops
            .checkout(&dest, request, &env.context())
            .await
            .unwrap_err();
        assert!(matches!(error, OperationError::InvalidUrl), "{url}");
    }
}

#[test]
fn safe_checkout_url_accepts_known_schemes_and_user_without_password() {
    for url in [
        "https://host/repo",
        "HTTP://host:8080/repo",
        "svn://host/repo",
        "svn+ssh://usuario@host/repo",
        "file:///C:/repos/a@b",
    ] {
        assert!(is_safe_checkout_url(url), "{url}");
    }
}

#[test]
fn update_args_include_revision_externals_and_username_when_requested() {
    let request = UpdateRequest {
        target: PathBuf::from(r"C:\w\a"),
        revision: Some(4),
        ignore_externals: true,
        username: Some("alice".into()),
    };
    let args = request.args();
    for flag in ["-r", "4", "--ignore-externals", "--username", "alice"] {
        assert!(args.contains(&OsString::from(flag)), "falta {flag}");
    }
}

#[test]
fn update_args_omit_optional_flags_when_nothing_is_requested() {
    let request = UpdateRequest {
        target: PathBuf::from(r"C:\w\a"),
        ..update_request()
    };
    assert_eq!(request.args(), os_args(&["update", r"C:\w\a@"]));
}

#[test]
fn progress_line_reads_existed_replaced_and_broken_columns() {
    for (line, expected) in [
        ("E    a.txt", ProgressAction::Existed),
        ("R    a.txt", ProgressAction::Replaced),
        ("B    a.txt", ProgressAction::Broken),
    ] {
        let event = parse_progress_line(line);
        assert_eq!(
            event,
            ProgressEvent::Item {
                action: expected,
                path: "a.txt".into()
            },
            "{line}"
        );
    }
}

#[test]
fn progress_line_reads_the_deleting_and_replacing_commit_verbs() {
    assert_eq!(
        parse_progress_line("Deleting       a.txt"),
        ProgressEvent::Item {
            action: ProgressAction::Deleted,
            path: "a.txt".into()
        }
    );
    assert_eq!(
        parse_progress_line("Replacing      b.txt"),
        ProgressEvent::Item {
            action: ProgressAction::Replaced,
            path: "b.txt".into()
        }
    );
}

async fn timed_out_update(env: &Env, wc: &ScopedPath) -> OperationError {
    env.ops
        .clone()
        .with_timeout(TINY_TIMEOUT)
        .update(wc, update_request(), &env.context())
        .await
        .unwrap_err()
}

#[tokio::test]
async fn update_that_exceeds_the_timeout_reports_timed_out() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let error = timed_out_update(&env, &wc).await;
    assert_eq!(error.svn_kind(), Some(SvnErrorKind::TimedOut));
}

#[tokio::test]
async fn update_that_times_out_marks_the_working_copy_for_cleanup() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    assert!(!env.ops.manager().needs_cleanup(wc.as_path()));
    timed_out_update(&env, &wc).await;
    assert!(env.ops.manager().needs_cleanup(wc.as_path()));
}

#[tokio::test]
async fn svn_failure_that_is_neither_cancel_nor_timeout_does_not_mark_cleanup() {
    let env = Env::new();
    let plain = env.scoped("no-es-wc");
    fs::create_dir(plain.as_path()).unwrap();
    let error = env
        .ops
        .update(&plain, update_request(), &env.context())
        .await
        .unwrap_err();
    assert_eq!(error.svn_kind(), Some(SvnErrorKind::Other));
    assert!(!env.ops.manager().needs_cleanup(plain.as_path()));
}

#[tokio::test]
async fn failed_cleanup_keeps_the_cleanup_mark() {
    let env = Env::new();
    let plain = env.scoped("no-es-wc");
    fs::create_dir(plain.as_path()).unwrap();
    env.ops.manager().mark_needs_cleanup(plain.as_path());
    let error = env.ops.cleanup(&plain, &env.context()).await.unwrap_err();
    assert_eq!(error.svn_kind(), Some(SvnErrorKind::Other));
    assert!(env.ops.manager().needs_cleanup(plain.as_path()));
}

#[tokio::test]
async fn commit_killed_midway_leaves_the_copy_locked_until_cleanup_frees_it() {
    let env = Env::new();
    let wc = env.checkout(WC_NAME).await;
    let hook = env.repo._dir.path().join("hooks").join("pre-commit.bat");
    fs::write(hook, STALLING_HOOK).unwrap();
    let file = wc.as_path().join("a.txt");
    fs::write(&file, "x").unwrap();
    env.raw_svn(&["add", &format!("{}@", file.display())]);
    let ctx = env.context();
    let (manager, id) = (env.ops.manager().clone(), ctx.id);
    tokio::spawn(async move {
        tokio::time::sleep(KILL_AFTER).await;
        manager.cancel(id);
    });
    let killed = env.ops.commit(&wc, commit_request("m"), &ctx).await;
    assert_eq!(
        killed.unwrap_err().svn_kind(),
        Some(SvnErrorKind::Cancelled)
    );
    let blocked = env.ops.update(&wc, update_request(), &env.context()).await;
    assert_eq!(
        blocked.unwrap_err().svn_kind(),
        Some(SvnErrorKind::WorkingCopyLocked)
    );
    env.ops.cleanup(&wc, &env.context()).await.unwrap();
    env.ops
        .update(&wc, update_request(), &env.context())
        .await
        .unwrap();
}

#[tokio::test]
async fn update_over_a_locally_edited_line_leaves_the_file_conflicted() {
    let env = Env::new();
    let (mine, theirs) = (env.checkout("mia").await, env.checkout("ajena").await);
    env.commit_file(&theirs, "f.txt", "base").await;
    env.ops
        .update(&mine, update_request(), &env.context())
        .await
        .unwrap();
    fs::write(theirs.as_path().join("f.txt"), "linea ajena").unwrap();
    env.ops
        .commit(&theirs, commit_request("ajena"), &env.context())
        .await
        .unwrap();
    fs::write(mine.as_path().join("f.txt"), "linea mia").unwrap();
    env.ops
        .update(&mine, update_request(), &env.context())
        .await
        .unwrap();
    let request = StatusRequest {
        target: mine.as_path().to_path_buf(),
        remote: false,
    };
    let report = env
        .ops
        .client()
        .status(&request, RunOptions::default())
        .await
        .unwrap();
    let conflicted = report
        .entries
        .iter()
        .any(|entry| entry.item == StatusItem::Conflicted);
    assert!(conflicted, "{report:?}");
}

#![cfg(windows)]

use dakedaduck_svn_lib::app::args::{CheckoutArgs, CleanupArgs, CommitArgs, UpdateArgs};
use dakedaduck_svn_lib::app::error::{CommandError, CommandErrorKind};
use dakedaduck_svn_lib::app::operations::OperationId;
use dakedaduck_svn_lib::app::state::OperationResult;
use dakedaduck_svn_lib::commands::{DonePayload, ProgressPayload};
use dakedaduck_svn_lib::svn::commands::Depth;
use dakedaduck_svn_lib::svn::progress::{ProgressAction, ProgressEvent};
use serde_json::{Value, json};

const FIXTURE: &str = include_str!("fixtures/contract.json");
const OPERATION: OperationId = OperationId(7);

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}

fn kind_name(kind: CommandErrorKind) -> &'static str {
    match kind {
        CommandErrorKind::NoWorkspace => "no_workspace",
        CommandErrorKind::NoSvn => "no_svn",
        CommandErrorKind::OutsideWorkspace => "outside_workspace",
        CommandErrorKind::DestinationExists => "destination_exists",
        CommandErrorKind::InvalidPath => "invalid_path",
        CommandErrorKind::AuthRequired => "auth_required",
        CommandErrorKind::UntrustedCertificate => "untrusted_certificate",
        CommandErrorKind::WorkingCopyTooOld => "working_copy_too_old",
        CommandErrorKind::WorkingCopyLocked => "working_copy_locked",
        CommandErrorKind::Cancelled => "cancelled",
        CommandErrorKind::TimedOut => "timed_out",
        CommandErrorKind::SvnFailed => "svn_failed",
        CommandErrorKind::ParseFailed => "parse_failed",
        CommandErrorKind::Io => "io",
    }
}

const ALL_KINDS: [CommandErrorKind; 14] = [
    CommandErrorKind::NoWorkspace,
    CommandErrorKind::NoSvn,
    CommandErrorKind::OutsideWorkspace,
    CommandErrorKind::DestinationExists,
    CommandErrorKind::InvalidPath,
    CommandErrorKind::AuthRequired,
    CommandErrorKind::UntrustedCertificate,
    CommandErrorKind::WorkingCopyTooOld,
    CommandErrorKind::WorkingCopyLocked,
    CommandErrorKind::Cancelled,
    CommandErrorKind::TimedOut,
    CommandErrorKind::SvnFailed,
    CommandErrorKind::ParseFailed,
    CommandErrorKind::Io,
];

fn progress(event: ProgressEvent) -> Value {
    serde_json::to_value(ProgressPayload {
        id: OPERATION,
        event,
    })
    .unwrap()
}

fn done(result: OperationResult) -> Value {
    serde_json::to_value(DonePayload {
        id: OPERATION,
        result,
    })
    .unwrap()
}

#[test]
fn serialized_error_kinds_are_exactly_the_ones_the_frontend_lists() {
    let serialized: Vec<Value> = ALL_KINDS
        .iter()
        .map(|kind| serde_json::to_value(kind).unwrap())
        .collect();
    let named: Vec<Value> = ALL_KINDS
        .iter()
        .map(|kind| json!(kind_name(*kind)))
        .collect();
    assert_eq!(serialized, named);
    assert_eq!(Value::Array(serialized), fixture()["error_kinds"]);
}

#[test]
fn progress_events_serialize_to_the_shape_the_frontend_reads() {
    let events = &fixture()["events"];
    let item = ProgressEvent::Item {
        action: ProgressAction::Added,
        path: "a.txt".into(),
    };
    assert_eq!(progress(item), events["progress_item"]);
    assert_eq!(
        progress(ProgressEvent::Revision { revision: 3 }),
        events["progress_revision"]
    );
    assert_eq!(
        progress(ProgressEvent::Other("texto libre".into())),
        events["progress_other"]
    );
}

#[test]
fn done_events_serialize_to_the_shape_the_frontend_reads() {
    let events = &fixture()["events"];
    assert_eq!(
        done(OperationResult::Ok { revision: Some(3) }),
        events["done_ok"]
    );
    assert_eq!(
        done(OperationResult::Ok { revision: None }),
        events["done_ok_without_revision"]
    );
    let error = CommandError {
        kind: CommandErrorKind::AuthRequired,
        message: "Se requieren credenciales válidas.".into(),
        codes: vec!["E170013".into(), "E170001".into()],
        detail: Some("svn: E170001: x".into()),
    };
    assert_eq!(done(OperationResult::Err(error)), events["done_err"]);
}

#[test]
fn requests_sent_by_the_frontend_deserialize_into_the_backend_args() {
    let requests = fixture()["requests"].clone();
    let checkout: CheckoutArgs = serde_json::from_value(requests["checkout"].clone()).unwrap();
    assert_eq!(checkout.url, "https://h/r");
    assert_eq!(checkout.revision, Some(4));
    assert!(matches!(checkout.depth, Depth::Immediates));
    assert!(checkout.ignore_externals);
    assert_eq!(checkout.username.as_deref(), Some("alice"));
    assert_eq!(checkout.password.as_deref(), Some("p"));
    let update: UpdateArgs = serde_json::from_value(requests["update"].clone()).unwrap();
    assert_eq!((update.path.as_str(), update.revision), ("copia", None));
    let commit: CommitArgs = serde_json::from_value(requests["commit"].clone()).unwrap();
    assert_eq!(commit.message, "alta");
    assert_eq!(commit.username.as_deref(), Some("alice"));
    let cleanup: CleanupArgs = serde_json::from_value(requests["cleanup"].clone()).unwrap();
    assert_eq!(cleanup.path, "copia");
}

const ALL_ACTIONS: [ProgressAction; 11] = [
    ProgressAction::Added,
    ProgressAction::Deleted,
    ProgressAction::Updated,
    ProgressAction::Conflicted,
    ProgressAction::Merged,
    ProgressAction::Existed,
    ProgressAction::Replaced,
    ProgressAction::Broken,
    ProgressAction::Sending,
    ProgressAction::Transmitting,
    ProgressAction::Other,
];

fn action_name(action: ProgressAction) -> &'static str {
    match action {
        ProgressAction::Added => "added",
        ProgressAction::Deleted => "deleted",
        ProgressAction::Updated => "updated",
        ProgressAction::Conflicted => "conflicted",
        ProgressAction::Merged => "merged",
        ProgressAction::Existed => "existed",
        ProgressAction::Replaced => "replaced",
        ProgressAction::Broken => "broken",
        ProgressAction::Sending => "sending",
        ProgressAction::Transmitting => "transmitting",
        ProgressAction::Other => "other",
    }
}

fn depth_name(depth: Depth) -> &'static str {
    match depth {
        Depth::Empty => "empty",
        Depth::Files => "files",
        Depth::Immediates => "immediates",
        Depth::Infinity => "infinity",
    }
}

#[test]
fn serialized_progress_actions_are_exactly_the_ones_the_frontend_lists() {
    let serialized: Vec<Value> = ALL_ACTIONS
        .iter()
        .map(|action| serde_json::to_value(action).unwrap())
        .collect();
    let named: Vec<Value> = ALL_ACTIONS
        .iter()
        .map(|action| json!(action_name(*action)))
        .collect();
    assert_eq!(serialized, named);
    assert_eq!(Value::Array(serialized), fixture()["item_actions"]);
}

#[test]
fn every_depth_the_frontend_lists_is_accepted_and_none_is_missing() {
    let listed = fixture()["depths"].clone();
    let accepted: Vec<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|name| {
            let depth: Depth = serde_json::from_value(name.clone()).unwrap();
            depth_name(depth)
        })
        .collect();
    assert_eq!(accepted, ["empty", "files", "immediates", "infinity"]);
    assert_eq!(accepted.len(), 4);
}

#[test]
fn requests_the_ui_really_builds_deserialize_into_the_backend_args() {
    let requests = fixture()["ui_requests"].clone();
    let checkout: CheckoutArgs = serde_json::from_value(requests["checkout"].clone()).unwrap();
    assert!(matches!(checkout.depth, Depth::Infinity));
    assert!(!checkout.ignore_externals);
    assert_eq!(checkout.revision, None);
    let update: UpdateArgs = serde_json::from_value(requests["update"].clone()).unwrap();
    assert_eq!(update.path, "wc");
    let commit: CommitArgs = serde_json::from_value(requests["commit"].clone()).unwrap();
    assert_eq!(commit.password, None);
    let cleanup: CleanupArgs = serde_json::from_value(requests["cleanup"].clone()).unwrap();
    assert_eq!(cleanup.path, "wc");
}

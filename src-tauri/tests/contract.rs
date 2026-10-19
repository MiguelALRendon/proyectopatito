#![cfg(windows)]

use dakedaduck_svn_lib::app::args::{
    CheckoutArgs, CleanupArgs, CommitArgs, StatusMapArgs, UpdateArgs, WriteTextArgs,
};
use dakedaduck_svn_lib::app::error::{CommandError, CommandErrorKind};
use dakedaduck_svn_lib::app::files::{
    DirListing, Encoding, EntryKind, Eol, FileEntry, FileProbe, TextDocument, TextWritten,
    WcLocation,
};
use dakedaduck_svn_lib::app::operations::OperationId;
use dakedaduck_svn_lib::app::sniff::ProbeKind;
use dakedaduck_svn_lib::app::state::{OperationResult, SvnBinaryInfo, SvnDetection};
use dakedaduck_svn_lib::app::ui_state::{Located, UiStateView};
use dakedaduck_svn_lib::app::wc_status::WcStatusMap;
use dakedaduck_svn_lib::commands::{DonePayload, ProgressPayload};
use dakedaduck_svn_lib::config::{
    Favorite, FolderView, SortDirection, SortKey, Tab, TabKind, UiState, ViewColumn, ViewMode,
};
use dakedaduck_svn_lib::svn::commands::Depth;
use dakedaduck_svn_lib::svn::locator::SvnOrigin;
use dakedaduck_svn_lib::svn::models::{StatusEntry, StatusItem, StatusLock};
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
        CommandErrorKind::NotADirectory => "not_a_directory",
        CommandErrorKind::ForbiddenPath => "forbidden_path",
        CommandErrorKind::NotText => "not_text",
        CommandErrorKind::TooLarge => "too_large",
        CommandErrorKind::FileChanged => "file_changed",
        CommandErrorKind::ReadOnly => "read_only",
        CommandErrorKind::FileLocked => "file_locked",
        CommandErrorKind::WorkingCopyBusy => "working_copy_busy",
        CommandErrorKind::CloudOnly => "cloud_only",
        CommandErrorKind::NotAllowed => "not_allowed",
        CommandErrorKind::OfficeTooLarge => "office_too_large",
        CommandErrorKind::ArchiveCorrupt => "archive_corrupt",
        CommandErrorKind::ArchiveEncrypted => "archive_encrypted",
        CommandErrorKind::ArchiveLimit => "archive_limit",
        CommandErrorKind::ArchiveUnsupported => "archive_unsupported",
        CommandErrorKind::UnsafeEntry => "unsafe_entry",
        CommandErrorKind::ArchiveNeedsConfirmation => "archive_needs_confirmation",
    }
}

const ALL_KINDS: [CommandErrorKind; 31] = [
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
    CommandErrorKind::NotADirectory,
    CommandErrorKind::ForbiddenPath,
    CommandErrorKind::NotText,
    CommandErrorKind::TooLarge,
    CommandErrorKind::FileChanged,
    CommandErrorKind::ReadOnly,
    CommandErrorKind::FileLocked,
    CommandErrorKind::WorkingCopyBusy,
    CommandErrorKind::CloudOnly,
    CommandErrorKind::NotAllowed,
    CommandErrorKind::OfficeTooLarge,
    CommandErrorKind::ArchiveCorrupt,
    CommandErrorKind::ArchiveEncrypted,
    CommandErrorKind::ArchiveLimit,
    CommandErrorKind::ArchiveUnsupported,
    CommandErrorKind::UnsafeEntry,
    CommandErrorKind::ArchiveNeedsConfirmation,
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
    let status_map: StatusMapArgs = serde_json::from_value(requests["status_map"].clone()).unwrap();
    assert_eq!(status_map.wc_root, "proyecto");
    assert!(status_map.remote);
    assert!(status_map.refresh);
    assert_eq!(status_map.username.as_deref(), Some("alice"));
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
    let status_map: StatusMapArgs = serde_json::from_value(requests["status_map"].clone()).unwrap();
    assert_eq!(status_map.wc_root, "wc");
    assert!(!status_map.remote);
    assert!(!status_map.refresh);
    assert_eq!(status_map.password, None);
}

const ALL_PROBE_KINDS: [ProbeKind; 9] = [
    ProbeKind::Text,
    ProbeKind::Image,
    ProbeKind::Pdf,
    ProbeKind::Office,
    ProbeKind::Audio,
    ProbeKind::Video,
    ProbeKind::Archive,
    ProbeKind::Binary,
    ProbeKind::Cloud,
];

fn probe_kind_name(kind: ProbeKind) -> &'static str {
    match kind {
        ProbeKind::Text => "text",
        ProbeKind::Image => "image",
        ProbeKind::Pdf => "pdf",
        ProbeKind::Office => "office",
        ProbeKind::Audio => "audio",
        ProbeKind::Video => "video",
        ProbeKind::Archive => "archive",
        ProbeKind::Binary => "binary",
        ProbeKind::Cloud => "cloud",
    }
}

#[test]
fn the_svn_detection_serializes_to_the_shape_the_frontend_reads() {
    let detection = SvnDetection {
        binary: Some(SvnBinaryInfo {
            path: "C:/svn/svn.exe".to_owned(),
            version: "1.14.5".to_owned(),
            origin: SvnOrigin::Bundled,
        }),
        error: None,
        warning: Some("aviso".to_owned()),
    };
    assert_eq!(
        serde_json::to_value(detection).unwrap(),
        fixture()["svn_detection"]
    );
    let origins = [SvnOrigin::Configured, SvnOrigin::Bundled, SvnOrigin::System];
    assert_eq!(
        serde_json::to_value(origins).unwrap(),
        fixture()["svn_origins"]
    );
}

#[test]
fn serialized_probe_kinds_are_exactly_the_ones_the_frontend_lists() {
    let serialized: Vec<Value> = ALL_PROBE_KINDS
        .iter()
        .map(|kind| serde_json::to_value(kind).unwrap())
        .collect();
    let named: Vec<Value> = ALL_PROBE_KINDS
        .iter()
        .map(|kind| json!(probe_kind_name(*kind)))
        .collect();
    assert_eq!(serialized, named);
    assert_eq!(Value::Array(serialized), fixture()["probe_kinds"]);
}

fn entry(name: &str, kind: EntryKind) -> FileEntry {
    FileEntry {
        name: name.into(),
        kind,
        size: 0,
        modified_ms: None,
        hidden: false,
        read_only: false,
        is_link: false,
        escapes_workspace: false,
        cloud_only: false,
    }
}

fn cloud_image_entry() -> FileEntry {
    FileEntry {
        size: 68,
        modified_ms: Some(1_760_400_000_000),
        read_only: true,
        cloud_only: true,
        ..entry("logo.png", EntryKind::File)
    }
}

fn escaping_link_entry() -> FileEntry {
    FileEntry {
        hidden: true,
        is_link: true,
        escapes_workspace: true,
        ..entry("enlace", EntryKind::Dir)
    }
}

#[test]
fn a_directory_listing_serializes_to_the_shape_the_frontend_reads() {
    let listing = DirListing {
        path: r"proyecto\src".into(),
        entries: vec![cloud_image_entry(), escaping_link_entry()],
        truncated: true,
        wc: Some(WcLocation {
            root: "proyecto".into(),
            is_root: false,
        }),
    };
    assert_eq!(
        serde_json::to_value(listing).unwrap(),
        fixture()["fs"]["listing"]
    );
}

#[test]
fn a_file_probe_serializes_to_the_shape_the_frontend_reads() {
    let probe = FileProbe {
        kind: ProbeKind::Image,
        mime: "image/png",
        len: 68,
        extension: Some("png"),
        has_macros: false,
        version: None,
    };
    assert_eq!(
        serde_json::to_value(probe).unwrap(),
        fixture()["fs"]["probe"]
    );
}

#[test]
fn a_text_document_serializes_to_the_shape_the_frontend_reads() {
    let document = TextDocument {
        content: "uno\r\ndos\r\n".into(),
        encoding: Encoding::Utf16Le,
        has_bom: true,
        eol: Eol::CrLf,
        eol_mixed: false,
        version: "1c-1dc6d5f2a3b4c00-cbf29ce484222325".into(),
        len: 22,
    };
    assert_eq!(
        serde_json::to_value(document).unwrap(),
        fixture()["fs"]["text_document"]
    );
    let written = TextWritten {
        version: "1c-1dc6d5f2a3b4c10-af63bd4c8601b7df".into(),
    };
    assert_eq!(
        serde_json::to_value(written).unwrap(),
        fixture()["fs"]["text_written"]
    );
}

#[test]
fn every_encoding_and_line_ending_the_frontend_lists_is_accepted_and_none_is_missing() {
    let encodings: Vec<Encoding> = serde_json::from_value(fixture()["encodings"].clone()).unwrap();
    assert_eq!(
        encodings,
        [Encoding::Utf8, Encoding::Utf16Le, Encoding::Utf16Be]
    );
    let eols: Vec<Eol> = serde_json::from_value(fixture()["eols"].clone()).unwrap();
    assert_eq!(eols, [Eol::Lf, Eol::CrLf]);
}

#[test]
fn the_write_request_the_frontend_sends_deserializes_into_the_backend_args() {
    let request = fixture()["requests"]["write_text"].clone();
    let args: WriteTextArgs = serde_json::from_value(request).unwrap();
    assert_eq!(args.path, r"wc\notas.txt");
    assert_eq!(args.update.content, "uno\ndos\n");
    assert_eq!(args.update.encoding, Encoding::Utf8);
    assert!(!args.update.has_bom);
    assert_eq!(args.update.eol, Eol::Lf);
    assert_eq!(
        args.update.expected_version,
        "9-1dc6d5f2a3b4c00-a430d84680aabd0b"
    );
}

fn status_entry(path: &str, item: StatusItem) -> StatusEntry {
    StatusEntry {
        path: path.into(),
        item,
        props: StatusItem::None,
        revision: None,
        remote_item: None,
        remote_props: None,
        wc_locked: false,
        tree_conflicted: false,
        copied: false,
        switched: false,
        lock: None,
    }
}

#[test]
fn a_status_map_serializes_to_the_shape_the_frontend_reads() {
    let locked = StatusEntry {
        revision: Some(3),
        remote_item: Some(StatusItem::None),
        remote_props: Some(StatusItem::None),
        lock: Some(StatusLock {
            owner: "alice".into(),
            comment: None,
        }),
        ..status_entry(r"proyecto\bloqueado.txt", StatusItem::Normal)
    };
    let copied = StatusEntry {
        wc_locked: true,
        tree_conflicted: true,
        copied: true,
        switched: true,
        ..status_entry(r"proyecto\copia", StatusItem::Added)
    };
    let map = WcStatusMap {
        entries: vec![locked, copied],
        changed_folders: vec!["proyecto".into()],
        truncated: true,
        against_revision: Some(4),
    };
    assert_eq!(serde_json::to_value(map).unwrap(), fixture()["status_map"]);
}

fn ui_view() -> FolderView {
    FolderView {
        mode: ViewMode::Details,
        columns: vec![ViewColumn::Size, ViewColumn::Svn],
        sort: SortKey::Modified,
        sort_direction: SortDirection::Desc,
        updated_ms: 1_760_400_000_000,
    }
}

fn ui_tab(id: &str, kind: TabKind, path: &str, title: &str) -> Tab {
    Tab {
        id: id.into(),
        kind,
        path: path.into(),
        title: title.into(),
    }
}

#[test]
fn every_ui_state_enum_the_frontend_lists_is_accepted_and_none_is_missing() {
    let list = |key: &str| fixture()[key].clone();
    let modes: Vec<ViewMode> = serde_json::from_value(list("view_modes")).unwrap();
    assert_eq!(modes, [ViewMode::Grid, ViewMode::List, ViewMode::Details]);
    let columns: Vec<ViewColumn> = serde_json::from_value(list("view_columns")).unwrap();
    assert_eq!(
        columns,
        [
            ViewColumn::Type,
            ViewColumn::Size,
            ViewColumn::Modified,
            ViewColumn::Svn
        ]
    );
    let keys: Vec<SortKey> = serde_json::from_value(list("sort_keys")).unwrap();
    assert_eq!(
        keys,
        [
            SortKey::Name,
            SortKey::Type,
            SortKey::Size,
            SortKey::Modified,
            SortKey::Status
        ]
    );
    let directions: Vec<SortDirection> = serde_json::from_value(list("sort_directions")).unwrap();
    assert_eq!(directions, [SortDirection::Asc, SortDirection::Desc]);
    let kinds: Vec<TabKind> = serde_json::from_value(list("tab_kinds")).unwrap();
    assert_eq!(kinds, [TabKind::Folder, TabKind::Document]);
}

#[test]
fn the_ui_state_the_frontend_sends_deserializes_and_serializes_back_unchanged() {
    let request = fixture()["requests"]["ui_state_set"].clone();
    let state: UiState = serde_json::from_value(request.clone()).unwrap();
    assert_eq!(state.favorites.len(), 1);
    assert_eq!(state.tabs.len(), 2);
    assert_eq!(state.active_tab.as_deref(), Some("t2"));
    assert_eq!(state.views[r"proyecto\src"], ui_view());
    assert_eq!(serde_json::to_value(state).unwrap(), request);
}

#[test]
fn the_ui_state_view_serializes_to_the_shape_the_frontend_reads() {
    let view = UiStateView {
        version: 1,
        favorites: vec![
            located(
                Favorite {
                    path: r"proyecto\src".into(),
                    name: "Fuentes".into(),
                },
                true,
            ),
            located(
                Favorite {
                    path: "viejo".into(),
                    name: "Viejo".into(),
                },
                false,
            ),
        ],
        tabs: vec![
            located(ui_tab("t1", TabKind::Folder, "proyecto", "proyecto"), true),
            located(
                ui_tab("t2", TabKind::Document, r"proyecto\notas.md", "notas.md"),
                false,
            ),
        ],
        active_tab: Some("t2".into()),
        views: [(r"proyecto\src".to_string(), located(ui_view(), true))].into(),
    };
    assert_eq!(serde_json::to_value(view).unwrap(), fixture()["ui_state"]);
}

fn located<T>(item: T, exists: bool) -> Located<T> {
    Located { item, exists }
}

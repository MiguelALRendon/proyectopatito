#![cfg(windows)]

mod common;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use common::TestRepo;
use dakedaduck_svn_lib::svn::client::{SvnClient, SvnClientError};
use dakedaduck_svn_lib::svn::commands::{InfoRequest, StatusRequest};
use dakedaduck_svn_lib::svn::error::SvnErrorKind;
use dakedaduck_svn_lib::svn::models::{NodeKind, StatusEntry, StatusItem, StatusReport};
use dakedaduck_svn_lib::svn::parsers::{ParseError, parse_info, parse_status};
use dakedaduck_svn_lib::svn::runner::{RunOptions, SvnRunner};
use tempfile::TempDir;

const INFO_XML: &[u8] = include_bytes!("fixtures/info.xml");
const STATUS_XML: &[u8] = include_bytes!("fixtures/status.xml");
const STATUS_REMOTE_XML: &[u8] = include_bytes!("fixtures/status-remote.xml");
const WC_DIR_WITH_PEG_AND_ACCENTS: &str = "copia ñ@dir";
const NOT_A_WORKING_COPY_CODE: &str = "E155007";

fn os_args(parts: &[&str]) -> Vec<OsString> {
    parts.iter().map(OsString::from).collect()
}

fn find<'a>(report: &'a StatusReport, path: &str) -> &'a StatusEntry {
    report
        .entries
        .iter()
        .find(|entry| entry.path == path)
        .unwrap_or_else(|| panic!("no hay entrada para {path}"))
}

fn peg_safe(path: &Path) -> String {
    format!("{}@", path.to_string_lossy())
}

fn find_suffix<'a>(report: &'a StatusReport, suffix: &str) -> &'a StatusEntry {
    report
        .entries
        .iter()
        .find(|entry| entry.path.ends_with(suffix))
        .unwrap_or_else(|| panic!("no hay entrada que termine en {suffix}"))
}

async fn svn(repo: &TestRepo, args: &[&str]) {
    let runner = SvnRunner::new(repo.svn.path.clone());
    runner
        .run(&os_args(args), RunOptions::default())
        .await
        .unwrap_or_else(|error| panic!("svn {args:?} fallo: {}", error.stderr));
}

async fn checkout(repo: &TestRepo, dir: &Path) {
    svn(repo, &["checkout", &repo.url, &dir.to_string_lossy()]).await;
}

fn client(repo: &TestRepo) -> SvnClient {
    SvnClient::new(SvnRunner::new(repo.svn.path.clone()))
}

fn status_request(target: &Path, remote: bool) -> StatusRequest {
    StatusRequest {
        target: target.to_path_buf(),
        remote,
        ignored: false,
        username: None,
    }
}

#[test]
fn parse_info_rejects_empty_input() {
    assert!(matches!(parse_info(b""), Err(ParseError::Xml(_))));
}

#[test]
fn parse_info_rejects_non_xml_garbage() {
    assert!(matches!(parse_info(b"no soy xml"), Err(ParseError::Xml(_))));
}

#[test]
fn parse_info_rejects_truncated_xml() {
    let truncated = &INFO_XML[..INFO_XML.len() / 2];
    assert!(parse_info(truncated).is_err());
}

#[test]
fn parse_info_reports_missing_entry_for_empty_info_element() {
    assert!(matches!(
        parse_info(b"<info></info>"),
        Err(ParseError::MissingEntry)
    ));
}

#[test]
fn parse_status_rejects_empty_and_truncated_input() {
    assert!(parse_status(b"").is_err());
    assert!(parse_status(&STATUS_XML[..STATUS_XML.len() / 2]).is_err());
}

#[test]
fn parse_status_accepts_a_target_without_changes() {
    let report = parse_status(b"<status><target path=\".\"></target></status>").unwrap();
    assert!(report.entries.is_empty());
    assert_eq!(report.against_revision, None);
}

#[test]
fn parse_status_keeps_unknown_item_values_instead_of_failing() {
    let xml = br#"<status><target path="."><entry path="x"><wc-status item="frobnicated" props="none"></wc-status></entry></target></status>"#;
    let report = parse_status(xml).unwrap();
    assert_eq!(
        report.entries[0].item,
        StatusItem::Unknown("frobnicated".into())
    );
}

#[test]
fn parse_status_maps_negative_revision_of_added_files_to_none() {
    let report = parse_status(STATUS_XML).unwrap();
    assert_eq!(find(&report, "added.txt").revision, None);
    assert_eq!(find(&report, "del.txt").revision, Some(1));
}

#[test]
fn status_item_maps_every_known_svn_value() {
    let expected = [
        ("none", StatusItem::None),
        ("normal", StatusItem::Normal),
        ("unversioned", StatusItem::Unversioned),
        ("added", StatusItem::Added),
        ("modified", StatusItem::Modified),
        ("deleted", StatusItem::Deleted),
        ("missing", StatusItem::Missing),
        ("replaced", StatusItem::Replaced),
        ("conflicted", StatusItem::Conflicted),
        ("ignored", StatusItem::Ignored),
        ("incomplete", StatusItem::Incomplete),
        ("external", StatusItem::External),
        ("obstructed", StatusItem::Obstructed),
        ("merged", StatusItem::Merged),
    ];
    for (text, item) in expected {
        assert_eq!(StatusItem::from(text), item, "{text}");
    }
}

#[test]
fn node_kind_falls_back_to_unknown() {
    assert_eq!(NodeKind::from("symlink"), NodeKind::Unknown);
    assert_eq!(NodeKind::from("file"), NodeKind::File);
}

#[test]
fn info_args_end_with_peg_terminator_so_at_signs_in_paths_are_literal() {
    let request = InfoRequest {
        target: PathBuf::from(r"C:\svn\copia@dir"),
    };
    assert_eq!(
        request.args(),
        os_args(&["info", "--xml", r"C:\svn\copia@dir@"])
    );
}

#[test]
fn status_args_include_show_updates_only_when_remote() {
    let local = status_request(Path::new(r"C:\wc"), false).args();
    let remote = status_request(Path::new(r"C:\wc"), true).args();
    assert_eq!(local, os_args(&["status", "--xml", r"C:\wc@"]));
    assert_eq!(
        remote,
        os_args(&["status", "--xml", "--show-updates", r"C:\wc@"])
    );
}

#[test]
fn status_args_add_no_ignore_and_username_in_a_fixed_order() {
    let request = StatusRequest {
        target: PathBuf::from(r"C:\wc"),
        remote: true,
        ignored: true,
        username: Some("alice".into()),
    };
    assert_eq!(
        request.args(),
        os_args(&[
            "status",
            "--xml",
            "--show-updates",
            "--no-ignore",
            "--username",
            "alice",
            r"C:\wc@"
        ])
    );
}

#[test]
fn status_args_never_carry_a_password_or_a_depth() {
    let request = StatusRequest {
        target: PathBuf::from(r"C:\wc"),
        remote: false,
        ignored: true,
        username: Some("alice".into()),
    };
    let args = request.args();
    assert!(!args.contains(&OsString::from("--password")));
    assert!(!args.contains(&OsString::from("--depth")));
}

#[test]
fn parse_status_reads_every_entry_of_the_local_fixture() {
    let report = parse_status(STATUS_XML).unwrap();
    assert_eq!(report.entries.len(), 6);
    assert_eq!(find(&report, "added.txt").item, StatusItem::Added);
    assert_eq!(
        find(&report, "unversioned.txt").item,
        StatusItem::Unversioned
    );
    assert_eq!(find(&report, "del.txt").item, StatusItem::Deleted);
    assert_eq!(find(&report, "mod.txt").item, StatusItem::Modified);
    assert_eq!(find(&report, "mod.txt").remote_item, None);
}

#[test]
fn parse_status_reads_remote_changes_and_against_revision() {
    let report = parse_status(STATUS_REMOTE_XML).unwrap();
    assert_eq!(report.entries.len(), 7);
    assert_eq!(report.against_revision, Some(2));
    assert_eq!(
        find(&report, "conf.txt").remote_item,
        Some(StatusItem::Modified)
    );
}

#[test]
fn parse_info_reads_the_working_copy_fixture() {
    let info = parse_info(INFO_XML).unwrap();
    assert_eq!(info.kind, NodeKind::Dir);
    assert_eq!(info.revision, 1);
    assert_eq!(info.repository_root, "file:///C:/svnfx/repo");
    assert_eq!(info.working_copy_root.as_deref(), Some("C:/svnfx/wc"));
    assert_eq!(info.last_changed_author.as_deref(), Some("alice"));
}

#[tokio::test]
async fn info_on_a_plain_directory_reports_not_a_working_copy() {
    let repo = TestRepo::create();
    let plain = TempDir::new().unwrap();
    let request = InfoRequest {
        target: plain.path().to_path_buf(),
    };
    let error = client(&repo)
        .info(&request, RunOptions::default())
        .await
        .unwrap_err();
    let SvnClientError::Svn(svn_error) = error else {
        panic!("se esperaba un error de svn");
    };
    assert_eq!(svn_error.kind, SvnErrorKind::Other);
    assert!(
        svn_error
            .codes
            .contains(&NOT_A_WORKING_COPY_CODE.to_string())
    );
}

#[tokio::test]
async fn info_reads_a_working_copy_whose_path_has_accents_and_an_at_sign() {
    let repo = TestRepo::create();
    let parent = TempDir::new().unwrap();
    let wc = parent.path().join(WC_DIR_WITH_PEG_AND_ACCENTS);
    checkout(&repo, &wc).await;
    let request = InfoRequest { target: wc };
    let info = client(&repo)
        .info(&request, RunOptions::default())
        .await
        .unwrap();
    assert_eq!(info.kind, NodeKind::Dir);
    assert_eq!(info.revision, 0);
    assert!(!info.repository_uuid.is_empty());
}

#[tokio::test]
async fn status_sees_unversioned_then_added_then_modified_files() {
    let repo = TestRepo::create();
    let parent = TempDir::new().unwrap();
    let wc = parent.path().join(WC_DIR_WITH_PEG_AND_ACCENTS);
    checkout(&repo, &wc).await;
    let file = wc.join("nota ñ.txt");
    fs::write(&file, "uno").unwrap();
    let client = client(&repo);
    let local = status_request(&wc, false);
    let report = client.status(&local, RunOptions::default()).await.unwrap();
    assert_eq!(
        find_suffix(&report, "nota ñ.txt").item,
        StatusItem::Unversioned
    );
    svn(&repo, &["add", &peg_safe(&file)]).await;
    let report = client.status(&local, RunOptions::default()).await.unwrap();
    assert_eq!(find_suffix(&report, "nota ñ.txt").item, StatusItem::Added);
    svn(&repo, &["commit", "-m", "alta", &peg_safe(&wc)]).await;
    fs::write(&file, "dos").unwrap();
    let report = client.status(&local, RunOptions::default()).await.unwrap();
    assert_eq!(
        find_suffix(&report, "nota ñ.txt").item,
        StatusItem::Modified
    );
}

#[tokio::test]
async fn remote_status_reports_a_file_added_by_another_working_copy() {
    let repo = TestRepo::create();
    let parent = TempDir::new().unwrap();
    let (mine, other) = (parent.path().join("mia"), parent.path().join("otra"));
    checkout(&repo, &mine).await;
    checkout(&repo, &other).await;
    let remote_file = other.join("remoto.txt");
    fs::write(&remote_file, "x").unwrap();
    svn(&repo, &["add", &peg_safe(&remote_file)]).await;
    svn(&repo, &["commit", "-m", "remoto", &peg_safe(&other)]).await;
    let report = client(&repo)
        .status(&status_request(&mine, true), RunOptions::default())
        .await
        .unwrap();
    assert_eq!(report.against_revision, Some(1));
    assert_eq!(
        find_suffix(&report, "remoto.txt").remote_item,
        Some(StatusItem::Added)
    );
}

#[test]
fn status_item_serializes_known_and_unknown_values_as_plain_strings() {
    let known = serde_json::to_string(&StatusItem::Added).unwrap();
    let unknown = serde_json::to_string(&StatusItem::Unknown("frobnicated".into())).unwrap();
    assert_eq!(known, "\"added\"");
    assert_eq!(unknown, "\"frobnicated\"");
}

#[test]
fn status_item_round_trips_through_its_text_form() {
    for text in ["none", "normal", "conflicted", "merged", "frobnicated"] {
        assert_eq!(StatusItem::from(text).as_str(), text);
    }
}

const STATES_XML: &[u8] = include_bytes!("fixtures/status-states.xml");
const TREE_CONFLICT_XML: &[u8] = include_bytes!("fixtures/status-tree-conflict-remote-lock.xml");
const WC_LOCKED_XML: &[u8] = include_bytes!("fixtures/status-wc-locked.xml");

#[test]
fn parse_status_reads_every_state_svn_produced_for_the_real_scenario() {
    let report = parse_status(STATES_XML).unwrap();
    let expected = [
        ("add.txt", StatusItem::Added),
        ("conf.txt", StatusItem::Conflicted),
        ("del.txt", StatusItem::Deleted),
        ("extsrc", StatusItem::External),
        ("x.tmp", StatusItem::Ignored),
        ("lock.txt", StatusItem::Normal),
        ("miss.txt", StatusItem::Missing),
        ("mod.txt", StatusItem::Modified),
        ("repl.txt", StatusItem::Replaced),
        ("src-copia", StatusItem::Added),
        ("swd", StatusItem::Normal),
        ("type.txt", StatusItem::Obstructed),
        ("unv.txt", StatusItem::Unversioned),
    ];
    for (suffix, item) in expected {
        assert_eq!(find_suffix(&report, suffix).item, item, "{suffix}");
    }
}

#[test]
fn parse_status_reads_the_lock_copied_and_switched_flags_of_the_real_scenario() {
    let report = parse_status(STATES_XML).unwrap();
    let lock = find_suffix(&report, "lock.txt").lock.clone().unwrap();
    assert_eq!(lock.comment.as_deref(), Some("mi bloqueo"));
    assert!(!lock.owner.is_empty());
    assert!(find_suffix(&report, "src-copia").copied);
    assert!(find_suffix(&report, "swd").switched);
    assert!(!find_suffix(&report, "mod.txt").copied);
    assert!(find_suffix(&report, "mod.txt").lock.is_none());
}

#[test]
fn parse_status_reads_a_tree_conflict_and_a_lock_held_by_someone_else() {
    let report = parse_status(TREE_CONFLICT_XML).unwrap();
    let tree = find_suffix(&report, "tree.txt");
    assert!(tree.tree_conflicted && tree.copied);
    let shared = find_suffix(&report, "shared.txt");
    assert_eq!(shared.remote_item, Some(StatusItem::None));
    assert_eq!(
        shared.lock.clone().unwrap().comment.as_deref(),
        Some("ajeno")
    );
    assert!(!shared.tree_conflicted);
}

#[test]
fn parse_status_reads_the_working_copy_lock_left_by_an_interrupted_command() {
    let report = parse_status(WC_LOCKED_XML).unwrap();
    assert!(find_suffix(&report, r"svnfx\wc").wc_locked);
    assert!(!find_suffix(&report, "shared.txt").wc_locked);
}

#[test]
fn parse_status_defaults_the_new_flags_to_false_when_svn_omits_them() {
    let report = parse_status(STATUS_XML).unwrap();
    for entry in &report.entries {
        let flags = [
            entry.wc_locked,
            entry.tree_conflicted,
            entry.copied,
            entry.switched,
        ];
        assert_eq!(flags, [false; 4], "{}", entry.path);
        assert!(entry.lock.is_none());
    }
}

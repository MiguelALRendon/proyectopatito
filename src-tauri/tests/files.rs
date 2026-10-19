#![cfg(windows)]

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use dakedaduck_svn_lib::app::error::{CommandError, CommandErrorKind};
use dakedaduck_svn_lib::app::files::{
    DirListing, EntryKind, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_ATTRIBUTE_RECALL_ON_OPEN, FileEntry, FileError, FileFacts, FileService, is_cloud_only,
    probe_facts,
};
use dakedaduck_svn_lib::app::sniff::{ProbeKind, SNIFF_BYTES};
use dakedaduck_svn_lib::app::workspace::{Workspace, WorkspaceError};
use tempfile::TempDir;

const PNG_HEADER: [u8; 33] = [
    0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89,
];
const FAKE_BITMAP: &[u8] = b"BM\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
const MISSING_ATTRIBUTES: u32 = 0;
const ALLOW_SKIPPED_ENV_VAR: &str = "DAKEDADUCK_ALLOW_SKIPPED_ENV_TESTS";
const ALLOW_SKIPPED_ENV_VALUE: &str = "1";

fn is_skip_allowed(value: Option<&std::ffi::OsStr>) -> bool {
    value.is_some_and(|value| value == ALLOW_SKIPPED_ENV_VALUE)
}

fn skip_unavailable_environment(reason: &str) {
    let value = std::env::var_os(ALLOW_SKIPPED_ENV_VAR);
    assert!(
        is_skip_allowed(value.as_deref()),
        "{reason}: la prueba no puede verificar nada; use un entorno que lo permita o          defina {ALLOW_SKIPPED_ENV_VAR}={ALLOW_SKIPPED_ENV_VALUE} para saltarla"
    );
    eprintln!("{reason}: prueba saltada por {ALLOW_SKIPPED_ENV_VAR}");
}

#[test]
fn a_test_may_be_skipped_only_when_the_opt_out_variable_is_exactly_one() {
    use std::ffi::OsStr;
    assert!(!is_skip_allowed(None));
    assert!(!is_skip_allowed(Some(OsStr::new("0"))));
    assert!(!is_skip_allowed(Some(OsStr::new(""))));
    assert!(is_skip_allowed(Some(OsStr::new("1"))));
}

struct Fixture {
    _guard: TempDir,
    parent: PathBuf,
    root: PathBuf,
    service: FileService,
}

fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

fn fixture_with_limit(max_entries: Option<usize>) -> Fixture {
    let guard = tempfile::tempdir().unwrap();
    let parent = plain_path(fs::canonicalize(guard.path()).unwrap());
    let root = parent.join("svn");
    fs::create_dir(&root).unwrap();
    let workspace = Workspace::new(&root).unwrap();
    let service = FileService::new(workspace, Arc::default());
    let service = match max_entries {
        Some(limit) => service.with_max_entries(limit),
        None => service,
    };
    Fixture {
        _guard: guard,
        parent,
        root,
        service,
    }
}

fn fixture() -> Fixture {
    fixture_with_limit(None)
}

impl Fixture {
    fn list(&self, relative: &str) -> Result<DirListing, FileError> {
        let dir = self.service.scope(Path::new(relative))?;
        self.service.list(&dir)
    }

    fn probe(
        &self,
        relative: &str,
    ) -> Result<dakedaduck_svn_lib::app::files::FileProbe, FileError> {
        let file = self.service.scope(Path::new(relative))?;
        self.service.probe(&file, false)
    }

    fn write(&self, relative: &str, content: &[u8]) {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
}

fn run_cmd(args: &[&str]) -> bool {
    Command::new("cmd")
        .arg("/C")
        .args(args)
        .output()
        .unwrap()
        .status
        .success()
}

fn make_junction(link: &Path, target: &Path) {
    let created = run_cmd(&[
        "mklink",
        "/J",
        &link.to_string_lossy(),
        &target.to_string_lossy(),
    ]);
    assert!(created, "no se pudo crear la junction de prueba");
}

fn hide(path: &Path) {
    assert!(run_cmd(&["attrib", "+h", &path.to_string_lossy()]));
}

fn mark_offline(path: &Path) {
    let script = format!(
        "$item = Get-Item -LiteralPath '{}'; $item.Attributes = $item.Attributes -bor 'Offline'",
        path.to_string_lossy()
    );
    let marked = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .unwrap()
        .status
        .success();
    assert!(marked, "no se pudo marcar el atributo OFFLINE");
}

fn make_read_only(path: &Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions).unwrap();
}

fn names(listing: &DirListing) -> Vec<String> {
    let mut names: Vec<_> = listing.entries.iter().map(|e| e.name.clone()).collect();
    names.sort();
    names
}

fn short_name_of(parent: &Path, long_name: &str) -> Option<String> {
    let output = Command::new("cmd")
        .arg("/C")
        .args(["dir", "/x", "/a"])
        .arg(parent)
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.lines()
        .filter(|line| line.trim_end().ends_with(long_name))
        .filter_map(|line| line.split_whitespace().rev().nth(1).map(str::to_owned))
        .find(|candidate| candidate.contains('~'))
}

fn entry_named<'a>(listing: &'a DirListing, name: &str) -> &'a FileEntry {
    listing.entries.iter().find(|e| e.name == name).unwrap()
}

fn fixture_with_admin_dirs() -> Fixture {
    let fixture = fixture();
    fixture.write(r".svn\wc.db", b"sqlite");
    fixture.write(r"_svn\wc.db", b"sqlite");
    fixture.write(r"wc\sub\.svn\entries", b"x");
    fixture
}

fn outside_workspace(result: Result<DirListing, FileError>) -> bool {
    matches!(
        result,
        Err(FileError::Workspace(WorkspaceError::OutsideWorkspace))
    )
}

#[test]
fn a_parent_directory_component_is_rejected_before_touching_the_disk() {
    let fixture = fixture();
    for escaping in [r"..", r"..\fuera", r"sub\..\..\fuera"] {
        let result = fixture.service.scope(Path::new(escaping));
        assert!(
            matches!(
                result,
                Err(FileError::Workspace(WorkspaceError::ParentTraversal))
            ),
            "{escaping}"
        );
    }
}

#[test]
fn an_absolute_path_outside_the_root_is_rejected() {
    let fixture = fixture();
    fs::create_dir(fixture.parent.join("fuera")).unwrap();
    assert!(outside_workspace(
        fixture.list(&fixture.parent.join("fuera").to_string_lossy())
    ));
}

#[test]
fn a_junction_that_escapes_the_root_is_neither_navigable_nor_hidden_in_the_listing() {
    let fixture = fixture();
    let outside = fixture.parent.join("fuera");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secreto.txt"), "x").unwrap();
    make_junction(&fixture.root.join("salida"), &outside);
    assert!(outside_workspace(fixture.list("salida")));
    assert!(matches!(
        fixture.probe(r"salida\secreto.txt"),
        Err(FileError::Workspace(WorkspaceError::OutsideWorkspace))
    ));
    let entry = &fixture.list("").unwrap().entries[0];
    assert_eq!(entry.name, "salida");
    assert!(entry.is_link && entry.escapes_workspace);
    assert_eq!(entry.kind, EntryKind::Dir);
}

#[test]
fn a_junction_that_stays_inside_the_root_is_a_navigable_link() {
    let fixture = fixture();
    fixture.write(r"real\a.txt", b"a");
    make_junction(&fixture.root.join("atajo"), &fixture.root.join("real"));
    let root_listing = fixture.list("").unwrap();
    let shortcut = entry_named(&root_listing, "atajo");
    assert!(shortcut.is_link && !shortcut.escapes_workspace);
    assert_eq!(names(&fixture.list("atajo").unwrap()), ["a.txt"]);
}

#[test]
fn a_symlink_that_escapes_the_root_is_rejected_when_the_system_allows_creating_it() {
    let fixture = fixture();
    let outside = fixture.parent.join("fuera");
    fs::create_dir(&outside).unwrap();
    let link = fixture.root.join("simbolico");
    if std::os::windows::fs::symlink_dir(&outside, &link).is_err() {
        skip_unavailable_environment("sin privilegio para crear symlinks");
        return;
    }
    assert!(outside_workspace(fixture.list("simbolico")));
    let entry = &fixture.list("").unwrap().entries[0];
    assert!(entry.is_link && entry.escapes_workspace);
}

#[test]
fn svn_administrative_directories_are_forbidden_in_any_casing() {
    let fixture = fixture_with_admin_dirs();
    for forbidden in [
        ".svn",
        ".SVN",
        ".Svn",
        "_svn",
        "_SVN",
        r"wc\sub\.svn",
        r".svn\pristine",
    ] {
        assert!(
            matches!(fixture.list(forbidden), Err(FileError::ForbiddenPath)),
            "{forbidden}"
        );
    }
}

#[test]
fn files_inside_svn_administrative_directories_are_forbidden_in_any_casing() {
    let fixture = fixture_with_admin_dirs();
    for forbidden in [
        r".svn\wc.db",
        r".SVN\wc.db",
        r"_svn\wc.db",
        r"wc\sub\.svn\entries",
    ] {
        assert!(
            matches!(fixture.probe(forbidden), Err(FileError::ForbiddenPath)),
            "{forbidden}"
        );
    }
}

#[test]
fn forbidden_paths_are_reported_to_the_frontend_with_their_own_error_kind() {
    let fixture = fixture();
    fixture.write(r".svn\wc.db", b"sqlite");
    let error = CommandError::from(fixture.list(".svn").unwrap_err());
    assert_eq!(error.kind, CommandErrorKind::ForbiddenPath);
    let file = fixture.root.join("archivo.txt");
    fs::write(&file, "x").unwrap();
    let error = CommandError::from(fixture.list("archivo.txt").unwrap_err());
    assert_eq!(error.kind, CommandErrorKind::NotADirectory);
}

#[test]
fn the_8_3_short_name_of_svn_is_expanded_and_forbidden() {
    let fixture = fixture();
    fixture.write(r"wc\.svn\wc.db", b"sqlite");
    let Some(short) = short_name_of(&fixture.root.join("wc"), ".svn") else {
        skip_unavailable_environment("el volumen de pruebas no genera nombres cortos 8.3");
        return;
    };
    assert!(matches!(
        fixture.list(&format!(r"wc\{short}")),
        Err(FileError::ForbiddenPath)
    ));
    assert!(matches!(
        fixture.probe(&format!(r"wc\{short}\wc.db")),
        Err(FileError::ForbiddenPath)
    ));
}

#[test]
fn a_junction_pointing_at_the_svn_directory_inside_the_root_is_forbidden() {
    let fixture = fixture();
    fixture.write(r"wc\.svn\wc.db", b"sqlite");
    make_junction(
        &fixture.root.join("inocente"),
        &fixture.root.join("wc").join(".svn"),
    );
    assert!(matches!(
        fixture.list("inocente"),
        Err(FileError::ForbiddenPath)
    ));
    assert!(matches!(
        fixture.probe(r"inocente\wc.db"),
        Err(FileError::ForbiddenPath)
    ));
}

#[test]
fn the_listing_never_includes_svn_directories_even_when_hidden_ones_exist() {
    let fixture = fixture();
    fixture.write(r".svn\wc.db", b"sqlite");
    fixture.write(r"_svn\wc.db", b"sqlite");
    fixture.write("visible.txt", b"v");
    fixture.write("oculto.txt", b"o");
    hide(&fixture.root.join(".svn"));
    hide(&fixture.root.join("oculto.txt"));
    let listing = fixture.list("").unwrap();
    assert_eq!(names(&listing), ["oculto.txt", "visible.txt"]);
    let hidden = entry_named(&listing, "oculto.txt");
    assert!(hidden.hidden);
}

#[test]
fn an_orphan_temporary_file_left_by_a_hard_failure_is_not_listed() {
    let fixture = fixture();
    fixture.write("notas.txt", b"v");
    fixture.write("notas.txt.4242-7.dd-tmp", b"a medias");
    let listing = fixture.list("").unwrap();
    assert_eq!(names(&listing), ["notas.txt"]);
}

#[test]
fn a_binary_named_md_or_txt_is_not_classified_as_text() {
    let fixture = fixture();
    fixture.write("falso.md", &PNG_HEADER[..16]);
    fixture.write("programa.txt", b"MZ\x90\x00\x03\x00\x00\x00 ejecutable");
    fixture.write("nulo.md", b"# titulo\n\x00\x01\x02");
    for name in ["falso.md", "programa.txt", "nulo.md"] {
        assert_eq!(
            fixture.probe(name).unwrap().kind,
            ProbeKind::Binary,
            "{name}"
        );
    }
}

#[test]
fn a_file_starting_with_bm_but_without_a_coherent_header_is_not_an_image() {
    let fixture = fixture();
    fixture.write("falso.bmp", FAKE_BITMAP);
    fixture.write("nota.txt", b"BM: informe mensual");
    assert_eq!(fixture.probe("falso.bmp").unwrap().kind, ProbeKind::Binary);
    assert_eq!(fixture.probe("nota.txt").unwrap().kind, ProbeKind::Text);
}

#[test]
fn a_directory_with_more_entries_than_the_limit_is_truncated_and_says_so() {
    let fixture = fixture_with_limit(Some(3));
    for index in 0..5 {
        fixture.write(&format!("f{index}.txt"), b"x");
    }
    let listing = fixture.list("").unwrap();
    assert_eq!(listing.entries.len(), 3);
    assert!(listing.truncated);
}

#[test]
fn a_directory_with_exactly_the_limit_is_not_truncated() {
    let fixture = fixture_with_limit(Some(3));
    for index in 0..3 {
        fixture.write(&format!("f{index}.txt"), b"x");
    }
    fixture.write(r".svn\wc.db", b"sqlite");
    let listing = fixture.list("").unwrap();
    assert_eq!(listing.entries.len(), 3);
    assert!(!listing.truncated);
}

#[test]
fn listing_a_file_fails_with_not_a_directory() {
    let fixture = fixture();
    fixture.write("archivo.txt", b"x");
    assert!(matches!(
        fixture.list("archivo.txt"),
        Err(FileError::NotADirectory)
    ));
    assert!(fixture.list(r"archivo.txt\hijo").is_err());
}

#[test]
fn an_entry_dated_before_the_unix_epoch_is_listed_without_a_modified_time() {
    let fixture = fixture();
    fixture.write("antiguo.txt", b"x");
    fixture.write("reciente.txt", b"x");
    let before_epoch = UNIX_EPOCH - Duration::from_secs(86_400);
    OpenOptions::new()
        .write(true)
        .open(fixture.root.join("antiguo.txt"))
        .unwrap()
        .set_modified(before_epoch)
        .unwrap();
    let listing = fixture.list("").unwrap();
    assert_eq!(entry_named(&listing, "antiguo.txt").modified_ms, None);
    assert!(entry_named(&listing, "reciente.txt").modified_ms.is_some());
}

#[test]
fn listing_a_missing_directory_is_an_io_error_and_probing_a_directory_is_not_a_file() {
    let fixture = fixture();
    fixture.write(r"carpeta\a.txt", b"x");
    assert!(matches!(fixture.list("no-existe"), Err(FileError::Io(_))));
    assert!(matches!(fixture.probe("carpeta"), Err(FileError::NotAFile)));
    assert!(matches!(
        fixture.probe("no-existe.txt"),
        Err(FileError::Io(_))
    ));
}

#[test]
fn an_empty_file_is_empty_text() {
    let fixture = fixture();
    fixture.write("vacio.txt", b"");
    let probe = fixture.probe("vacio.txt").unwrap();
    assert_eq!((probe.kind, probe.len), (ProbeKind::Text, 0));
}

#[test]
fn an_8_kib_sample_cut_in_the_middle_of_a_utf8_character_is_still_text() {
    let fixture = fixture();
    let mut content = vec![b'a'; SNIFF_BYTES - 1];
    content.extend_from_slice("éñ".as_bytes());
    fixture.write("corte.txt", &content);
    let probe = fixture.probe("corte.txt").unwrap();
    assert_eq!(probe.kind, ProbeKind::Text);
    assert_eq!(probe.len, content.len() as u64);
}

#[test]
fn a_file_that_really_ends_in_half_a_utf8_character_is_binary() {
    let fixture = fixture();
    fixture.write("mocho.txt", &[b'a', 0xC3]);
    assert_eq!(fixture.probe("mocho.txt").unwrap().kind, ProbeKind::Binary);
}

#[test]
fn a_nul_after_the_first_8_kib_is_not_seen_by_the_probe() {
    let fixture = fixture();
    let mut content = vec![b'a'; SNIFF_BYTES];
    content.push(0);
    fixture.write("tardio.txt", &content);
    let probe = fixture.probe("tardio.txt").unwrap();
    assert_eq!(
        (probe.kind, probe.len),
        (ProbeKind::Text, content.len() as u64)
    );
}

#[test]
fn a_cloud_only_file_is_reported_with_its_size_without_reading_a_single_byte() {
    let never_created = Path::new(r"Z:\no\existe\nube.docx");
    for attributes in [
        FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
        FILE_ATTRIBUTE_RECALL_ON_OPEN,
        FILE_ATTRIBUTE_OFFLINE,
    ] {
        let facts = FileFacts {
            len: 4096,
            attributes,
        };
        let probe = probe_facts(never_created, facts, false).unwrap();
        assert_eq!(
            (probe.kind, probe.len),
            (ProbeKind::Cloud, 4096),
            "{attributes:#x}"
        );
    }
}

#[test]
fn allowing_the_download_makes_the_probe_read_the_cloud_only_file() {
    let facts = FileFacts {
        len: 4096,
        attributes: FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    };
    assert!(probe_facts(Path::new(r"Z:\no\existe\nube.docx"), facts, true).is_err());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("hidratado.txt");
    fs::write(&file, "hola").unwrap();
    let probe = probe_facts(&file, FileFacts { len: 4, ..facts }, true).unwrap();
    assert_eq!(probe.kind, ProbeKind::Text);
}

#[test]
fn only_the_recall_and_offline_attributes_mark_a_file_as_cloud_only() {
    assert!(!is_cloud_only(MISSING_ATTRIBUTES));
    assert!(!is_cloud_only(0x1 | 0x2 | 0x20));
    assert!(is_cloud_only(FILE_ATTRIBUTE_OFFLINE | 0x20));
}

#[test]
fn a_copy_root_is_found_climbing_from_any_depth_up_to_the_workspace_root() {
    let fixture = fixture();
    fixture.write(r"wc\.svn\wc.db", b"sqlite");
    fixture.write(r"wc\a\b\c.txt", b"c");
    fixture.write(r"suelta\d.txt", b"d");
    let root = fixture.list("wc").unwrap().wc.unwrap();
    assert_eq!((root.root.as_str(), root.is_root), ("wc", true));
    let nested = fixture.list(r"wc\a\b").unwrap().wc.unwrap();
    assert_eq!((nested.root.as_str(), nested.is_root), ("wc", false));
    assert_eq!(fixture.list("suelta").unwrap().wc, None);
    assert_eq!(fixture.list("").unwrap().wc, None);
}

#[test]
fn a_copy_rooted_at_the_workspace_root_is_found_from_the_root_and_from_below() {
    let fixture = fixture();
    fixture.write(r".svn\wc.db", b"sqlite");
    fixture.write(r"sub\a.txt", b"a");
    let root = fixture.list("").unwrap().wc.unwrap();
    assert_eq!((root.root.as_str(), root.is_root), ("", true));
    let below = fixture.list("sub").unwrap().wc.unwrap();
    assert_eq!((below.root.as_str(), below.is_root), ("", false));
}

#[test]
fn a_copy_whose_root_is_above_the_workspace_root_is_not_detected() {
    let fixture = fixture();
    fs::create_dir(fixture.parent.join(".svn")).unwrap();
    fixture.write(r"dentro\a.txt", b"a");
    assert_eq!(fixture.list("dentro").unwrap().wc, None);
    assert_eq!(fixture.list("").unwrap().wc, None);
}

#[test]
fn listing_a_folder_returns_the_metadata_the_explorer_needs() {
    let fixture = fixture();
    fixture.write("nota.txt", "línea ñandú".as_bytes());
    fixture.write(r"carpeta\hijo.txt", b"h");
    make_read_only(&fixture.root.join("nota.txt"));
    let listing = fixture.list("").unwrap();
    assert_eq!(listing.path, "");
    assert!(!listing.truncated && listing.wc.is_none());
    assert_eq!(names(&listing), ["carpeta", "nota.txt"]);
    let note = entry_named(&listing, "nota.txt");
    assert_eq!(
        (note.kind, note.size),
        (EntryKind::File, "línea ñandú".len() as u64)
    );
    assert!(note.read_only && !note.hidden && !note.is_link && !note.cloud_only);
    assert!(note.modified_ms.is_some_and(|millis| millis > 0));
    let folder = entry_named(&listing, "carpeta");
    assert_eq!((folder.kind, folder.size), (EntryKind::Dir, 0));
    assert_eq!(fixture.list("carpeta").unwrap().path, "carpeta");
}

#[test]
fn only_a_file_with_the_offline_attribute_is_listed_as_cloud_only() {
    let fixture = fixture();
    fixture.write("nube.txt", b"remoto");
    fixture.write("local.txt", b"local");
    fixture.write(r"carpeta\hijo.txt", b"h");
    mark_offline(&fixture.root.join("nube.txt"));
    mark_offline(&fixture.root.join("carpeta"));
    let listing = fixture.list("").unwrap();
    assert!(entry_named(&listing, "nube.txt").cloud_only);
    assert!(!entry_named(&listing, "local.txt").cloud_only);
    let folder = entry_named(&listing, "carpeta");
    assert_eq!(folder.kind, EntryKind::Dir);
    assert!(!folder.cloud_only);
}

#[test]
fn probing_files_returns_their_kind_mime_and_extension() {
    let fixture = fixture();
    fixture.write("nota.txt", "línea ñandú".as_bytes());
    fixture.write("logo.png", &PNG_HEADER);
    fixture.write("manual.pdf", b"%PDF-1.7\n1 0 obj");
    let logo = fixture.probe("logo.png").unwrap();
    assert_eq!(
        (logo.kind, logo.mime, logo.extension),
        (ProbeKind::Image, "image/png", Some("png"))
    );
    assert_eq!(fixture.probe("manual.pdf").unwrap().kind, ProbeKind::Pdf);
    assert_eq!(fixture.probe("nota.txt").unwrap().kind, ProbeKind::Text);
}

#![cfg(windows)]

mod common;

use std::fs::{self, OpenOptions};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use common::containers::docx;
use dakedaduck_svn_lib::app::files::{
    FileError, FileProbe, FileService, MAX_OFFICE_BYTES, TextWritten,
};
use dakedaduck_svn_lib::app::operations::OperationManager;
use dakedaduck_svn_lib::app::sniff::ProbeKind;
use dakedaduck_svn_lib::app::workspace::Workspace;
use tempfile::TempDir;

const FILE_SHARE_READ: u32 = 1;
const HIDDEN_AND_SYSTEM: u32 = 0x2 | 0x4;
const REPORT: &str = "informe.docx";
const WORKING_COPY: &str = "copia";
const SVN_DIR: &str = ".svn";
const TEMP_SUFFIX: &str = ".dd-tmp";

struct Fixture {
    _guard: TempDir,
    root: PathBuf,
    manager: Arc<OperationManager>,
    service: FileService,
}

fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

fn fixture() -> Fixture {
    let guard = tempfile::tempdir().unwrap();
    let root = plain_path(fs::canonicalize(guard.path()).unwrap()).join("svn");
    fs::create_dir(&root).unwrap();
    let manager = Arc::new(OperationManager::default());
    let service = FileService::new(Workspace::new(&root).unwrap(), manager.clone());
    Fixture {
        _guard: guard,
        root,
        manager,
        service,
    }
}

impl Fixture {
    fn put(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }

    fn probe(&self, relative: &str) -> Result<FileProbe, FileError> {
        self.service
            .probe(&self.service.scope(Path::new(relative))?, false)
    }

    fn version(&self, relative: &str) -> String {
        self.probe(relative).unwrap().version.unwrap()
    }

    fn write(&self, relative: &str, version: &str, bytes: &[u8]) -> Result<TextWritten, FileError> {
        self.service
            .write_bytes(&self.service.scope(Path::new(relative))?, version, bytes)
    }

    fn names_in(&self, relative: &str) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(self.root.join(relative))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn working_copy_with(&self, file: &str, bytes: &[u8]) -> String {
        fs::create_dir_all(self.root.join(WORKING_COPY).join(SVN_DIR)).unwrap();
        let relative = format!(r"{WORKING_COPY}\{file}");
        self.put(&relative, bytes);
        relative
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

fn make_read_only(path: &Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions).unwrap();
}

#[test]
fn a_stale_version_is_a_conflict_and_the_file_is_untouched() {
    let fx = fixture();
    let original = docx(&[]);
    let path = fx.put(REPORT, &original);
    let outcome = fx.write(REPORT, "0-0-0000000000000000", b"nuevo");
    assert!(matches!(outcome, Err(FileError::FileChanged)));
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(fx.names_in(""), [REPORT]);
}

#[test]
fn a_read_only_file_is_refused_and_left_untouched() {
    let fx = fixture();
    let original = docx(&[]);
    let path = fx.put(REPORT, &original);
    let version = fx.version(REPORT);
    make_read_only(&path);
    let outcome = fx.write(REPORT, &version, b"nuevo");
    assert!(matches!(outcome, Err(FileError::ReadOnly)));
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn a_file_held_open_by_another_process_is_locked_and_leaves_no_temp() {
    let fx = fixture();
    let original = docx(&[]);
    let path = fx.put(REPORT, &original);
    let version = fx.version(REPORT);
    let _held = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&path)
        .unwrap();
    let outcome = fx.write(REPORT, &version, b"nuevo");
    assert!(matches!(outcome, Err(FileError::FileLocked)));
    assert_eq!(fx.names_in(""), [REPORT]);
}

#[tokio::test]
async fn an_update_in_progress_on_the_working_copy_blocks_the_write_until_it_ends() {
    let fx = fixture();
    let relative = fx.working_copy_with(REPORT, &docx(&[]));
    let version = fx.version(&relative);
    let update = fx.manager.lock_working_copy(&fx.root).await;
    let blocked = fx.write(&relative, &version, b"nuevo");
    assert!(matches!(blocked, Err(FileError::Busy(_))));
    assert_eq!(fs::read(fx.root.join(&relative)).unwrap(), docx(&[]));
    drop(update);
    assert!(fx.write(&relative, &version, b"nuevo").is_ok());
}

#[test]
fn writing_to_a_missing_target_creates_nothing() {
    let fx = fixture();
    let outcome = fx.write("no-existe.docx", "0-0-0", b"nuevo");
    assert!(outcome.is_err());
    assert!(fx.names_in("").is_empty());
}

#[test]
fn writing_to_a_folder_is_refused() {
    let fx = fixture();
    fs::create_dir(fx.root.join("carpeta.docx")).unwrap();
    let outcome = fx.write("carpeta.docx", "0-0-0", b"nuevo");
    assert!(matches!(outcome, Err(FileError::NotAFile)));
}

#[test]
fn a_file_swapped_for_a_junction_after_scoping_is_not_written() {
    let fx = fixture();
    let path = fx.put(REPORT, &docx(&[]));
    let scoped = fx.service.scope(Path::new(REPORT)).unwrap();
    fs::remove_file(&path).unwrap();
    let target = fx.root.join("destino");
    fs::create_dir(&target).unwrap();
    let link = run_cmd(&[
        "mklink",
        "/J",
        &path.to_string_lossy(),
        &target.to_string_lossy(),
    ]);
    assert!(link);
    let outcome = fx.service.write_bytes(&scoped, "0-0-0", b"nuevo");
    assert!(matches!(outcome, Err(FileError::NotAFile)));
    assert!(fx.names_in("destino").is_empty());
}

#[test]
fn the_subversion_admin_folders_and_outside_paths_are_refused() {
    let fx = fixture();
    fx.put(r".svn\wc.docx", b"secreto");
    assert!(matches!(
        fx.write(r".svn\wc.docx", "0-0-0", b"x"),
        Err(FileError::ForbiddenPath)
    ));
    assert!(fx.write(r"..\fuera.docx", "0-0-0", b"x").is_err());
}

#[test]
fn bytes_over_the_office_limit_are_refused_before_touching_the_file() {
    let fx = fixture();
    let original = docx(&[]);
    let path = fx.put(REPORT, &original);
    let version = fx.version(REPORT);
    let too_big = vec![0u8; MAX_OFFICE_BYTES as usize + 1];
    let outcome = fx.write(REPORT, &version, &too_big);
    assert!(matches!(outcome, Err(FileError::OfficeTooLarge)));
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn bytes_exactly_at_the_office_limit_are_written() {
    let fx = fixture();
    fx.put(REPORT, &docx(&[]));
    let version = fx.version(REPORT);
    let exact = vec![7u8; MAX_OFFICE_BYTES as usize];
    assert!(fx.write(REPORT, &version, &exact).is_ok());
    assert_eq!(
        fs::metadata(fx.root.join(REPORT)).unwrap().len(),
        MAX_OFFICE_BYTES
    );
}

#[test]
fn a_file_that_grew_past_the_office_limit_is_a_conflict_not_a_crash() {
    let fx = fixture();
    let path = fx.put(REPORT, &docx(&[]));
    let version = fx.version(REPORT);
    fs::write(&path, vec![1u8; MAX_OFFICE_BYTES as usize + 1]).unwrap();
    let outcome = fx.write(REPORT, &version, b"nuevo");
    assert!(matches!(outcome, Err(FileError::FileChanged)));
}

#[test]
fn a_successful_write_replaces_the_content_and_returns_the_fresh_version() {
    let fx = fixture();
    fx.put(REPORT, &docx(&[]));
    let first = fx.version(REPORT);
    let replacement = docx(&[("word/media/a.png", b"png")]);
    let written = fx.write(REPORT, &first, &replacement).unwrap();
    assert_eq!(fs::read(fx.root.join(REPORT)).unwrap(), replacement);
    assert_eq!(fx.version(REPORT), written.version);
    assert_ne!(written.version, first);
    assert_eq!(fx.names_in(""), [REPORT]);
}

#[test]
fn a_second_save_with_the_old_version_is_a_conflict() {
    let fx = fixture();
    fx.put(REPORT, &docx(&[]));
    let first = fx.version(REPORT);
    fx.write(REPORT, &first, b"uno").unwrap();
    let again = fx.write(REPORT, &first, b"dos");
    assert!(matches!(again, Err(FileError::FileChanged)));
    assert_eq!(fs::read(fx.root.join(REPORT)).unwrap(), b"uno");
}

#[test]
fn a_write_keeps_the_hidden_and_system_attributes_of_the_original() {
    let fx = fixture();
    let path = fx.put(REPORT, &docx(&[]));
    assert!(run_cmd(&["attrib", "+H", "+S", &path.to_string_lossy()]));
    let version = fx.version(REPORT);
    fx.write(REPORT, &version, b"nuevo").unwrap();
    let attributes = fs::metadata(&path).unwrap().file_attributes();
    assert_eq!(attributes & HIDDEN_AND_SYSTEM, HIDDEN_AND_SYSTEM);
}

#[test]
fn a_write_does_not_hide_a_file_that_was_visible() {
    let fx = fixture();
    let path = fx.put(REPORT, &docx(&[]));
    let version = fx.version(REPORT);
    fx.write(REPORT, &version, b"nuevo").unwrap();
    let attributes = fs::metadata(&path).unwrap().file_attributes();
    assert_eq!(attributes & HIDDEN_AND_SYSTEM, 0);
}

#[test]
fn a_failed_write_never_leaves_a_temporary_file_behind() {
    let fx = fixture();
    fx.put(REPORT, &docx(&[]));
    let _ = fx.write(REPORT, "0-0-0", b"nuevo");
    assert!(
        fx.names_in("")
            .iter()
            .all(|name| !name.ends_with(TEMP_SUFFIX))
    );
}

#[test]
fn only_office_documents_get_a_version_in_their_probe() {
    let fx = fixture();
    fx.put(REPORT, &docx(&[]));
    fx.put("notas.txt", b"hola");
    let office = fx.probe(REPORT).unwrap();
    assert_eq!(office.kind, ProbeKind::Office);
    assert!(office.version.is_some());
    assert_eq!(fx.probe("notas.txt").unwrap().version, None);
}

#[test]
fn an_office_over_the_limit_is_classified_but_gets_no_version() {
    let fx = fixture();
    let filler = vec![0u8; MAX_OFFICE_BYTES as usize];
    fx.put(REPORT, &docx(&[("word/relleno.bin", &filler)]));
    let probe = fx.probe(REPORT).unwrap();
    assert_eq!(probe.kind, ProbeKind::Office);
    assert_eq!(probe.version, None);
}

#[test]
fn the_probe_version_changes_when_the_content_changes_at_the_same_length() {
    let fx = fixture();
    let path = fx.put(REPORT, &docx(&[("word/a.bin", b"aaaa")]));
    let before = fx.version(REPORT);
    fs::write(&path, docx(&[("word/a.bin", b"bbbb")])).unwrap();
    assert_ne!(fx.version(REPORT), before);
}

#[test]
fn a_temporary_name_too_long_to_create_is_an_io_error() {
    let fx = fixture();
    let name = format!("{}.docx", "a".repeat(245));
    fx.put(&name, &docx(&[]));
    let version = fx.version(&name);
    let outcome = fx.write(&name, &version, b"nuevo");
    assert!(matches!(outcome, Err(FileError::Io(_))), "{outcome:?}");
    assert_eq!(fx.names_in("").len(), 1);
}

#[test]
fn a_successful_write_invalidates_the_status_cache_and_a_refused_one_does_not() {
    use dakedaduck_svn_lib::app::wc_status::StatusCache;
    let fx = fixture();
    let cache = Arc::new(StatusCache::default());
    let workspace = Workspace::new(&fx.root).unwrap();
    let service = FileService::new(workspace, fx.manager.clone()).with_statuses(cache.clone());
    fx.put(REPORT, &docx(&[]));
    let version = fx.version(REPORT);
    let file = service.scope(Path::new(REPORT)).unwrap();
    let before = cache.generation();
    assert!(service.write_bytes(&file, "0-0-0", b"x").is_err());
    assert_eq!(cache.generation(), before);
    service.write_bytes(&file, &version, b"nuevo").unwrap();
    assert_eq!(cache.generation(), before + 1);
}

#[test]
fn a_path_outside_the_workspace_is_refused_before_anything_is_written() {
    let fx = fixture();
    let outcome = fx.write(r"..\fuera.docx", "0-0-0", b"x");
    assert!(outcome.is_err());
    assert!(!fx.root.parent().unwrap().join("fuera.docx").exists());
}

#[test]
fn file_errors_reach_the_frontend_as_their_snake_case_kinds() {
    use dakedaduck_svn_lib::app::error::CommandError;
    let cases = [
        (FileError::FileChanged, "file_changed"),
        (FileError::FileLocked, "file_locked"),
        (FileError::OfficeTooLarge, "office_too_large"),
        (FileError::ReadOnly, "read_only"),
    ];
    for (error, kind) in cases {
        let wire = serde_json::to_value(CommandError::from(error).kind).unwrap();
        assert_eq!(wire, kind);
    }
}

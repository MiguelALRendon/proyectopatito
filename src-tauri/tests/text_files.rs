#![cfg(windows)]

use std::fs::{self, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use dakedaduck_svn_lib::app::files::{
    Encoding, Eol, FileError, FileService, HEX_CHUNK, MAX_EDITABLE_BYTES, TextDocument, TextUpdate,
    TextWritten,
};
use dakedaduck_svn_lib::app::operations::OperationManager;
use dakedaduck_svn_lib::app::sniff::{ProbeKind, SNIFF_BYTES};
use dakedaduck_svn_lib::app::workspace::{Workspace, WorkspaceError};
use tempfile::TempDir;

const FILE_SHARE_READ: u32 = 1;
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const UTF16_LE_BOM: [u8; 2] = [0xFF, 0xFE];
const UTF16_BE_BOM: [u8; 2] = [0xFE, 0xFF];
const NOTES: &str = "notas.txt";
const WORKING_COPY: &str = "copia";
const SVN_DIR: &str = ".svn";
const MTIME_TICK: Duration = Duration::from_nanos(100);
const LOCK_PROBE: Duration = Duration::from_millis(200);

type UnitBytes = fn(u16) -> [u8; 2];

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

fn update(content: &str, expected_version: &str) -> TextUpdate {
    TextUpdate {
        content: content.into(),
        encoding: Encoding::Utf8,
        has_bom: false,
        eol: Eol::Lf,
        expected_version: expected_version.into(),
    }
}

impl Fixture {
    fn put(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }

    fn read(&self, relative: &str) -> Result<TextDocument, FileError> {
        self.service
            .read_text(&self.service.scope(Path::new(relative))?)
    }

    fn write(&self, relative: &str, update: &TextUpdate) -> Result<TextWritten, FileError> {
        self.service
            .write_text(&self.service.scope(Path::new(relative))?, update)
    }

    fn chunk(&self, relative: &str, offset: u64, len: usize) -> Result<Vec<u8>, FileError> {
        self.service
            .read_chunk(&self.service.scope(Path::new(relative))?, offset, len)
    }

    fn current_version(&self, relative: &str) -> String {
        self.read(relative).unwrap().version
    }

    fn names_in(&self, relative: &str) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(self.root.join(relative))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn working_copy_with(&self, file: &str, bytes: &[u8]) -> PathBuf {
        fs::create_dir_all(self.root.join(WORKING_COPY).join(SVN_DIR)).unwrap();
        self.put(&format!(r"{WORKING_COPY}\{file}"), bytes)
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

fn mark_offline(path: &Path) {
    assert!(run_cmd(&["attrib", "+O", &path.to_string_lossy()]));
}

fn make_read_only(path: &Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions).unwrap();
}

fn utf16(text: &str, to_bytes: UnitBytes) -> Vec<u8> {
    text.encode_utf16().flat_map(to_bytes).collect()
}

fn with_bom(bom: &[u8], body: &[u8]) -> Vec<u8> {
    [bom, body].concat()
}

#[test]
fn a_file_that_changed_between_reading_and_writing_is_not_overwritten() {
    let fx = fixture();
    let path = fx.put(NOTES, b"original");
    let stale = fx.current_version(NOTES);
    fs::write(&path, b"cambiado por otro programa").unwrap();
    let outcome = fx.write(NOTES, &update("mi edicion", &stale));
    assert!(matches!(outcome, Err(FileError::FileChanged)));
    assert_eq!(fs::read(&path).unwrap(), b"cambiado por otro programa");
    assert_eq!(fx.names_in(""), [NOTES]);
}

#[test]
fn a_change_of_one_timestamp_tick_with_the_same_length_is_detected() {
    let fx = fixture();
    let path = fx.put(NOTES, b"abc");
    let before = fx.current_version(NOTES);
    let file = OpenOptions::new().write(true).open(&path).unwrap();
    let modified = file.metadata().unwrap().modified().unwrap();
    file.set_modified(modified + MTIME_TICK).unwrap();
    drop(file);
    assert_ne!(fx.current_version(NOTES), before);
    assert!(matches!(
        fx.write(NOTES, &update("abc", &before)),
        Err(FileError::FileChanged)
    ));
}

#[test]
fn writing_to_a_path_that_does_not_exist_creates_nothing() {
    let fx = fixture();
    let outcome = fx.write("fantasma.txt", &update("hola", "0-0"));
    assert!(matches!(outcome, Err(FileError::Io(_))));
    assert!(fx.names_in("").is_empty());
}

#[test]
fn writing_to_a_folder_is_refused() {
    let fx = fixture();
    fs::create_dir(fx.root.join("carpeta")).unwrap();
    assert!(matches!(
        fx.write("carpeta", &update("hola", "0-0")),
        Err(FileError::NotAFile)
    ));
    assert!(matches!(fx.read("carpeta"), Err(FileError::NotAFile)));
}

#[test]
fn a_file_swapped_for_a_junction_after_scoping_is_not_written() {
    let fx = fixture();
    let path = fx.put(NOTES, b"abc");
    let scoped = fx.service.scope(Path::new(NOTES)).unwrap();
    fs::remove_file(&path).unwrap();
    let target = fx.root.join("destino");
    fs::create_dir(&target).unwrap();
    make_junction(&path, &target);
    let outcome = fx.service.write_text(&scoped, &update("hola", "0-0"));
    assert!(matches!(outcome, Err(FileError::NotAFile)));
    assert!(fx.names_in("destino").is_empty());
}

#[test]
fn a_read_only_file_is_refused_and_left_untouched() {
    let fx = fixture();
    let path = fx.put(NOTES, b"protegido");
    let version = fx.current_version(NOTES);
    make_read_only(&path);
    let outcome = fx.write(NOTES, &update("hola", &version));
    assert!(matches!(outcome, Err(FileError::ReadOnly)));
    assert_eq!(fs::read(&path).unwrap(), b"protegido");
    assert_eq!(fx.names_in(""), [NOTES]);
}

#[test]
fn a_file_held_open_by_another_process_is_reported_locked_and_leaves_no_temp() {
    let fx = fixture();
    let path = fx.put(NOTES, b"en uso");
    let version = fx.current_version(NOTES);
    let _held = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&path)
        .unwrap();
    let outcome = fx.write(NOTES, &update("hola", &version));
    assert!(matches!(outcome, Err(FileError::FileLocked)));
    assert_eq!(fs::read(&path).unwrap(), b"en uso");
    assert_eq!(fx.names_in(""), [NOTES]);
}

#[tokio::test]
async fn an_operation_on_an_ancestor_of_the_working_copy_blocks_the_write() {
    let fx = fixture();
    let path = fx.working_copy_with(NOTES, b"abc");
    let version = fx.current_version(&format!(r"{WORKING_COPY}\{NOTES}"));
    let update_in_progress = fx.manager.lock_working_copy(&fx.root).await;
    let outcome = fx.write(
        &format!(r"{WORKING_COPY}\{NOTES}"),
        &update("hola", &version),
    );
    assert!(matches!(outcome, Err(FileError::Busy(_))));
    assert_eq!(fs::read(&path).unwrap(), b"abc");
    drop(update_in_progress);
    let retried = fx.write(
        &format!(r"{WORKING_COPY}\{NOTES}"),
        &update("hola", &version),
    );
    assert!(retried.is_ok());
}

#[tokio::test]
async fn an_operation_on_a_descendant_of_the_working_copy_blocks_the_write() {
    let fx = fixture();
    let relative = format!(r"{WORKING_COPY}\{NOTES}");
    fx.working_copy_with(NOTES, b"abc");
    let version = fx.current_version(&relative);
    let subfolder = fx.root.join(WORKING_COPY).join("sub");
    fs::create_dir(&subfolder).unwrap();
    let _update_in_progress = fx.manager.lock_working_copy(&subfolder).await;
    let outcome = fx.write(&relative, &update("hola", &version));
    assert!(matches!(outcome, Err(FileError::Busy(_))));
}

#[tokio::test]
async fn an_operation_on_the_working_copy_matches_without_regard_to_case() {
    let fx = fixture();
    let relative = format!(r"{WORKING_COPY}\{NOTES}");
    let path = fx.working_copy_with(NOTES, b"abc");
    let version = fx.current_version(&relative);
    let shouting = PathBuf::from(path.parent().unwrap().to_string_lossy().to_uppercase());
    let _update_in_progress = fx.manager.lock_working_copy(&shouting).await;
    assert!(matches!(
        fx.write(&relative, &update("hola", &version)),
        Err(FileError::Busy(_))
    ));
}

#[tokio::test]
async fn an_operation_on_another_working_copy_does_not_block_the_write() {
    let fx = fixture();
    let relative = format!(r"{WORKING_COPY}\{NOTES}");
    fx.working_copy_with(NOTES, b"abc");
    let version = fx.current_version(&relative);
    let neighbour = fx.root.join("vecina");
    fs::create_dir_all(neighbour.join(SVN_DIR)).unwrap();
    let _update_in_progress = fx.manager.lock_working_copy(&neighbour).await;
    assert!(fx.write(&relative, &update("hola", &version)).is_ok());
}

#[tokio::test]
async fn a_lock_over_a_folder_that_is_not_a_working_copy_still_blocks_its_files() {
    let fx = fixture();
    fx.put(r"suelta\notas.txt", b"abc");
    let version = fx.current_version(r"suelta\notas.txt");
    let _operation = fx.manager.lock_working_copy(&fx.root.join("suelta")).await;
    assert!(matches!(
        fx.write(r"suelta\notas.txt", &update("hola", &version)),
        Err(FileError::Busy(_))
    ));
}

#[test]
fn try_lock_for_write_is_exclusive_per_working_copy() {
    let fx = fixture();
    fx.working_copy_with(NOTES, b"abc");
    let held = fx.manager.try_lock_for_write(&fx.root.join(WORKING_COPY));
    assert!(held.is_ok());
    assert!(
        fx.manager
            .try_lock_for_write(&fx.root.join(WORKING_COPY))
            .is_err()
    );
}

#[tokio::test]
async fn a_busy_ancestor_leaves_no_descendant_lock_acquired() {
    let fx = fixture();
    let working_copy = fx.root.join(WORKING_COPY);
    let subfolder = working_copy.join("sub");
    drop(fx.manager.lock_working_copy(&subfolder).await);
    let ancestor = fx.manager.lock_working_copy(&working_copy).await;
    assert!(fx.manager.try_lock_for_write(&subfolder).is_err());
    let descendant = tokio::time::timeout(LOCK_PROBE, fx.manager.lock_working_copy(&subfolder));
    assert!(descendant.await.is_ok());
    drop(ancestor);
    assert!(fx.manager.try_lock_for_write(&subfolder).is_ok());
}

#[test]
fn bytes_that_are_not_valid_utf8_are_not_text() {
    let fx = fixture();
    fx.put(NOTES, &[b'a', 0xC3, 0x28, b'b']);
    assert!(matches!(fx.read(NOTES), Err(FileError::NotText)));
}

#[test]
fn utf16_without_a_bom_is_not_text() {
    let fx = fixture();
    fx.put(NOTES, &utf16("hola", u16::to_le_bytes));
    assert!(matches!(fx.read(NOTES), Err(FileError::NotText)));
}

#[test]
fn utf16_with_a_lone_surrogate_or_an_odd_length_is_not_text() {
    let fx = fixture();
    fx.put(
        "sustituto.txt",
        &with_bom(&UTF16_LE_BOM, &[0x00, 0xD8, b'a', 0]),
    );
    fx.put("impar.txt", &with_bom(&UTF16_LE_BOM, &[b'a', 0, b'b']));
    assert!(matches!(fx.read("sustituto.txt"), Err(FileError::NotText)));
    assert!(matches!(fx.read("impar.txt"), Err(FileError::NotText)));
}

#[test]
fn a_nul_after_the_sniffed_bytes_makes_the_file_not_text_even_though_the_probe_says_text() {
    let fx = fixture();
    let mut bytes = vec![b'a'; SNIFF_BYTES + 10];
    bytes.push(0);
    bytes.extend_from_slice(b"tail");
    fx.put(NOTES, &bytes);
    let probe = fx
        .service
        .probe(&fx.service.scope(Path::new(NOTES)).unwrap(), false)
        .unwrap();
    assert_eq!(probe.kind, ProbeKind::Text);
    assert!(matches!(fx.read(NOTES), Err(FileError::NotText)));
}

#[test]
fn a_file_over_the_editor_limit_is_too_large_to_read_or_to_write_into() {
    let fx = fixture();
    let over = usize::try_from(MAX_EDITABLE_BYTES).unwrap() + 1;
    let path = fx.put("grande.txt", &vec![b'a'; over]);
    assert!(matches!(fx.read("grande.txt"), Err(FileError::TooLarge)));
    fx.put(NOTES, b"abc");
    let version = fx.current_version(NOTES);
    let outcome = fx.write(NOTES, &update(&"a".repeat(over), &version));
    assert!(matches!(outcome, Err(FileError::TooLarge)));
    assert_eq!(fs::metadata(path).unwrap().len(), over as u64);
    assert_eq!(fx.names_in("").len(), 2);
}

#[test]
fn a_write_of_exactly_the_editor_limit_is_accepted() {
    let fx = fixture();
    fx.put(NOTES, b"abc");
    let version = fx.current_version(NOTES);
    let exact = usize::try_from(MAX_EDITABLE_BYTES).unwrap();
    fx.write(NOTES, &update(&"a".repeat(exact), &version))
        .unwrap();
    assert_eq!(
        fs::metadata(fx.root.join(NOTES)).unwrap().len(),
        MAX_EDITABLE_BYTES
    );
}

#[test]
fn the_editor_and_hex_chunk_limits_have_their_documented_sizes() {
    assert_eq!(MAX_EDITABLE_BYTES, 5_242_880);
    assert_eq!(HEX_CHUNK, 65_536);
}

#[test]
fn a_file_that_grew_past_the_editor_limit_since_it_was_opened_is_a_conflict_not_too_large() {
    let fx = fixture();
    let path = fx.put(NOTES, b"abc");
    let opened = fx.read(NOTES).unwrap();
    let over = usize::try_from(MAX_EDITABLE_BYTES).unwrap() + 1;
    fs::write(&path, vec![b'a'; over]).unwrap();
    let outcome = fx.write(NOTES, &update("mi edicion", &opened.version));
    assert!(matches!(outcome, Err(FileError::FileChanged)));
    assert_eq!(fs::metadata(&path).unwrap().len(), over as u64);
}

#[test]
fn a_file_exactly_at_the_editor_limit_still_opens() {
    let fx = fixture();
    let exact = usize::try_from(MAX_EDITABLE_BYTES).unwrap();
    fx.put("justo.txt", &vec![b'a'; exact]);
    assert_eq!(fx.read("justo.txt").unwrap().len, MAX_EDITABLE_BYTES);
}

#[test]
fn a_file_that_exists_only_in_the_cloud_is_refused_by_every_operation() {
    let fx = fixture();
    let path = fx.put("nube.txt", b"abc");
    let version = fx.current_version("nube.txt");
    mark_offline(&path);
    assert!(matches!(fx.read("nube.txt"), Err(FileError::CloudOnly)));
    assert!(matches!(
        fx.chunk("nube.txt", 0, 1),
        Err(FileError::CloudOnly)
    ));
    let outcome = fx.write("nube.txt", &update("hola", &version));
    assert!(matches!(outcome, Err(FileError::CloudOnly)));
}

#[test]
fn the_subversion_admin_folders_cannot_be_read_or_written() {
    let fx = fixture();
    fx.put(r".svn\wc.db", b"abc");
    fx.put(r"_SVN\entries", b"abc");
    assert!(matches!(
        fx.read(r".svn\wc.db"),
        Err(FileError::ForbiddenPath)
    ));
    assert!(matches!(
        fx.chunk(r"_SVN\entries", 0, 1),
        Err(FileError::ForbiddenPath)
    ));
    let outcome = fx.write(r".SVN\wc.db", &update("x", "0-0"));
    assert!(matches!(outcome, Err(FileError::ForbiddenPath)));
}

#[test]
fn a_path_that_climbs_out_of_the_workspace_is_refused_before_any_io() {
    let fx = fixture();
    assert!(matches!(
        fx.read(r"..\fuera.txt"),
        Err(FileError::Workspace(WorkspaceError::ParentTraversal))
    ));
}

#[test]
fn an_empty_file_is_empty_utf8_text_with_unix_endings() {
    let fx = fixture();
    fx.put(NOTES, b"");
    let document = fx.read(NOTES).unwrap();
    assert_eq!(document.content, "");
    assert_eq!(document.encoding, Encoding::Utf8);
    assert!(!document.has_bom);
    assert_eq!((document.eol, document.eol_mixed), (Eol::Lf, false));
}

#[test]
fn mixed_line_endings_are_reported_with_the_dominant_one() {
    let fx = fixture();
    fx.put("mas_crlf.txt", b"a\r\nb\r\nc\n");
    fx.put("mas_lf.txt", b"a\nb\nc\r\n");
    fx.put("empate.txt", b"a\nb\r\n");
    let crlf = fx.read("mas_crlf.txt").unwrap();
    let lf = fx.read("mas_lf.txt").unwrap();
    assert_eq!((crlf.eol, crlf.eol_mixed), (Eol::CrLf, true));
    assert_eq!((lf.eol, lf.eol_mixed), (Eol::Lf, true));
    assert_eq!(fx.read("empate.txt").unwrap().eol, Eol::Lf);
}

#[test]
fn uniform_line_endings_are_not_reported_as_mixed() {
    let fx = fixture();
    fx.put("windows.txt", b"a\r\nb\r\n");
    fx.put("unix.txt", b"a\nb\n");
    let windows = fx.read("windows.txt").unwrap();
    assert_eq!((windows.eol, windows.eol_mixed), (Eol::CrLf, false));
    let unix = fx.read("unix.txt").unwrap();
    assert_eq!((unix.eol, unix.eol_mixed), (Eol::Lf, false));
}

#[test]
fn every_supported_encoding_and_bom_survives_a_read_and_write_round_trip() {
    let fx = fixture();
    let text = "ñandú\r\nλ 日本\r\n";
    let samples = [
        ("utf8.txt", Encoding::Utf8, false, text.as_bytes().to_vec()),
        (
            "utf8bom.txt",
            Encoding::Utf8,
            true,
            with_bom(&UTF8_BOM, text.as_bytes()),
        ),
        (
            "le.txt",
            Encoding::Utf16Le,
            true,
            with_bom(&UTF16_LE_BOM, &utf16(text, u16::to_le_bytes)),
        ),
        (
            "be.txt",
            Encoding::Utf16Be,
            true,
            with_bom(&UTF16_BE_BOM, &utf16(text, u16::to_be_bytes)),
        ),
    ];
    for (name, encoding, has_bom, bytes) in samples {
        let path = fx.put(name, &bytes);
        let document = fx.read(name).unwrap();
        assert_eq!(
            (document.encoding, document.has_bom),
            (encoding, has_bom),
            "{name}"
        );
        assert_eq!(document.content, text, "{name}");
        let resend = TextUpdate {
            content: document.content,
            encoding: document.encoding,
            has_bom: document.has_bom,
            eol: document.eol,
            expected_version: document.version,
        };
        fx.write(name, &resend).unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes, "{name}");
    }
}

#[test]
fn writing_re_encodes_the_line_endings_with_the_one_asked_for() {
    let fx = fixture();
    let path = fx.put(NOTES, b"a");
    let version = fx.current_version(NOTES);
    let request = TextUpdate {
        eol: Eol::CrLf,
        ..update("uno\ndos\r\ntres\n", &version)
    };
    fx.write(NOTES, &request).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"uno\r\ndos\r\ntres\r\n");
    let version = fx.current_version(NOTES);
    fx.write(NOTES, &update("uno\r\ndos\r\n", &version))
        .unwrap();
    assert_eq!(fs::read(path).unwrap(), b"uno\ndos\n");
}

#[test]
fn writing_a_mixed_line_ending_file_normalises_it_to_the_requested_ending() {
    let fx = fixture();
    let path = fx.put(NOTES, b"a\r\nb\nc\r\n");
    let opened = fx.read(NOTES).unwrap();
    assert!(opened.eol_mixed);
    let resend = TextUpdate {
        eol: opened.eol,
        ..update(&opened.content, &opened.version)
    };
    fx.write(NOTES, &resend).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"a\r\nb\r\nc\r\n");
    assert!(!fx.read(NOTES).unwrap().eol_mixed);
}

#[test]
fn utf16_is_written_with_its_bom_even_when_the_caller_says_there_is_none() {
    let fx = fixture();
    let text = "ñandú\nλ\n";
    let cases: [(&str, Encoding, &[u8], UnitBytes); 2] = [
        ("le.txt", Encoding::Utf16Le, &UTF16_LE_BOM, u16::to_le_bytes),
        ("be.txt", Encoding::Utf16Be, &UTF16_BE_BOM, u16::to_be_bytes),
    ];
    for (name, encoding, bom, to_bytes) in cases {
        let path = fx.put(name, b"viejo");
        let version = fx.current_version(name);
        let request = TextUpdate {
            encoding,
            ..update(text, &version)
        };
        fx.write(name, &request).unwrap();
        assert_eq!(
            fs::read(path).unwrap(),
            with_bom(bom, &utf16(text, to_bytes))
        );
        let reopened = fx.read(name).unwrap();
        assert_eq!(reopened.content, text, "{name}");
        assert_eq!((reopened.encoding, reopened.has_bom), (encoding, true));
    }
}

#[test]
fn two_same_length_writes_within_one_timestamp_tick_are_still_a_conflict() {
    let fx = fixture();
    let path = fx.put(NOTES, b"abc");
    let frozen = fs::metadata(&path).unwrap().modified().unwrap();
    let opened = fx.read(NOTES).unwrap();
    fs::write(&path, b"xyz").unwrap();
    OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(frozen)
        .unwrap();
    assert_ne!(fx.current_version(NOTES), opened.version);
    let outcome = fx.write(NOTES, &update("mi edicion", &opened.version));
    assert!(matches!(outcome, Err(FileError::FileChanged)));
    assert_eq!(fs::read(&path).unwrap(), b"xyz");
}

#[test]
fn a_failed_write_never_leaves_a_temporary_file_behind() {
    let fx = fixture();
    let path = fx.put(NOTES, b"abc");
    let version = fx.current_version(NOTES);
    let held = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&path)
        .unwrap();
    for _ in 0..3 {
        assert!(fx.write(NOTES, &update("hola", &version)).is_err());
    }
    drop(held);
    assert_eq!(fx.names_in(""), [NOTES]);
}

#[test]
fn the_chunk_reader_returns_the_requested_window_and_caps_its_length() {
    let fx = fixture();
    let bytes: Vec<u8> = (0..=255u8).cycle().take(HEX_CHUNK * 2 + 5).collect();
    fx.put("datos.bin", &bytes);
    assert_eq!(fx.chunk("datos.bin", 250, 12).unwrap(), bytes[250..262]);
    assert_eq!(
        fx.chunk("datos.bin", 0, usize::MAX).unwrap(),
        bytes[..HEX_CHUNK]
    );
    let tail = fx
        .chunk("datos.bin", (HEX_CHUNK * 2) as u64, HEX_CHUNK)
        .unwrap();
    assert_eq!(tail, bytes[HEX_CHUNK * 2..]);
}

#[test]
fn the_chunk_reader_returns_nothing_past_the_end_and_refuses_folders() {
    let fx = fixture();
    fx.put("datos.bin", b"abc");
    fs::create_dir(fx.root.join("carpeta")).unwrap();
    assert!(fx.chunk("datos.bin", 3, 10).unwrap().is_empty());
    assert!(fx.chunk("datos.bin", u64::MAX / 2, 10).unwrap().is_empty());
    assert!(fx.chunk("datos.bin", 0, 0).unwrap().is_empty());
    assert!(matches!(
        fx.chunk("carpeta", 0, 1),
        Err(FileError::NotAFile)
    ));
    assert!(matches!(
        fx.chunk("no_existe.bin", 0, 1),
        Err(FileError::Io(_))
    ));
}

#[test]
fn a_binary_file_is_readable_by_chunks_even_though_it_is_not_text() {
    let fx = fixture();
    fx.put("a.bin", &[0, 1, 2, 3]);
    assert!(matches!(fx.read("a.bin"), Err(FileError::NotText)));
    assert_eq!(fx.chunk("a.bin", 1, 2).unwrap(), [1, 2]);
}

#[test]
fn reading_and_saving_a_text_file_round_trips_with_a_fresh_version() {
    let fx = fixture();
    let path = fx.put(NOTES, b"hola\n");
    let opened = fx.read(NOTES).unwrap();
    assert_eq!(opened.content, "hola\n");
    assert_eq!(opened.len, 5);
    let saved = fx
        .write(NOTES, &update("hola mundo\n", &opened.version))
        .unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"hola mundo\n");
    assert_ne!(saved.version, opened.version);
    assert_eq!(saved.version, fx.current_version(NOTES));
    assert_eq!(fx.names_in(""), [NOTES]);
}

#[test]
fn a_second_save_with_the_version_from_the_first_read_is_a_conflict() {
    let fx = fixture();
    fx.put(NOTES, b"uno");
    let opened = fx.read(NOTES).unwrap();
    fx.write(NOTES, &update("dos", &opened.version)).unwrap();
    let again = fx.write(NOTES, &update("tres", &opened.version));
    assert!(matches!(again, Err(FileError::FileChanged)));
}

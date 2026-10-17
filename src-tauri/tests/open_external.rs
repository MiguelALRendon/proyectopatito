#![cfg(windows)]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use dakedaduck_svn_lib::app::error::{CommandError, CommandErrorKind};
use dakedaduck_svn_lib::app::files::{
    FileError, FileService, Launcher, OPENABLE_EXTENSIONS, SystemLauncher,
};
use dakedaduck_svn_lib::app::operations::OperationManager;
use dakedaduck_svn_lib::app::state::AppState;
use dakedaduck_svn_lib::app::workspace::{Workspace, WorkspaceError};
use dakedaduck_svn_lib::config::{CONFIG_FILE_NAME, ConfigStore};
use tempfile::TempDir;

const DATA: &[u8] = b"datos inofensivos";
const PE_HEADER: &[u8] = b"MZ\x90\x00\x03\x00\x00\x00";
const WORKING_COPY: &str = "copia";

const FORBIDDEN_EXTENSIONS: [&str; 33] = [
    "doc", "xls", "ppt", "rtf", "csv", "docm", "xlsm", "pptm", "dotm", "xlam", "html", "htm",
    "xhtml", "svg", "xml", "js", "mjs", "vbs", "vbe", "wsf", "hta", "bat", "cmd", "ps1", "psm1",
    "lnk", "url", "exe", "msi", "dll", "scr", "com", "jar",
];

#[derive(Default)]
struct RecordingLauncher {
    opened: Mutex<Vec<PathBuf>>,
}

impl RecordingLauncher {
    fn opened(&self) -> Vec<PathBuf> {
        self.opened.lock().unwrap().clone()
    }
}

impl Launcher for RecordingLauncher {
    fn open(&self, path: &Path) -> io::Result<()> {
        self.opened.lock().unwrap().push(path.to_path_buf());
        Ok(())
    }
}

struct FailingLauncher;

impl Launcher for FailingLauncher {
    fn open(&self, _path: &Path) -> io::Result<()> {
        Err(io::Error::other("sin aplicación asociada"))
    }
}

struct Fixture {
    _guard: TempDir,
    root: PathBuf,
    outside: PathBuf,
    service: FileService,
    launcher: Arc<RecordingLauncher>,
}

fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

fn fixture() -> Fixture {
    let guard = tempfile::tempdir().unwrap();
    let base = plain_path(fs::canonicalize(guard.path()).unwrap());
    let (root, outside) = (base.join("svn"), base.join("fuera"));
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    let service = FileService::new(
        Workspace::new(&root).unwrap(),
        Arc::new(OperationManager::default()),
    );
    Fixture {
        _guard: guard,
        root,
        outside,
        service,
        launcher: Arc::default(),
    }
}

impl Fixture {
    fn put(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }

    fn open(&self, relative: &str) -> Result<(), FileError> {
        let file = self.service.scope(Path::new(relative))?;
        self.service.open_external(&file, self.launcher.as_ref())
    }

    fn can_open(&self, relative: &str) -> bool {
        self.service
            .scope(Path::new(relative))
            .is_ok_and(|file| self.service.can_open_external(&file))
    }

    fn assert_refused(&self, relative: &str) {
        let outcome = self.open(relative);
        assert!(
            matches!(outcome, Err(FileError::NotAllowed)),
            "{relative}: {outcome:?}"
        );
        assert!(!self.can_open(relative), "{relative}");
        assert!(self.launcher.opened().is_empty(), "{relative}");
    }

    fn assert_never_launched(&self, relative: &str) {
        assert!(self.open(relative).is_err(), "{relative}");
        assert!(!self.can_open(relative), "{relative}");
        assert!(self.launcher.opened().is_empty(), "{relative}");
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

#[test]
fn a_double_extension_ending_in_an_executable_is_not_a_document() {
    let fx = fixture();
    for name in [
        "a.pdf.exe",
        "a.docx.bat",
        "a.png.js",
        "a.txt.lnk",
        "a.zip.scr",
    ] {
        fx.put(name, DATA);
        fx.assert_refused(name);
    }
}

#[test]
fn every_dangerous_or_privileged_extension_is_refused_in_any_casing() {
    let fx = fixture();
    for extension in FORBIDDEN_EXTENSIONS {
        for name in [
            format!("x.{extension}"),
            format!("X.{}", extension.to_uppercase()),
        ] {
            fx.put(&name, DATA);
            fx.assert_refused(&name);
        }
    }
}

#[test]
fn an_unknown_extension_is_refused_because_the_list_is_an_allow_list() {
    let fx = fixture();
    for name in [
        "x.xyz",
        "x.bin",
        "x.pdfx",
        "x.xpdf",
        "x.p df",
        "x.pdf\u{a0}",
        "x.ｐｄｆ",
    ] {
        fx.put(name, DATA);
        fx.assert_refused(name);
    }
}

#[test]
fn a_file_without_extension_or_with_only_a_dot_name_is_refused() {
    let fx = fixture();
    for name in ["LEEME", ".pdf", ".txt", "pdf"] {
        fx.put(name, DATA);
        fx.assert_refused(name);
    }
}

#[test]
fn an_unreadable_name_with_trailing_space_or_dot_never_reaches_the_launcher() {
    let fx = fixture();
    fx.put("informe.pdf", DATA);
    for name in [
        "informe.pdf ",
        "informe.pdf.",
        "informe.pdf. .",
        "informe .pdf ",
    ] {
        let outcome = fx.open(name);
        assert!(
            matches!(
                outcome,
                Err(FileError::Workspace(WorkspaceError::DeviceOrReservedPath))
            ),
            "{name:?}: {outcome:?}"
        );
    }
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn an_alternate_data_stream_never_reaches_the_launcher() {
    let fx = fixture();
    fx.put("archivo.txt", DATA);
    for name in [
        "archivo.txt:flujo",
        "archivo.txt:flujo:$DATA",
        "archivo.txt::$DATA",
    ] {
        let outcome = fx.open(name);
        assert!(
            matches!(
                outcome,
                Err(FileError::Workspace(WorkspaceError::DeviceOrReservedPath))
            ),
            "{name:?}: {outcome:?}"
        );
        assert!(!fx.can_open(name), "{name}");
    }
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn a_portable_executable_header_is_refused_whatever_the_extension() {
    let fx = fixture();
    for name in [
        "sin_extension",
        "falso.pdf",
        "falso.TXT",
        "falso.docx",
        "falso.png",
    ] {
        fx.put(name, PE_HEADER);
        fx.assert_refused(name);
    }
}

#[test]
fn the_pe_header_is_only_checked_at_the_start_of_the_file() {
    let fx = fixture();
    fx.put("zip.zip", &[b"PK\x03\x04".as_slice(), PE_HEADER].concat());
    fx.put("pdf.pdf", &[b"%PDF-1.7\n".as_slice(), PE_HEADER].concat());
    assert!(fx.open("zip.zip").is_ok());
    assert!(fx.open("pdf.pdf").is_ok());
}

#[test]
fn a_file_with_only_one_byte_of_the_pe_header_is_not_confused_with_it() {
    let fx = fixture();
    fx.put("m.txt", b"M");
    fx.put("vacio.txt", b"");
    assert!(fx.open("m.txt").is_ok());
    assert!(fx.open("vacio.txt").is_ok());
}

#[test]
fn a_path_outside_the_root_never_reaches_the_launcher() {
    let fx = fixture();
    let stray = fx.outside.join("ajeno.pdf");
    fs::write(&stray, DATA).unwrap();
    let outcome = fx.open(&stray.to_string_lossy());
    assert!(matches!(
        outcome,
        Err(FileError::Workspace(WorkspaceError::OutsideWorkspace))
    ));
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn parent_components_never_reach_the_launcher() {
    let fx = fixture();
    fs::write(fx.outside.join("ajeno.pdf"), DATA).unwrap();
    for name in [
        r"..\fuera\ajeno.pdf",
        r"a\..\..\fuera\ajeno.pdf",
        r"..\svn\x.pdf",
    ] {
        let outcome = fx.open(name);
        assert!(
            matches!(
                outcome,
                Err(FileError::Workspace(WorkspaceError::ParentTraversal))
            ),
            "{name}: {outcome:?}"
        );
    }
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn a_junction_pointing_outside_the_root_never_reaches_the_launcher() {
    let fx = fixture();
    fs::write(fx.outside.join("ajeno.pdf"), DATA).unwrap();
    make_junction(&fx.root.join("enlace"), &fx.outside);
    let outcome = fx.open(r"enlace\ajeno.pdf");
    assert!(matches!(
        outcome,
        Err(FileError::Workspace(WorkspaceError::OutsideWorkspace))
    ));
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn the_subversion_administrative_directories_are_forbidden() {
    let fx = fixture();
    for name in [
        r"copia\.svn\a.pdf",
        r"copia\_svn\a.pdf",
        r"copia\.SVN\a.pdf",
    ] {
        fx.put(name, DATA);
        let outcome = fx.open(name);
        assert!(
            matches!(outcome, Err(FileError::ForbiddenPath)),
            "{name}: {outcome:?}"
        );
        assert!(!fx.can_open(name), "{name}");
    }
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn a_file_that_exists_only_in_the_cloud_is_refused_without_reading_it() {
    let fx = fixture();
    let path = fx.put("nube.pdf", PE_HEADER);
    mark_offline(&path);
    let outcome = fx.open("nube.pdf");
    assert!(matches!(outcome, Err(FileError::CloudOnly)), "{outcome:?}");
    assert!(!fx.can_open("nube.pdf"));
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn a_folder_is_never_opened_even_if_its_name_looks_like_a_document() {
    let fx = fixture();
    fs::create_dir(fx.root.join("carpeta.pdf")).unwrap();
    fs::create_dir(fx.root.join("carpeta")).unwrap();
    for name in ["carpeta.pdf", "carpeta", "."] {
        let outcome = fx.open(name);
        assert!(
            matches!(outcome, Err(FileError::NotAFile)),
            "{name}: {outcome:?}"
        );
        assert!(!fx.can_open(name), "{name}");
    }
    assert!(fx.launcher.opened().is_empty());
}

#[test]
fn a_missing_file_is_an_io_error_and_never_reaches_the_launcher() {
    let fx = fixture();
    let outcome = fx.open("no_existe.pdf");
    assert!(matches!(outcome, Err(FileError::Io(_))), "{outcome:?}");
    fx.assert_never_launched("no_existe.exe");
}

#[test]
fn the_refusal_reaches_the_frontend_as_a_spanish_not_allowed_error() {
    let error = CommandError::from(FileError::NotAllowed);
    assert_eq!(error.kind, CommandErrorKind::NotAllowed);
    assert!(error.message.contains("ejecutables ni scripts"));
}

#[test]
fn the_allow_list_is_exactly_the_agreed_set_of_data_formats() {
    let agreed = [
        "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "zip", "7z", "rar", "tar", "gz", "bz2",
        "xz", "mp3", "mp4", "mkv", "avi", "mov", "wav", "flac", "ogg", "webm", "png", "jpg",
        "jpeg", "gif", "webp", "bmp", "ico", "txt", "md", "log",
    ];
    assert_eq!(OPENABLE_EXTENSIONS, agreed);
    assert!(
        OPENABLE_EXTENSIONS
            .iter()
            .all(|allowed| !FORBIDDEN_EXTENSIONS.contains(allowed))
    );
}

#[test]
fn a_launcher_failure_is_reported_as_an_io_error() {
    let fx = fixture();
    fx.put("informe.pdf", DATA);
    let file = fx.service.scope(Path::new("informe.pdf")).unwrap();
    let outcome = fx.service.open_external(&file, &FailingLauncher);
    assert!(matches!(outcome, Err(FileError::Io(_))), "{outcome:?}");
}

#[test]
fn the_real_launcher_is_not_involved_when_the_file_is_refused() {
    let fx = fixture();
    fx.put("peligro.exe", PE_HEADER);
    let file = fx.service.scope(Path::new("peligro.exe")).unwrap();
    let outcome = fx.service.open_external(&file, &SystemLauncher);
    assert!(matches!(outcome, Err(FileError::NotAllowed)), "{outcome:?}");
}

#[test]
fn the_application_state_hands_the_injected_launcher_to_the_command() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("raiz");
    fs::create_dir(&root).unwrap();
    let recorder = Arc::new(RecordingLauncher::default());
    let state = AppState::new(ConfigStore {
        path: dir.path().join(CONFIG_FILE_NAME),
    })
    .with_launcher(recorder.clone());
    state.workspace_set(&root).unwrap();
    fs::write(root.join("a.pdf"), DATA).unwrap();
    fs::write(root.join("a.exe"), PE_HEADER).unwrap();
    let service = state.file_service().unwrap();
    let launcher = state.launcher();
    let refused = service.scope(Path::new("a.exe")).unwrap();
    assert!(service.open_external(&refused, launcher.as_ref()).is_err());
    assert!(recorder.opened().is_empty());
    let allowed = service.scope(Path::new("a.pdf")).unwrap();
    service.open_external(&allowed, launcher.as_ref()).unwrap();
    assert_eq!(recorder.opened(), vec![allowed.as_path().to_path_buf()]);
}

#[test]
fn every_allowed_extension_reaches_the_launcher_with_the_canonical_path() {
    let fx = fixture();
    for extension in OPENABLE_EXTENSIONS {
        let name = format!(r"{WORKING_COPY}\x.{extension}");
        let path = fx.put(&name, DATA);
        assert!(fx.can_open(&name), "{extension}");
        fx.open(&name).unwrap();
        assert_eq!(fx.launcher.opened().last(), Some(&path), "{extension}");
    }
    assert_eq!(fx.launcher.opened().len(), OPENABLE_EXTENSIONS.len());
}

#[test]
fn the_extension_check_ignores_casing_and_uses_only_the_last_component() {
    let fx = fixture();
    let upper = fx.put("INFORME.PDF", DATA);
    let nested = fx.put(r"a.exe\b.c\Informe Final.DocX", DATA);
    fx.open("INFORME.PDF").unwrap();
    fx.open(r"a.exe\b.c\Informe Final.DocX").unwrap();
    assert_eq!(fx.launcher.opened(), vec![upper, nested]);
}

#[test]
fn a_document_with_dots_spaces_and_accents_in_its_name_is_opened() {
    let fx = fixture();
    let path = fx.put("año 2024.v2 (final).docx", DATA);
    fx.open("año 2024.v2 (final).docx").unwrap();
    assert_eq!(fx.launcher.opened(), vec![path]);
}

#[test]
fn the_system_launcher_reports_a_path_that_does_not_exist_instead_of_pretending_to_open_it() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("sin-carpeta").join("fantasma.ddsinasociar");
    assert!(SystemLauncher.open(&missing).is_err());
}

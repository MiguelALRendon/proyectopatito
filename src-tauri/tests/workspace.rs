#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use dakedaduck_svn_lib::app::workspace::{Workspace, WorkspaceError};
use tempfile::TempDir;

struct Fixture {
    _guard: TempDir,
    parent: PathBuf,
    workspace: Workspace,
}

fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

fn fixture() -> Fixture {
    let guard = tempfile::tempdir().unwrap();
    let parent = plain_path(fs::canonicalize(guard.path()).unwrap());
    let root = parent.join("svn");
    fs::create_dir(&root).unwrap();
    let workspace = Workspace::new(&root).unwrap();
    Fixture {
        _guard: guard,
        parent,
        workspace,
    }
}

fn make_junction(link: &Path, target: &Path) {
    let status = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .unwrap()
        .status;
    assert!(status.success(), "no se pudo crear la junction de prueba");
}

fn resolve_new(fixture: &Fixture, path: &str) -> Result<(), WorkspaceError> {
    fixture
        .workspace
        .resolve(Path::new(path), false)
        .map(|_| ())
}

#[test]
fn new_rejects_missing_root() {
    let fixture = fixture();
    let missing = fixture.parent.join("no-existe");
    assert!(matches!(
        Workspace::new(&missing),
        Err(WorkspaceError::RootInvalid)
    ));
}

#[test]
fn new_rejects_file_as_root() {
    let fixture = fixture();
    let file = fixture.parent.join("archivo.txt");
    fs::write(&file, "x").unwrap();
    assert!(matches!(
        Workspace::new(&file),
        Err(WorkspaceError::RootInvalid)
    ));
}

#[test]
fn resolve_rejects_leading_parent_dir() {
    let fixture = fixture();
    assert!(matches!(
        resolve_new(&fixture, r"..\fuera"),
        Err(WorkspaceError::ParentTraversal)
    ));
}

#[test]
fn resolve_rejects_parent_dir_hidden_in_the_middle() {
    let fixture = fixture();
    assert!(matches!(
        resolve_new(&fixture, r"a\..\..\fuera"),
        Err(WorkspaceError::ParentTraversal)
    ));
}

#[test]
fn resolve_rejects_device_namespace_prefix() {
    let fixture = fixture();
    assert!(matches!(
        resolve_new(&fixture, r"\\.\C:\x"),
        Err(WorkspaceError::DeviceOrReservedPath)
    ));
}

#[test]
fn resolve_rejects_verbatim_prefix() {
    let fixture = fixture();
    assert!(matches!(
        resolve_new(&fixture, r"\\?\C:\x"),
        Err(WorkspaceError::DeviceOrReservedPath)
    ));
}

#[test]
fn resolve_rejects_reserved_names_in_any_case_and_extension() {
    let fixture = fixture();
    for name in [
        "CON",
        "nul.txt",
        "Aux",
        "prn",
        "com1",
        "LPT9.log",
        "con ",
        "COM¹",
        "lpt².txt",
    ] {
        assert!(
            matches!(
                resolve_new(&fixture, name),
                Err(WorkspaceError::DeviceOrReservedPath)
            ),
            "{name} deberia ser rechazado"
        );
    }
}

#[test]
fn resolve_rejects_reserved_name_nested_in_path() {
    let fixture = fixture();
    assert!(matches!(
        resolve_new(&fixture, r"proyecto\NUL\x"),
        Err(WorkspaceError::DeviceOrReservedPath)
    ));
}

#[test]
fn resolve_accepts_com0_and_com10_which_are_not_reserved() {
    let fixture = fixture();
    assert!(resolve_new(&fixture, "com0").is_ok());
    assert!(resolve_new(&fixture, "com10").is_ok());
}

#[test]
fn resolve_rejects_absolute_path_outside_root() {
    let fixture = fixture();
    let outside = fixture.parent.join("otro");
    fs::create_dir(&outside).unwrap();
    assert!(matches!(
        fixture.workspace.resolve(&outside, false),
        Err(WorkspaceError::OutsideWorkspace)
    ));
}

#[test]
fn resolve_rejects_sibling_folder_sharing_root_name_prefix() {
    let fixture = fixture();
    let sibling = fixture.parent.join("svn2");
    fs::create_dir(&sibling).unwrap();
    assert!(matches!(
        fixture.workspace.resolve(&sibling.join("x"), false),
        Err(WorkspaceError::OutsideWorkspace)
    ));
}

#[test]
fn resolve_rejects_junction_that_escapes_the_root() {
    let fixture = fixture();
    let outside = fixture.parent.join("fuera");
    fs::create_dir(&outside).unwrap();
    make_junction(&fixture.workspace.root().as_path().join("escape"), &outside);
    assert!(matches!(
        resolve_new(&fixture, r"escape\archivo"),
        Err(WorkspaceError::OutsideWorkspace)
    ));
}

#[test]
fn resolve_rejects_existing_destination_without_overwrite() {
    let fixture = fixture();
    fs::create_dir(fixture.workspace.root().as_path().join("wc")).unwrap();
    assert!(matches!(
        resolve_new(&fixture, "wc"),
        Err(WorkspaceError::DestinationExists)
    ));
}

#[test]
fn resolve_rejects_root_itself_without_overwrite() {
    let fixture = fixture();
    assert!(matches!(
        resolve_new(&fixture, ""),
        Err(WorkspaceError::DestinationExists)
    ));
}

#[test]
fn resolve_accepts_existing_destination_with_explicit_overwrite() {
    let fixture = fixture();
    let existing = fixture.workspace.root().as_path().join("wc");
    fs::create_dir(&existing).unwrap();
    let scoped = fixture.workspace.resolve(Path::new("wc"), true).unwrap();
    assert_eq!(scoped.as_path(), existing);
}

#[test]
fn resolve_accepts_root_written_in_uppercase() {
    let fixture = fixture();
    let shouting = fixture
        .workspace
        .root()
        .as_path()
        .to_string_lossy()
        .to_uppercase();
    let scoped = fixture
        .workspace
        .resolve(&PathBuf::from(shouting).join("wc"), false);
    assert!(scoped.is_ok());
}

#[test]
fn revalidate_rejects_destination_swapped_for_escaping_junction() {
    let fixture = fixture();
    let scoped = fixture.workspace.resolve(Path::new("wc"), false).unwrap();
    let outside = fixture.parent.join("fuera");
    fs::create_dir(&outside).unwrap();
    make_junction(scoped.as_path(), &outside);
    assert!(matches!(
        fixture.workspace.revalidate(&scoped),
        Err(WorkspaceError::OutsideWorkspace)
    ));
}

#[test]
fn resolve_returns_scoped_path_inside_root_for_new_nested_destination() {
    let fixture = fixture();
    let scoped = fixture
        .workspace
        .resolve(Path::new(r"proyectos\wc nuevo"), false)
        .unwrap();
    let expected = fixture
        .workspace
        .root()
        .as_path()
        .join("proyectos")
        .join("wc nuevo");
    assert_eq!(scoped.as_path(), expected);
    assert!(fixture.workspace.revalidate(&scoped).is_ok());
}

#[test]
fn resolve_rejects_symlink_that_escapes_the_root() {
    let fixture = fixture();
    let outside = fixture.parent.join("fuera");
    fs::create_dir(&outside).unwrap();
    let link = fixture.workspace.root().as_path().join("escape");
    std::os::windows::fs::symlink_dir(&outside, &link)
        .expect("se requiere el Modo de desarrollador de Windows para crear symlinks");
    assert!(matches!(
        resolve_new(&fixture, r"escape\archivo"),
        Err(WorkspaceError::OutsideWorkspace)
    ));
}

#![allow(dead_code)]

use std::path::Path;
use std::process::Command;

use dakedaduck_svn_lib::app::svn_locator::{SvnBinary, locate};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use tempfile::{Builder, TempDir};

const REPO_DIR_PREFIX: &str = "repo ñandú ";
const SVNADMIN_EXE: &str = "svnadmin.exe";
const FILE_URL_PREFIX: &str = "file:///";
const URL_SAFE: AsciiSet = NON_ALPHANUMERIC
    .remove(b'/')
    .remove(b':')
    .remove(b'-')
    .remove(b'_')
    .remove(b'.');

pub struct TestRepo {
    pub _dir: TempDir,
    pub url: String,
    pub svn: SvnBinary,
}

impl TestRepo {
    pub fn create() -> Self {
        let svn = locate(None).unwrap_or_else(|error| {
            panic!("se necesita Subversion >= 1.10 para las pruebas de integracion: {error}")
        });
        let dir = Builder::new()
            .prefix(REPO_DIR_PREFIX)
            .tempdir()
            .expect("no se pudo crear el directorio temporal");
        create_repository(&svn, dir.path());
        let url = file_url(dir.path());
        Self {
            _dir: dir,
            url,
            svn,
        }
    }
}

fn create_repository(svn: &SvnBinary, repo_path: &Path) {
    let svnadmin = svn.path.with_file_name(SVNADMIN_EXE);
    let status = Command::new(&svnadmin)
        .arg("create")
        .arg(repo_path)
        .status()
        .unwrap_or_else(|error| panic!("no se pudo ejecutar {}: {error}", svnadmin.display()));
    assert!(status.success(), "svnadmin create fallo con {status}");
}

fn file_url(repo_path: &Path) -> String {
    let slashed = repo_path.to_string_lossy().replace('\\', "/");
    let encoded = utf8_percent_encode(&slashed, &URL_SAFE);
    format!("{FILE_URL_PREFIX}{encoded}")
}

const FAKE_SVN_EXE: &str = "svn.exe";
const FAKE_SVN_SOURCE: &str = "fake_svn.rs";

pub struct FakeSvn {
    pub version: &'static str,
    pub stdout: &'static str,
    pub stderr: &'static str,
    pub exit_code: i32,
}

impl FakeSvn {
    pub fn with_version(version: &'static str) -> Self {
        Self {
            version,
            stdout: "",
            stderr: "",
            exit_code: 0,
        }
    }

    pub fn build(&self, dir: &Path) -> std::path::PathBuf {
        let source = dir.join(FAKE_SVN_SOURCE);
        let program = format!(
            "fn main() {{ if std::env::args().any(|a| a == \"--version\") {{ println!(\"{{}}\", {:?}); return; }} \
             let mut sink = String::new(); let _ = std::io::Read::read_to_string(&mut std::io::stdin(), &mut sink); \
             print!(\"{{}}\", {:?}); eprint!(\"{{}}\", {:?}); std::process::exit({}); }}",
            self.version, self.stdout, self.stderr, self.exit_code
        );
        std::fs::write(&source, program).unwrap();
        let output = dir.join(FAKE_SVN_EXE);
        let status = Command::new("rustc")
            .arg(&source)
            .arg("-o")
            .arg(&output)
            .status()
            .expect("se necesita rustc para compilar el svn.exe falso");
        assert!(status.success(), "no se pudo compilar el svn.exe falso");
        output
    }
}

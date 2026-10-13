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

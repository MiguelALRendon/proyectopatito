#![allow(dead_code)]

pub mod containers;

use std::path::Path;
use std::process::Command;

use dakedaduck_svn_lib::svn::locator::{SvnBinary, locate};
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
    pub delay_ms: u64,
}

impl FakeSvn {
    pub fn with_version(version: &'static str) -> Self {
        Self {
            version,
            stdout: "",
            stderr: "",
            exit_code: 0,
            delay_ms: 0,
        }
    }

    pub fn build(&self, dir: &Path) -> std::path::PathBuf {
        let source = dir.join(FAKE_SVN_SOURCE);
        let program = format!(
            "fn main() {{ std::thread::sleep(std::time::Duration::from_millis({})); if std::env::args().any(|a| a == \"--version\") {{ println!(\"{{}}\", {:?}); return; }} \
             let mut sink = String::new(); let _ = std::io::Read::read_to_string(&mut std::io::stdin(), &mut sink); \
             print!(\"{{}}\", {:?}); eprint!(\"{{}}\", {:?}); std::process::exit({}); }}",
            self.delay_ms, self.version, self.stdout, self.stderr, self.exit_code
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

const SVNSERVE_RELATIVE: &str = "../.tools/apache-subversion/svnserve.exe";
const SVNSERVE_OVERRIDE_VAR: &str = "SVNSERVE_BIN";
const LOOPBACK: &str = "127.0.0.1";
const SERVER_READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const SERVER_POLL: std::time::Duration = std::time::Duration::from_millis(50);
const SVNSERVE_CONF: &str =
    "[general]\nanon-access = none\nauth-access = write\npassword-db = passwd\n";

pub struct TestServer {
    child: std::process::Child,
    pub url: String,
}

impl TestServer {
    pub fn start(repo: &TestRepo, user: &str, password: &str) -> Self {
        let svnserve = std::env::var_os(SVNSERVE_OVERRIDE_VAR).map_or_else(
            || std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SVNSERVE_RELATIVE),
            std::path::PathBuf::from,
        );
        assert!(
            svnserve.is_file(),
            "falta {}; ejecuta: pwsh scripts/fetch-svnserve.ps1",
            svnserve.display()
        );
        let conf = repo._dir.path().join("conf");
        std::fs::write(conf.join("svnserve.conf"), SVNSERVE_CONF).unwrap();
        std::fs::write(
            conf.join("passwd"),
            format!("[users]\n{user} = {password}\n"),
        )
        .unwrap();
        let port = free_port();
        let child = Command::new(svnserve)
            .args([
                "-d",
                "--foreground",
                "--listen-host",
                LOOPBACK,
                "--listen-port",
            ])
            .arg(port.to_string())
            .arg("-r")
            .arg(repo._dir.path())
            .spawn()
            .expect("no se pudo lanzar svnserve");
        wait_until_listening(port);
        Self {
            child,
            url: format!("svn://{LOOPBACK}:{port}"),
        }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

fn free_port() -> u16 {
    let listener = std::net::TcpListener::bind((LOOPBACK, 0)).unwrap();
    listener.local_addr().unwrap().port()
}

fn wait_until_listening(port: u16) {
    let deadline = std::time::Instant::now() + SERVER_READY_TIMEOUT;
    while std::net::TcpStream::connect((LOOPBACK, port)).is_err() {
        assert!(std::time::Instant::now() < deadline, "svnserve no arrancó");
        std::thread::sleep(SERVER_POLL);
    }
}

const TLS_SERVER_SCRIPT: &str = "tests/common/tls_server.ps1";
const HTTP_AUTH_SERVER_SCRIPT: &str = "tests/common/http_auth_server.ps1";
const POWERSHELL: &str = "pwsh";

pub struct ScriptServer {
    child: std::process::Child,
    pub url: String,
}

impl ScriptServer {
    pub fn tls() -> Self {
        Self::start(TLS_SERVER_SCRIPT, "https", &[])
    }

    pub fn http_auth(user: &str, password: &str) -> Self {
        Self::start(HTTP_AUTH_SERVER_SCRIPT, "http", &[user, password])
    }

    fn start(script: &str, scheme: &str, credentials: &[&str]) -> Self {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(script);
        let port = free_port();
        let mut command = Command::new(POWERSHELL);
        command.args(["-NoProfile", "-File"]).arg(script);
        command.arg("-Port").arg(port.to_string());
        if let [user, password] = credentials {
            command.args(["-User", user, "-Password", password]);
        }
        let child = command
            .spawn()
            .expect("se necesita pwsh para los servidores de prueba");
        wait_until_listening(port);
        Self {
            child,
            url: format!("{scheme}://{LOOPBACK}:{port}/repo"),
        }
    }
}

impl Drop for ScriptServer {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

const STALLING_HOOK: &str = "@echo off
echo x > \"%~dp0started.flag\"
ping -n 9 127.0.0.1 >nul
";
const FLAG_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

pub fn install_stalling_hook(repo: &TestRepo) -> std::path::PathBuf {
    let hooks = repo._dir.path().join("hooks");
    std::fs::write(hooks.join("pre-commit.bat"), STALLING_HOOK).unwrap();
    hooks.join("started.flag")
}

pub async fn wait_for_file(path: &Path) {
    let deadline = std::time::Instant::now() + FLAG_WAIT;
    while !path.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "el hook nunca arrancó"
        );
        tokio::time::sleep(SERVER_POLL).await;
    }
}

use std::env;
use std::ffi::OsStr;
use std::fmt;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use thiserror::Error;

use crate::svn::runner::CREATE_NO_WINDOW;

pub const MIN_VERSION: SvnVersion = SvnVersion {
    major: 1,
    minor: 10,
    patch: 0,
};

pub const SVN_EXE: &str = "svn.exe";
const PROGRAM_FILES_VAR: &str = "ProgramFiles";
const PATH_VAR: &str = "PATH";
const KNOWN_INSTALL_DIRS: [&str; 3] =
    [r"TortoiseSVN\bin", r"SlikSvn\bin", r"Apache Subversion\bin"];
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_POLL_INTERVAL: Duration = Duration::from_millis(25);
const VERSION_ARGS: [&str; 2] = ["--version", "--quiet"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SvnVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl fmt::Display for SvnVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SvnBinary {
    pub path: PathBuf,
    pub version: SvnVersion,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LocatorError {
    #[error("no se encontró svn.exe (se requiere Subversion {MIN_VERSION} o superior)")]
    NotFound,
    #[error("la ruta indicada no es un svn.exe válido: {0}")]
    Invalid(PathBuf),
    #[error("svn {found} en {path} es anterior a la mínima requerida {required}")]
    TooOld {
        path: PathBuf,
        found: SvnVersion,
        required: SvnVersion,
    },
}

enum ProbeFailure {
    Unusable,
    TooOld(SvnVersion),
}

pub fn parse_version(text: &str) -> Option<SvnVersion> {
    let numeric: String = text
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let parts: Vec<u32> = numeric
        .split('.')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    let [major, minor, patch] = parts[..] else {
        return None;
    };
    Some(SvnVersion {
        major,
        minor,
        patch,
    })
}

pub fn locate(manual: Option<&Path>) -> Result<SvnBinary, LocatorError> {
    locate_in(manual, &default_search_dirs())
}

pub fn locate_in(
    manual: Option<&Path>,
    search_dirs: &[PathBuf],
) -> Result<SvnBinary, LocatorError> {
    if let Some(path) = manual {
        return probe(path).map_err(|failure| failure_to_error(path, failure));
    }
    let candidates = search_dirs
        .iter()
        .map(|dir| dir.join(SVN_EXE))
        .filter(|path| path.is_file());
    let mut too_old = None;
    for path in candidates {
        match probe(&path) {
            Ok(binary) => return Ok(binary),
            Err(ProbeFailure::TooOld(found)) => too_old = too_old.or(Some((path, found))),
            Err(ProbeFailure::Unusable) => {}
        }
    }
    match too_old {
        Some((path, found)) => Err(too_old_error(path, found)),
        None => Err(LocatorError::NotFound),
    }
}

fn default_search_dirs() -> Vec<PathBuf> {
    let path = env::var_os(PATH_VAR);
    let program_files = env::var_os(PROGRAM_FILES_VAR).map(PathBuf::from);
    search_dirs(path.as_deref(), program_files.as_deref())
}

pub fn search_dirs(path: Option<&OsStr>, program_files: Option<&Path>) -> Vec<PathBuf> {
    let path_dirs = path.map(env::split_paths).into_iter().flatten();
    let known = program_files
        .into_iter()
        .flat_map(|root| KNOWN_INSTALL_DIRS.map(|dir| root.join(dir)));
    path_dirs.chain(known).collect()
}

fn probe(path: &Path) -> Result<SvnBinary, ProbeFailure> {
    let text = version_output(path).ok_or(ProbeFailure::Unusable)?;
    let version = parse_version(&text).ok_or(ProbeFailure::Unusable)?;
    if version < MIN_VERSION {
        return Err(ProbeFailure::TooOld(version));
    }
    Ok(SvnBinary {
        path: path.to_path_buf(),
        version,
    })
}

fn version_output(path: &Path) -> Option<String> {
    let mut child = Command::new(path)
        .args(VERSION_ARGS)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().ok();
            child.wait().ok();
            return None;
        }
        thread::sleep(PROBE_POLL_INTERVAL);
    };
    let mut text = String::new();
    child.stdout.take()?.read_to_string(&mut text).ok()?;
    status.success().then_some(text)
}

fn failure_to_error(path: &Path, failure: ProbeFailure) -> LocatorError {
    match failure {
        ProbeFailure::Unusable => LocatorError::Invalid(path.to_path_buf()),
        ProbeFailure::TooOld(found) => too_old_error(path.to_path_buf(), found),
    }
}

fn too_old_error(path: PathBuf, found: SvnVersion) -> LocatorError {
    LocatorError::TooOld {
        path,
        found,
        required: MIN_VERSION,
    }
}

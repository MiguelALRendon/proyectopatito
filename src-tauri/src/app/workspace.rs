use std::ffi::OsStr;
use std::io;
use std::path::{Component, Path, PathBuf, Prefix};

use thiserror::Error;

const VERBATIM_PREFIX: &str = r"\\?\";
const VERBATIM_UNC_PREFIX: &str = r"\\?\UNC\";
const UNC_PREFIX: &str = r"\\";
const RESERVED_DEVICE_NAMES: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
const NUMBERED_DEVICE_PREFIXES: [&str; 2] = ["COM", "LPT"];

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("la ruta queda fuera del workspace")]
    OutsideWorkspace,
    #[error("la ruta contiene componentes '..'")]
    ParentTraversal,
    #[error("la ruta usa un dispositivo o nombre reservado de Windows")]
    DeviceOrReservedPath,
    #[error("el destino ya existe")]
    DestinationExists,
    #[error("la raíz del workspace no existe o no es un directorio")]
    RootInvalid,
    #[error("error de E/S: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRoot(PathBuf);

impl WorkspaceRoot {
    pub fn as_path(&self) -> &Path {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopedPath(PathBuf);

impl ScopedPath {
    pub fn as_path(&self) -> &Path {
        &self.0
    }
}

#[derive(Debug, Clone)]
pub struct Workspace {
    root: WorkspaceRoot,
}

impl Workspace {
    pub fn new(path: &Path) -> Result<Workspace, WorkspaceError> {
        let canonical = std::fs::canonicalize(path).map_err(|_| WorkspaceError::RootInvalid)?;
        if !canonical.is_dir() {
            return Err(WorkspaceError::RootInvalid);
        }
        Ok(Workspace {
            root: WorkspaceRoot(strip_verbatim(canonical)),
        })
    }

    pub fn root(&self) -> &WorkspaceRoot {
        &self.root
    }

    pub fn resolve(
        &self,
        path: &Path,
        allow_overwrite: bool,
    ) -> Result<ScopedPath, WorkspaceError> {
        reject_unsafe_components(path)?;
        let resolved = canonicalize_deepest_ancestor(&self.root.0.join(path))?;
        self.ensure_contained(&resolved)?;
        if !allow_overwrite && resolved.exists() {
            return Err(WorkspaceError::DestinationExists);
        }
        Ok(ScopedPath(resolved))
    }

    pub fn revalidate(&self, scoped: &ScopedPath) -> Result<(), WorkspaceError> {
        let current = canonicalize_deepest_ancestor(scoped.as_path())?;
        self.ensure_contained(&current)
    }

    fn ensure_contained(&self, candidate: &Path) -> Result<(), WorkspaceError> {
        if component_keys(candidate).starts_with(&component_keys(&self.root.0)) {
            return Ok(());
        }
        Err(WorkspaceError::OutsideWorkspace)
    }
}

fn reject_unsafe_components(path: &Path) -> Result<(), WorkspaceError> {
    for component in path.components() {
        match component {
            Component::ParentDir => return Err(WorkspaceError::ParentTraversal),
            Component::Prefix(prefix) if !is_plain_prefix(prefix.kind()) => {
                return Err(WorkspaceError::DeviceOrReservedPath);
            }
            Component::Normal(name) if is_reserved_device_name(name) || is_ambiguous_name(name) => {
                return Err(WorkspaceError::DeviceOrReservedPath);
            }
            _ => {}
        }
    }
    Ok(())
}

fn is_ambiguous_name(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    name.ends_with(['.', ' ']) || name.contains(':')
}

fn is_plain_prefix(kind: Prefix<'_>) -> bool {
    matches!(kind, Prefix::Disk(_) | Prefix::UNC(..))
}

fn is_reserved_device_name(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    let stem = name.split('.').next().unwrap_or_default().trim_end();
    let upper = stem.to_uppercase();
    RESERVED_DEVICE_NAMES.contains(&upper.as_str()) || is_numbered_device_name(&upper)
}

fn is_numbered_device_name(upper: &str) -> bool {
    NUMBERED_DEVICE_PREFIXES.iter().any(|prefix| {
        upper.strip_prefix(prefix).is_some_and(|digits| {
            let mut chars = digits.chars();
            matches!(
                (chars.next(), chars.next()),
                (Some('1'..='9' | '¹' | '²' | '³'), None)
            )
        })
    })
}

fn canonicalize_deepest_ancestor(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let mut ancestor = path;
    let mut tail: Vec<&OsStr> = Vec::new();
    loop {
        match std::fs::canonicalize(ancestor) {
            Ok(base) if !tail.is_empty() && !base.is_dir() => {
                return Err(io::Error::from(io::ErrorKind::NotADirectory).into());
            }
            Ok(base) => return Ok(append_tail(strip_verbatim(base), &tail)),
            Err(error) if is_missing_entry(ancestor, &error) => {
                let (Some(name), Some(parent)) = (ancestor.file_name(), ancestor.parent()) else {
                    return Err(error.into());
                };
                tail.push(name);
                ancestor = parent;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn is_missing_entry(path: &Path, error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::NotFound && path.symlink_metadata().is_err()
}

fn append_tail(base: PathBuf, reversed_tail: &[&OsStr]) -> PathBuf {
    reversed_tail
        .iter()
        .rev()
        .fold(base, |acc, name| acc.join(name))
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let stripped = path
        .to_str()
        .and_then(|text| match text.strip_prefix(VERBATIM_UNC_PREFIX) {
            Some(unc) => Some(format!("{UNC_PREFIX}{unc}")),
            None => text.strip_prefix(VERBATIM_PREFIX).map(str::to_owned),
        });
    stripped.map_or(path, PathBuf::from)
}

fn component_keys(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

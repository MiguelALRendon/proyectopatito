mod edit;
mod external;
mod serve;
mod text;
mod version;

use std::fs::{self, DirEntry, File, Metadata};
use std::io::{self, Read};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use thiserror::Error;

use crate::app::operations::{OperationManager, WorkingCopyBusy};
use crate::app::sniff::{CLOUD_PLACEHOLDER, ProbeKind, SNIFF_BYTES, Sample, Sniffed, classify};
use crate::app::wc_status::StatusCache;
use crate::app::workspace::{ScopedPath, Workspace, WorkspaceError, component_keys};

pub use external::{Launcher, OPENABLE_EXTENSIONS, SystemLauncher};
pub use serve::Served;
pub use text::{
    Encoding, Eol, HEX_CHUNK, MAX_EDITABLE_BYTES, MAX_EDITABLE_MIB, TextDocument, TextUpdate,
    TextWritten,
};

pub const MAX_LIST_ENTRIES: usize = 20_000;

pub const FILE_ATTRIBUTE_READONLY: u32 = 0x1;
pub const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
pub const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
pub const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
pub const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x4_0000;
pub const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
const CLOUD_ATTRIBUTES: u32 =
    FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS;

const SVN_ADMIN_DIR: &str = ".svn";
const FORBIDDEN_NAMES: [&str; 2] = [SVN_ADMIN_DIR, "_svn"];
const TEMP_SUFFIX: &str = ".dd-tmp";

#[derive(Debug, Error)]
pub enum FileError {
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error("la ruta no es un directorio")]
    NotADirectory,
    #[error("la ruta no es un archivo")]
    NotAFile,
    #[error("el acceso a los datos internos de Subversion (.svn, _svn) no está permitido")]
    ForbiddenPath,
    #[error("el archivo no es texto UTF-8 ni UTF-16 con marca BOM; no se puede abrir como texto")]
    NotText,
    #[error(
        "el archivo supera el tamaño máximo que admite el editor ({} MiB)",
        MAX_EDITABLE_MIB
    )]
    TooLarge,
    #[error("el archivo cambió en disco desde que se abrió")]
    FileChanged,
    #[error("el archivo es de solo lectura")]
    ReadOnly,
    #[error("otro programa tiene el archivo abierto y no se puede reemplazar")]
    FileLocked,
    #[error("el archivo está solo en la nube; descárgalo antes de abrirlo")]
    CloudOnly,
    #[error(
        "este archivo no se abre con la aplicación predeterminada: solo se admiten formatos de datos conocidos, nunca ejecutables ni scripts"
    )]
    NotAllowed,
    #[error(transparent)]
    Busy(#[from] WorkingCopyBusy),
    #[error("error de E/S: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Dir,
}

impl EntryKind {
    fn of(is_dir: bool) -> Self {
        if is_dir { Self::Dir } else { Self::File }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub hidden: bool,
    pub read_only: bool,
    pub is_link: bool,
    pub escapes_workspace: bool,
    pub cloud_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WcLocation {
    pub root: String,
    pub is_root: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
    pub wc: Option<WcLocation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileProbe {
    pub kind: ProbeKind,
    pub mime: &'static str,
    pub len: u64,
    pub extension: Option<&'static str>,
}

impl FileProbe {
    fn new(sniffed: Sniffed, len: u64) -> Self {
        Self {
            kind: sniffed.kind,
            mime: sniffed.mime,
            len,
            extension: sniffed.extension,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FileFacts {
    pub len: u64,
    pub attributes: u32,
}

#[derive(Clone)]
pub struct FileService {
    workspace: Workspace,
    max_entries: usize,
    manager: Arc<OperationManager>,
    statuses: Arc<StatusCache>,
}

impl FileService {
    pub fn new(workspace: Workspace, manager: Arc<OperationManager>) -> Self {
        Self {
            workspace,
            max_entries: MAX_LIST_ENTRIES,
            manager,
            statuses: Arc::default(),
        }
    }

    pub fn with_statuses(self, statuses: Arc<StatusCache>) -> Self {
        Self { statuses, ..self }
    }

    pub fn with_max_entries(self, max_entries: usize) -> Self {
        Self {
            max_entries,
            ..self
        }
    }

    pub fn scope(&self, path: &Path) -> Result<ScopedPath, FileError> {
        Ok(self.workspace.resolve(path, true)?)
    }

    pub fn list(&self, dir: &ScopedPath) -> Result<DirListing, FileError> {
        self.guard(dir)?;
        if !fs::metadata(dir.as_path())?.is_dir() {
            return Err(FileError::NotADirectory);
        }
        let (entries, truncated) = self.read_entries(dir.as_path())?;
        Ok(DirListing {
            path: self.relative(dir.as_path()),
            entries,
            truncated,
            wc: self.find_wc_root(dir.as_path()),
        })
    }

    pub fn probe(&self, file: &ScopedPath, allow_download: bool) -> Result<FileProbe, FileError> {
        self.guard(file)?;
        let metadata = fs::metadata(file.as_path())?;
        if !metadata.is_file() {
            return Err(FileError::NotAFile);
        }
        let facts = FileFacts {
            len: metadata.len(),
            attributes: metadata.file_attributes(),
        };
        Ok(probe_facts(file.as_path(), facts, allow_download)?)
    }

    fn guard(&self, scoped: &ScopedPath) -> Result<(), FileError> {
        self.workspace.revalidate(scoped)?;
        let relative = self.workspace.relative_path(scoped.as_path());
        if component_keys(&relative)
            .iter()
            .any(|key| is_forbidden_name(key))
        {
            return Err(FileError::ForbiddenPath);
        }
        Ok(())
    }

    fn read_entries(&self, dir: &Path) -> io::Result<(Vec<FileEntry>, bool)> {
        let mut entries = Vec::new();
        for item in fs::read_dir(dir)? {
            let item = item?;
            if is_hidden_from_listing(&item.file_name().to_string_lossy()) {
                continue;
            }
            if entries.len() == self.max_entries {
                return Ok((entries, true));
            }
            entries.extend(self.entry(&item));
        }
        Ok((entries, false))
    }

    fn entry(&self, item: &DirEntry) -> Option<FileEntry> {
        self.describe(item, item.metadata())
    }

    fn describe(&self, item: &DirEntry, metadata: io::Result<Metadata>) -> Option<FileEntry> {
        let metadata = metadata.ok()?;
        let attributes = metadata.file_attributes();
        let is_dir = has_attribute(attributes, FILE_ATTRIBUTE_DIRECTORY);
        let is_link = metadata.file_type().is_symlink();
        Some(FileEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            kind: EntryKind::of(is_dir),
            size: if is_dir { 0 } else { metadata.len() },
            modified_ms: modified_millis(&metadata),
            hidden: has_attribute(attributes, FILE_ATTRIBUTE_HIDDEN),
            read_only: has_attribute(attributes, FILE_ATTRIBUTE_READONLY),
            is_link,
            escapes_workspace: is_link && !self.workspace.is_inside(&item.path()),
            cloud_only: !is_dir && is_cloud_only(attributes),
        })
    }

    fn regular_file(&self, file: &ScopedPath) -> Result<Metadata, FileError> {
        self.guard(file)?;
        let metadata = fs::symlink_metadata(file.as_path())?;
        if !metadata.is_file() {
            return Err(FileError::NotAFile);
        }
        if is_cloud_only(metadata.file_attributes()) {
            return Err(FileError::CloudOnly);
        }
        Ok(metadata)
    }

    fn working_copy_root(&self, dir: &Path) -> Option<PathBuf> {
        let depth = self.workspace.relative_path(dir).components().count();
        dir.ancestors()
            .take(depth + 1)
            .find(|candidate| candidate.join(SVN_ADMIN_DIR).is_dir())
            .map(Path::to_path_buf)
    }

    fn find_wc_root(&self, dir: &Path) -> Option<WcLocation> {
        let root = self.working_copy_root(dir)?;
        Some(WcLocation {
            root: self.relative(&root),
            is_root: root == dir,
        })
    }

    fn relative(&self, path: &Path) -> String {
        self.workspace
            .relative_path(path)
            .to_string_lossy()
            .into_owned()
    }
}

pub fn is_cloud_only(attributes: u32) -> bool {
    attributes & CLOUD_ATTRIBUTES != 0
}

pub fn probe_facts(path: &Path, facts: FileFacts, allow_download: bool) -> io::Result<FileProbe> {
    if is_cloud_only(facts.attributes) && !allow_download {
        return Ok(FileProbe::new(CLOUD_PLACEHOLDER, facts.len));
    }
    let head = read_head(path)?;
    let truncated = facts.len > head.len() as u64;
    let sniffed = classify(Sample {
        bytes: &head,
        truncated,
    });
    Ok(FileProbe::new(sniffed, facts.len))
}

fn read_head(path: &Path) -> io::Result<Vec<u8>> {
    let mut head = Vec::new();
    File::open(path)?
        .take(SNIFF_BYTES as u64)
        .read_to_end(&mut head)?;
    Ok(head)
}

pub(crate) fn is_forbidden_name(name: &str) -> bool {
    FORBIDDEN_NAMES.contains(&name.to_lowercase().as_str())
}

fn is_hidden_from_listing(name: &str) -> bool {
    is_forbidden_name(name) || name.ends_with(TEMP_SUFFIX)
}

fn has_attribute(attributes: u32, flag: u32) -> bool {
    attributes & flag != 0
}

fn modified_millis(metadata: &Metadata) -> Option<u64> {
    let elapsed = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(elapsed.as_millis()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_entry_whose_metadata_cannot_be_read_is_omitted() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), b"x").unwrap();
        let service = FileService::new(Workspace::new(dir.path()).unwrap(), Arc::default());
        let item = fs::read_dir(dir.path()).unwrap().next().unwrap().unwrap();
        let unreadable = Err(io::ErrorKind::PermissionDenied.into());
        assert!(service.describe(&item, unreadable).is_none());
        let readable = service.describe(&item, item.metadata());
        assert_eq!(readable.unwrap().name, "a.txt");
    }
}

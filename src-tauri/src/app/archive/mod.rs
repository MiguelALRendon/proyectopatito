pub mod extract;
pub mod limits;
pub mod listing;
mod reader_7z;
mod reader_rar;
mod reader_tar;
mod reader_zip;
pub mod safety;
pub mod service;
pub mod tasks;

use std::io::{self, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use thiserror::Error;

use self::limits::ERROR_DISK_FULL;
pub use self::listing::Suspicion;
use crate::app::operations::WorkingCopyBusy;
use crate::app::workspace::WorkspaceError;

pub type Cancel = Arc<AtomicBool>;

const SUFFIXES: [(&str, ArchiveFormat); 11] = [
    (".tar.gz", ArchiveFormat::TarGz),
    (".tgz", ArchiveFormat::TarGz),
    (".tar.bz2", ArchiveFormat::TarBz2),
    (".tbz2", ArchiveFormat::TarBz2),
    (".tbz", ArchiveFormat::TarBz2),
    (".tar.xz", ArchiveFormat::TarXz),
    (".txz", ArchiveFormat::TarXz),
    (".tar", ArchiveFormat::Tar),
    (".zip", ArchiveFormat::Zip),
    (".7z", ArchiveFormat::SevenZ),
    (".rar", ArchiveFormat::Rar),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveFormat {
    Zip,
    Tar,
    TarGz,
    TarBz2,
    TarXz,
    SevenZ,
    Rar,
}

fn matching_suffix(file_name: &str) -> Option<(usize, ArchiveFormat)> {
    let lower = file_name.to_lowercase();
    SUFFIXES
        .iter()
        .find(|(suffix, _)| lower.ends_with(suffix))
        .map(|(suffix, format)| (suffix.len(), *format))
}

impl ArchiveFormat {
    pub fn of_file_name(file_name: &str) -> Option<Self> {
        matching_suffix(file_name).map(|(_, format)| format)
    }
}

pub fn folder_stem(file_name: &str) -> String {
    let Some((suffix_len, _)) = matching_suffix(file_name) else {
        return file_name.to_owned();
    };
    let keep = file_name.len().saturating_sub(suffix_len);
    file_name[..keep].to_owned()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Directory,
    Link,
    Device,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub packed: Option<u64>,
    pub is_encrypted: bool,
}

pub enum Decision {
    Skip,
    Write(Box<dyn Write>),
    Stop,
}

pub trait EntryHandler {
    fn wants_data(&self) -> bool;
    fn start(&mut self, entry: &Entry) -> Result<Decision, ArchiveError>;
    fn finish(&mut self, entry: &Entry) -> Result<(), ArchiveError>;
}

#[derive(Debug, Error)]
pub(crate) enum Interrupt {
    #[error("operación cancelada")]
    Cancelled,
    #[error("un archivo supera el tope de tamaño")]
    EntryLimit,
    #[error("la extracción supera el tope total")]
    TotalLimit,
    #[error("la lectura supera el tope")]
    ReadLimit,
}

pub(crate) fn interrupt(kind: Interrupt) -> io::Error {
    io::Error::other(kind)
}

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("el archivo está dañado o truncado: {0}")]
    Corrupt(String),
    #[error("el archivo está cifrado y no se piden contraseñas")]
    Encrypted,
    #[error("el archivo supera un tope de seguridad: {0}")]
    Limit(String),
    #[error("formato o método de compresión no compatible: {0}")]
    Unsupported(String),
    #[error("entrada insegura: {0}")]
    UnsafeEntry(String),
    #[error("el archivo parece una bomba de descompresión y hay que confirmarlo")]
    NeedsConfirmation(Vec<Suspicion>),
    #[error("operación cancelada")]
    Cancelled,
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error("la copia de trabajo está ocupada con otra operación")]
    Busy(WorkingCopyBusy),
    #[error("error de E/S: {0}")]
    Io(io::Error),
}

impl From<WorkingCopyBusy> for ArchiveError {
    fn from(busy: WorkingCopyBusy) -> Self {
        Self::Busy(busy)
    }
}

impl From<&Interrupt> for ArchiveError {
    fn from(kind: &Interrupt) -> Self {
        match kind {
            Interrupt::Cancelled => Self::Cancelled,
            other => Self::Limit(other.to_string()),
        }
    }
}

pub(crate) fn interrupt_of(error: &io::Error) -> Option<&Interrupt> {
    error.get_ref()?.downcast_ref::<Interrupt>()
}

impl From<io::Error> for ArchiveError {
    fn from(error: io::Error) -> Self {
        if let Some(kind) = interrupt_of(&error) {
            return kind.into();
        }
        if is_xz_memory_limit(&error) {
            return Self::Limit(
                "el archivo exige más memoria de la permitida para descomprimirlo".to_owned(),
            );
        }
        if error.raw_os_error() == Some(ERROR_DISK_FULL) {
            return Self::Limit("no hay espacio libre en el disco".to_owned());
        }
        match error.kind() {
            io::ErrorKind::UnexpectedEof
            | io::ErrorKind::InvalidData
            | io::ErrorKind::InvalidInput => Self::Corrupt(error.to_string()),
            _ => Self::Io(error),
        }
    }
}

fn is_xz_memory_limit(error: &io::Error) -> bool {
    let inner = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<liblzma::stream::Error>());
    matches!(inner, Some(liblzma::stream::Error::MemLimit))
}

pub(crate) fn ensure_running(cancel: &Cancel) -> Result<(), ArchiveError> {
    if cancel.load(Ordering::Relaxed) {
        return Err(ArchiveError::Cancelled);
    }
    Ok(())
}

pub(crate) fn limit(message: &str) -> ArchiveError {
    ArchiveError::Limit(message.to_owned())
}

pub(crate) fn classify_library_error(message: String) -> ArchiveError {
    let lower = message.to_lowercase();
    if lower.contains("password") || lower.contains("encrypt") {
        return ArchiveError::Encrypted;
    }
    if lower.contains("above the configured limit") || lower.contains("limit") {
        return ArchiveError::Limit(message);
    }
    if lower.contains("unsupported") || lower.contains("not supported") {
        return ArchiveError::Unsupported(message);
    }
    ArchiveError::Corrupt(message)
}

pub fn visit(
    path: &Path,
    format: ArchiveFormat,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<(), ArchiveError> {
    match format {
        ArchiveFormat::Zip => reader_zip::visit(path, cancel, handler),
        ArchiveFormat::SevenZ => reader_7z::visit(path, cancel, handler),
        ArchiveFormat::Rar => reader_rar::visit(path, cancel, handler),
        tarball => reader_tar::visit(path, tarball, cancel, handler),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_messages_are_classified_by_each_keyword_alone() {
        for message in ["wrong password", "data is encrypted"] {
            assert!(
                matches!(
                    classify_library_error(message.into()),
                    ArchiveError::Encrypted
                ),
                "{message}"
            );
        }
        for message in ["size limit hit", "above the configured limit"] {
            assert!(
                matches!(
                    classify_library_error(message.into()),
                    ArchiveError::Limit(_)
                ),
                "{message}"
            );
        }
        for message in ["unsupported method", "feature not supported"] {
            assert!(
                matches!(
                    classify_library_error(message.into()),
                    ArchiveError::Unsupported(_)
                ),
                "{message}"
            );
        }
        assert!(matches!(
            classify_library_error("bad header".into()),
            ArchiveError::Corrupt(_)
        ));
    }

    #[test]
    fn io_errors_keep_their_meaning() {
        assert!(matches!(
            ArchiveError::from(interrupt(Interrupt::Cancelled)),
            ArchiveError::Cancelled
        ));
        for kind in [
            Interrupt::EntryLimit,
            Interrupt::TotalLimit,
            Interrupt::ReadLimit,
        ] {
            assert!(matches!(
                ArchiveError::from(interrupt(kind)),
                ArchiveError::Limit(_)
            ));
        }
        let full = io::Error::from_raw_os_error(ERROR_DISK_FULL);
        assert!(matches!(ArchiveError::from(full), ArchiveError::Limit(_)));
        for kind in [
            io::ErrorKind::UnexpectedEof,
            io::ErrorKind::InvalidData,
            io::ErrorKind::InvalidInput,
        ] {
            assert!(matches!(
                ArchiveError::from(io::Error::from(kind)),
                ArchiveError::Corrupt(_)
            ));
        }
        let denied = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(matches!(ArchiveError::from(denied), ArchiveError::Io(_)));
    }

    #[test]
    fn formats_come_from_the_longest_suffix_in_any_case() {
        assert_eq!(
            ArchiveFormat::of_file_name("A.TAR.GZ"),
            Some(ArchiveFormat::TarGz)
        );
        assert_eq!(
            ArchiveFormat::of_file_name("a.tbz"),
            Some(ArchiveFormat::TarBz2)
        );
        assert_eq!(
            ArchiveFormat::of_file_name("a.txz"),
            Some(ArchiveFormat::TarXz)
        );
        assert_eq!(
            ArchiveFormat::of_file_name("a.tar"),
            Some(ArchiveFormat::Tar)
        );
        assert_eq!(ArchiveFormat::of_file_name("a.txt"), None);
        assert_eq!(folder_stem("v1.2.tar.gz"), "v1.2");
        assert_eq!(folder_stem("notes.txt"), "notes.txt");
        assert_eq!(folder_stem(".zip"), "");
    }
}

use serde::Serialize;

use crate::app::archive::ArchiveError;
use crate::app::files::FileError;
use crate::app::operations::OperationError;
use crate::app::ui_state::UiStateError;
use crate::app::workspace::WorkspaceError;
use crate::svn::client::SvnClientError;
use crate::svn::error::{SvnError, SvnErrorKind};
use crate::svn::locator::LocatorError;

const MESSAGE_INVALID_URL: &str =
    "la URL no es válida: use http, https, svn, svn+ssh o file, sin contraseña incrustada";
const MAX_DETAIL_CHARS: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorKind {
    NoWorkspace,
    NoSvn,
    OutsideWorkspace,
    DestinationExists,
    InvalidPath,
    AuthRequired,
    UntrustedCertificate,
    WorkingCopyTooOld,
    WorkingCopyLocked,
    Cancelled,
    TimedOut,
    SvnFailed,
    ParseFailed,
    Io,
    NotADirectory,
    ForbiddenPath,
    NotText,
    TooLarge,
    FileChanged,
    ReadOnly,
    FileLocked,
    WorkingCopyBusy,
    CloudOnly,
    NotAllowed,
    OfficeTooLarge,
    ArchiveCorrupt,
    ArchiveEncrypted,
    ArchiveLimit,
    ArchiveUnsupported,
    UnsafeEntry,
    ArchiveNeedsConfirmation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommandError {
    pub kind: CommandErrorKind,
    pub message: String,
    pub codes: Vec<String>,
    pub detail: Option<String>,
}

impl CommandError {
    pub fn new(kind: CommandErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            codes: Vec::new(),
            detail: None,
        }
    }

    pub fn no_workspace() -> Self {
        Self::new(
            CommandErrorKind::NoWorkspace,
            "Primero define la carpeta raíz del workspace.",
        )
    }
}

impl From<WorkspaceError> for CommandError {
    fn from(error: WorkspaceError) -> Self {
        let kind = match error {
            WorkspaceError::OutsideWorkspace => CommandErrorKind::OutsideWorkspace,
            WorkspaceError::DestinationExists => CommandErrorKind::DestinationExists,
            WorkspaceError::Io(_) => CommandErrorKind::Io,
            _ => CommandErrorKind::InvalidPath,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<FileError> for CommandError {
    fn from(error: FileError) -> Self {
        let kind = match error {
            FileError::Workspace(error) => return error.into(),
            FileError::NotADirectory => CommandErrorKind::NotADirectory,
            FileError::NotAFile => CommandErrorKind::InvalidPath,
            FileError::ForbiddenPath => CommandErrorKind::ForbiddenPath,
            FileError::NotText => CommandErrorKind::NotText,
            FileError::TooLarge => CommandErrorKind::TooLarge,
            FileError::OfficeTooLarge => CommandErrorKind::OfficeTooLarge,
            FileError::FileChanged => CommandErrorKind::FileChanged,
            FileError::ReadOnly => CommandErrorKind::ReadOnly,
            FileError::FileLocked => CommandErrorKind::FileLocked,
            FileError::CloudOnly => CommandErrorKind::CloudOnly,
            FileError::NotAllowed => CommandErrorKind::NotAllowed,
            FileError::Busy(_) => CommandErrorKind::WorkingCopyBusy,
            FileError::Io(_) => CommandErrorKind::Io,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<ArchiveError> for CommandError {
    fn from(error: ArchiveError) -> Self {
        let message = error.to_string();
        let kind = match error {
            ArchiveError::Workspace(error) => return error.into(),
            ArchiveError::Corrupt(_) => CommandErrorKind::ArchiveCorrupt,
            ArchiveError::Encrypted => CommandErrorKind::ArchiveEncrypted,
            ArchiveError::Limit(_) => CommandErrorKind::ArchiveLimit,
            ArchiveError::Unsupported(_) => CommandErrorKind::ArchiveUnsupported,
            ArchiveError::UnsafeEntry(_) => CommandErrorKind::UnsafeEntry,
            ArchiveError::Cancelled => CommandErrorKind::Cancelled,
            ArchiveError::Busy(_) => CommandErrorKind::WorkingCopyBusy,
            ArchiveError::Io(_) => CommandErrorKind::Io,
            ArchiveError::NeedsConfirmation(suspicions) => {
                let codes = suspicions.iter().map(|s| s.code().to_owned()).collect();
                return Self {
                    codes,
                    ..Self::new(CommandErrorKind::ArchiveNeedsConfirmation, message)
                };
            }
        };
        Self::new(kind, message)
    }
}

impl From<UiStateError> for CommandError {
    fn from(error: UiStateError) -> Self {
        let kind = match error {
            UiStateError::Workspace(error) => return error.into(),
            UiStateError::ForbiddenPath => CommandErrorKind::ForbiddenPath,
            _ => CommandErrorKind::InvalidPath,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::new(CommandErrorKind::Io, error.to_string())
    }
}

impl From<LocatorError> for CommandError {
    fn from(error: LocatorError) -> Self {
        Self::new(CommandErrorKind::NoSvn, error.to_string())
    }
}

impl From<OperationError> for CommandError {
    fn from(error: OperationError) -> Self {
        match error {
            OperationError::Workspace(error) => error.into(),
            OperationError::Svn(error) => error.into(),
            OperationError::InvalidUrl => {
                CommandError::new(CommandErrorKind::InvalidPath, MESSAGE_INVALID_URL)
            }
        }
    }
}

impl From<SvnClientError> for CommandError {
    fn from(error: SvnClientError) -> Self {
        match error {
            SvnClientError::Svn(error) => error.into(),
            SvnClientError::Parse(error) => {
                Self::new(CommandErrorKind::ParseFailed, error.to_string())
            }
            SvnClientError::MessageFile(error) => {
                Self::new(CommandErrorKind::Io, error.to_string())
            }
        }
    }
}

impl From<SvnError> for CommandError {
    fn from(error: SvnError) -> Self {
        let (kind, message) = describe_svn_kind(error.kind);
        Self {
            kind,
            message: message.to_string(),
            codes: error.codes,
            detail: trimmed_detail(&error.stderr),
        }
    }
}

fn describe_svn_kind(kind: SvnErrorKind) -> (CommandErrorKind, &'static str) {
    match kind {
        SvnErrorKind::AuthRequired => (
            CommandErrorKind::AuthRequired,
            "Se requieren credenciales válidas. Ingresa usuario y contraseña.",
        ),
        SvnErrorKind::UntrustedCertificate => (
            CommandErrorKind::UntrustedCertificate,
            "El certificado del servidor no es confiable. Acéptalo con otro cliente de Subversion (por ejemplo svn o TortoiseSVN) y reintenta.",
        ),
        SvnErrorKind::WorkingCopyTooOld => (
            CommandErrorKind::WorkingCopyTooOld,
            "La copia de trabajo tiene un formato antiguo. Ejecuta 'svn upgrade' con otro cliente de Subversion; esta aplicacion no la actualiza.",
        ),
        SvnErrorKind::WorkingCopyLocked => (
            CommandErrorKind::WorkingCopyLocked,
            "La copia de trabajo está bloqueada. Ejecuta una limpieza (cleanup) para liberarla.",
        ),
        SvnErrorKind::Cancelled => (CommandErrorKind::Cancelled, "Operación cancelada."),
        SvnErrorKind::TimedOut => (
            CommandErrorKind::TimedOut,
            "La operación excedió el tiempo límite.",
        ),
        SvnErrorKind::Other => (CommandErrorKind::SvnFailed, "Subversion terminó con error."),
    }
}

fn trimmed_detail(stderr: &str) -> Option<String> {
    let trimmed = stderr.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(MAX_DETAIL_CHARS).collect())
}

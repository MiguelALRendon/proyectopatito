use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use super::{FileError, FileService};
use crate::app::workspace::ScopedPath;

pub const OPENABLE_EXTENSIONS: [&str; 33] = [
    "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "zip", "7z", "rar", "tar", "gz", "bz2",
    "xz", "mp3", "mp4", "mkv", "avi", "mov", "wav", "flac", "ogg", "webm", "png", "jpg", "jpeg",
    "gif", "webp", "bmp", "ico", "txt", "md", "log",
];

const PE_SIGNATURE: &[u8] = b"MZ";

pub trait Launcher: Send + Sync {
    fn open(&self, path: &Path) -> io::Result<()>;
}

pub struct SystemLauncher;

impl Launcher for SystemLauncher {
    fn open(&self, path: &Path) -> io::Result<()> {
        opener::open(path).map_err(io::Error::other)
    }
}

impl FileService {
    pub fn can_open_external(&self, file: &ScopedPath) -> bool {
        self.ensure_openable(file).is_ok()
    }

    pub fn open_external(
        &self,
        file: &ScopedPath,
        launcher: &dyn Launcher,
    ) -> Result<(), FileError> {
        self.ensure_openable(file)?;
        Ok(launcher.open(file.as_path())?)
    }

    fn ensure_openable(&self, file: &ScopedPath) -> Result<(), FileError> {
        self.regular_file(file)?;
        if !has_openable_extension(file.as_path()) || starts_with_pe_signature(file.as_path())? {
            return Err(FileError::NotAllowed);
        }
        Ok(())
    }
}

fn has_openable_extension(path: &Path) -> bool {
    let extension = path.extension().and_then(|extension| extension.to_str());
    extension.is_some_and(|extension| {
        OPENABLE_EXTENSIONS
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(extension))
    })
}

fn starts_with_pe_signature(path: &Path) -> io::Result<bool> {
    let mut head = Vec::new();
    File::open(path)?
        .take(PE_SIGNATURE.len() as u64)
        .read_to_end(&mut head)?;
    Ok(head == PE_SIGNATURE)
}

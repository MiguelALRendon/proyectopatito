use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Seek, SeekFrom, Write};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};

use super::text::{decode_document, encode_document};
use super::version::version_of;
use super::{
    FILE_ATTRIBUTE_HIDDEN, FileError, FileService, HEX_CHUNK, MAX_EDITABLE_BYTES, MAX_OFFICE_BYTES,
    TEMP_SUFFIX, TextDocument, TextUpdate, TextWritten,
};
use crate::app::workspace::ScopedPath;

const ERROR_ACCESS_DENIED: i32 = 5;
const ERROR_SHARING_VIOLATION: i32 = 32;
const ERROR_LOCK_VIOLATION: i32 = 33;
const LOCKED_BY_OTHER_PROCESS: [i32; 3] = [
    ERROR_ACCESS_DENIED,
    ERROR_SHARING_VIOLATION,
    ERROR_LOCK_VIOLATION,
];
const MAX_TEMP_ATTEMPTS: usize = 8;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
const PRESERVED_ATTRIBUTES: u32 = FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM;

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

impl FileService {
    pub fn read_text(&self, file: &ScopedPath) -> Result<TextDocument, FileError> {
        let metadata = self.regular_file(file)?;
        if metadata.len() > MAX_EDITABLE_BYTES {
            return Err(FileError::TooLarge);
        }
        let bytes = read_bounded(file.as_path(), MAX_EDITABLE_BYTES)?;
        let version = version_of(&metadata, &bytes);
        decode_document(&bytes, version)
    }

    pub fn write_text(
        &self,
        file: &ScopedPath,
        update: &TextUpdate,
    ) -> Result<TextWritten, FileError> {
        self.ensure_writable(file)?;
        let bytes = encode_document(update);
        if bytes.len() as u64 > MAX_EDITABLE_BYTES {
            return Err(FileError::TooLarge);
        }
        let _lease = self
            .manager
            .try_lock_for_write(&self.lock_reference(file))?;
        self.ensure_writable(file)?;
        ensure_unchanged(file.as_path(), &update.expected_version, MAX_EDITABLE_BYTES)?;
        let version = replace_atomically(file.as_path(), &bytes)?;
        self.statuses.invalidate(file.as_path());
        Ok(TextWritten { version })
    }

    pub fn write_bytes(
        &self,
        file: &ScopedPath,
        expected_version: &str,
        bytes: &[u8],
    ) -> Result<TextWritten, FileError> {
        self.ensure_writable(file)?;
        if bytes.len() as u64 > MAX_OFFICE_BYTES {
            return Err(FileError::OfficeTooLarge);
        }
        let _lease = self
            .manager
            .try_lock_for_write(&self.lock_reference(file))?;
        self.ensure_writable(file)?;
        ensure_unchanged(file.as_path(), expected_version, MAX_OFFICE_BYTES)?;
        let version = replace_atomically(file.as_path(), bytes)?;
        self.statuses.invalidate(file.as_path());
        Ok(TextWritten { version })
    }

    pub fn read_chunk(
        &self,
        file: &ScopedPath,
        offset: u64,
        len: usize,
    ) -> Result<Vec<u8>, FileError> {
        if offset >= self.regular_file(file)?.len() {
            return Ok(Vec::new());
        }
        let mut source = File::open(file.as_path())?;
        source.seek(SeekFrom::Start(offset))?;
        let mut chunk = Vec::new();
        source
            .take(len.min(HEX_CHUNK) as u64)
            .read_to_end(&mut chunk)?;
        Ok(chunk)
    }

    fn ensure_writable(&self, file: &ScopedPath) -> Result<(), FileError> {
        if self.regular_file(file)?.permissions().readonly() {
            return Err(FileError::ReadOnly);
        }
        Ok(())
    }

    fn lock_reference(&self, file: &ScopedPath) -> PathBuf {
        file.as_path()
            .parent()
            .and_then(|dir| self.working_copy_root(dir))
            .unwrap_or_else(|| file.as_path().to_path_buf())
    }
}

pub(super) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, FileError> {
    let mut bytes = Vec::new();
    File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(FileError::TooLarge);
    }
    Ok(bytes)
}

fn ensure_unchanged(path: &Path, expected_version: &str, limit: u64) -> Result<(), FileError> {
    match current_version(path, limit) {
        Ok(version) if version == expected_version => Ok(()),
        Ok(_) | Err(FileError::TooLarge) => Err(FileError::FileChanged),
        Err(error) => Err(error),
    }
}

fn current_version(path: &Path, limit: u64) -> Result<String, FileError> {
    let metadata = fs::symlink_metadata(path)?;
    let bytes = read_bounded(path, limit)?;
    Ok(version_of(&metadata, &bytes))
}

fn replace_atomically(target: &Path, bytes: &[u8]) -> Result<String, FileError> {
    let (file, temp) = create_temp(target)?;
    let outcome = fill_temp(file, bytes)
        .map_err(FileError::from)
        .and_then(|()| publish(&temp, target, bytes));
    if outcome.is_err() {
        fs::remove_file(&temp).ok();
    }
    outcome
}

fn publish(temp: &Path, target: &Path, bytes: &[u8]) -> Result<String, FileError> {
    let version = version_of(&fs::symlink_metadata(temp)?, bytes);
    fs::rename(temp, target).map_err(rename_error)?;
    Ok(version)
}

fn fill_temp(mut file: File, bytes: &[u8]) -> io::Result<()> {
    file.write_all(bytes)?;
    file.sync_all()
}

fn preserved_attributes(target: &Path) -> u32 {
    fs::metadata(target).map_or(0, |meta| meta.file_attributes() & PRESERVED_ATTRIBUTES)
}

fn create_temp(target: &Path) -> io::Result<(File, PathBuf)> {
    let attributes = preserved_attributes(target);
    for _ in 0..MAX_TEMP_ATTEMPTS {
        let temp = temp_name(target, NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true).attributes(attributes);
        match options.open(&temp) {
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            opened => return opened.map(|file| (file, temp)),
        }
    }
    Err(ErrorKind::AlreadyExists.into())
}

fn temp_name(target: &Path, id: u64) -> PathBuf {
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    target.with_file_name(format!("{name}.{}-{id}{TEMP_SUFFIX}", process::id()))
}

fn rename_error(error: io::Error) -> FileError {
    match error.raw_os_error() {
        Some(code) if LOCKED_BY_OTHER_PROCESS.contains(&code) => FileError::FileLocked,
        _ => FileError::Io(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn occupy(target: &Path, id: u64) {
        File::create(temp_name(target, id)).unwrap();
    }

    #[test]
    fn a_taken_temp_name_is_skipped_and_the_search_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("notas.txt");
        let next = NEXT_TEMP_ID.load(Ordering::Relaxed);
        occupy(&target, next);
        let (_file, temp) = create_temp(&target).unwrap();
        assert_eq!(temp, temp_name(&target, next + 1));
        let after = NEXT_TEMP_ID.load(Ordering::Relaxed);
        (after..after + MAX_TEMP_ATTEMPTS as u64).for_each(|id| occupy(&target, id));
        let exhausted = create_temp(&target).unwrap_err();
        assert_eq!(exhausted.kind(), ErrorKind::AlreadyExists);
        let unreachable = dir.path().join("no-existe").join("notas.txt");
        assert_eq!(
            create_temp(&unreachable).unwrap_err().kind(),
            ErrorKind::NotFound
        );
    }

    #[test]
    fn a_bounded_read_accepts_the_limit_and_rejects_one_byte_more() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diez.bin");
        fs::write(&path, [7u8; 10]).unwrap();
        assert_eq!(read_bounded(&path, 11).unwrap().len(), 10);
        assert_eq!(read_bounded(&path, 10).unwrap().len(), 10);
        assert!(matches!(read_bounded(&path, 9), Err(FileError::TooLarge)));
    }

    #[test]
    fn access_denied_and_lock_violation_on_rename_mean_the_file_is_locked() {
        for code in [5, 33] {
            let error = rename_error(io::Error::from_raw_os_error(code));
            assert!(matches!(error, FileError::FileLocked), "codigo {code}");
        }
        let other = rename_error(io::Error::from_raw_os_error(2));
        assert!(matches!(other, FileError::Io(_)));
    }
}

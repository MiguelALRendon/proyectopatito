use std::fs::File;
use std::io::{self, Read, Write};
use std::path::Path;

use sevenz_rust2::{ArchiveEntry, ArchiveReader, Error as SevenZError, Password};

use super::limits::{MAX_7Z_BLOCK_BYTES, MAX_7Z_HEADER_BYTES, MAX_ARCHIVE_ENTRIES};
use super::{
    ArchiveError, Cancel, Decision, Entry, EntryHandler, EntryKind, classify_library_error,
    ensure_running, limit,
};

const SIGNATURE_HEADER_BYTES: u64 = 32;
const NEXT_HEADER_OFFSET_AT: usize = 12;
const NEXT_HEADER_SIZE_AT: usize = 20;
const U64_BYTES: usize = 8;
const WINDOWS_REPARSE_POINT: u32 = 0x400;
const UNIX_EXTENSION: u32 = 0x8000;
const UNIX_MODE_SHIFT: u32 = 16;
const UNIX_TYPE_MASK: u32 = 0o170_000;
const UNIX_SYMLINK: u32 = 0o120_000;
const UNIX_CHAR_DEVICE: u32 = 0o020_000;
const UNIX_BLOCK_DEVICE: u32 = 0o060_000;
const UNIX_FIFO: u32 = 0o010_000;

fn read_u64(header: &[u8], at: usize) -> u64 {
    let mut bytes = [0u8; U64_BYTES];
    bytes.copy_from_slice(&header[at..at + U64_BYTES]);
    u64::from_le_bytes(bytes)
}

fn check_start_header(path: &Path) -> Result<(), ArchiveError> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    let mut header = [0u8; SIGNATURE_HEADER_BYTES as usize];
    file.read_exact(&mut header)
        .map_err(|_| ArchiveError::Corrupt("la cabecera 7z está incompleta".to_owned()))?;
    let size = read_u64(&header, NEXT_HEADER_SIZE_AT);
    let end = read_u64(&header, NEXT_HEADER_OFFSET_AT)
        .checked_add(size)
        .and_then(|end| end.checked_add(SIGNATURE_HEADER_BYTES));
    if size > MAX_7Z_HEADER_BYTES || end.is_none_or(|end| end > length) {
        return Err(ArchiveError::Corrupt(
            "la cabecera 7z declara una posición o un tamaño imposibles".to_owned(),
        ));
    }
    Ok(())
}

fn map_error(error: SevenZError) -> ArchiveError {
    match error {
        SevenZError::Io(inner, _) | SevenZError::FileOpen(inner, _) => inner.into(),
        other => classify_library_error(other.to_string()),
    }
}

fn kind_of(file: &ArchiveEntry) -> EntryKind {
    let attributes = file.windows_attributes();
    let has_unix_mode = attributes & UNIX_EXTENSION != 0;
    let unix_type = (attributes >> UNIX_MODE_SHIFT) & UNIX_TYPE_MASK;
    if attributes & WINDOWS_REPARSE_POINT != 0 || (has_unix_mode && unix_type == UNIX_SYMLINK) {
        return EntryKind::Link;
    }
    let is_device = matches!(unix_type, UNIX_CHAR_DEVICE | UNIX_BLOCK_DEVICE | UNIX_FIFO);
    if has_unix_mode && is_device {
        return EntryKind::Device;
    }
    if file.is_directory() {
        EntryKind::Directory
    } else {
        EntryKind::File
    }
}

fn describe(file: &ArchiveEntry) -> Entry {
    Entry {
        name: file.name().to_owned(),
        kind: kind_of(file),
        size: file.size(),
        packed: None,
        is_encrypted: false,
    }
}

fn feed(
    file: &ArchiveEntry,
    data: &mut dyn Read,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<bool, ArchiveError> {
    ensure_running(cancel)?;
    if file.is_anti_item() {
        return Ok(true);
    }
    let entry = describe(file);
    match handler.start(&entry)? {
        Decision::Stop => return Ok(false),
        Decision::Skip => {
            io::copy(data, &mut io::sink())?;
        }
        Decision::Write(mut sink) => {
            io::copy(data, &mut sink)?;
            sink.flush()?;
        }
    }
    handler.finish(&entry)?;
    Ok(true)
}

fn list_metadata(
    reader: &ArchiveReader<File>,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<(), ArchiveError> {
    for file in &reader.archive().files {
        ensure_running(cancel)?;
        if file.is_anti_item() {
            continue;
        }
        let entry = describe(file);
        if matches!(handler.start(&entry)?, Decision::Stop) {
            return Ok(());
        }
        handler.finish(&entry)?;
    }
    Ok(())
}

fn check_limits(reader: &ArchiveReader<File>) -> Result<(), ArchiveError> {
    let archive = reader.archive();
    if archive.files.len() > MAX_ARCHIVE_ENTRIES {
        return Err(limit("el archivo tiene demasiadas entradas"));
    }
    let oversized = archive
        .blocks
        .iter()
        .any(|block| block.get_unpack_size() > MAX_7Z_BLOCK_BYTES);
    if oversized {
        return Err(limit("un bloque comprimido declara un tamaño excesivo"));
    }
    Ok(())
}

pub(super) fn visit(
    path: &Path,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<(), ArchiveError> {
    check_start_header(path)?;
    let mut reader = ArchiveReader::open(path, Password::empty()).map_err(map_error)?;
    check_limits(&reader)?;
    if !handler.wants_data() {
        return list_metadata(&reader, cancel, handler);
    }
    let mut failure: Option<ArchiveError> = None;
    let outcome = reader.for_each_entries(|file, data| match feed(file, data, cancel, handler) {
        Ok(keep_going) => Ok(keep_going),
        Err(error) => {
            failure = Some(error);
            Ok(false)
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    outcome.map_err(map_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive_declaring(
        next_offset: u64,
        next_size: u64,
        length: u64,
    ) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.7z");
        let mut header = [0u8; SIGNATURE_HEADER_BYTES as usize];
        let offset_at = NEXT_HEADER_OFFSET_AT..NEXT_HEADER_OFFSET_AT + U64_BYTES;
        header[offset_at].copy_from_slice(&next_offset.to_le_bytes());
        let size_at = NEXT_HEADER_SIZE_AT..NEXT_HEADER_SIZE_AT + U64_BYTES;
        header[size_at].copy_from_slice(&next_size.to_le_bytes());
        let mut file = File::create(&path).unwrap();
        file.write_all(&header).unwrap();
        file.set_len(length).unwrap();
        (dir, path)
    }

    fn start_header_is_valid(next_offset: u64, next_size: u64, length: u64) -> bool {
        let (_dir, path) = archive_declaring(next_offset, next_size, length);
        check_start_header(&path).is_ok()
    }

    #[test]
    fn the_next_header_must_end_inside_the_file() {
        assert!(start_header_is_valid(4, 10, 46));
        assert!(start_header_is_valid(4, 10, 47));
        assert!(!start_header_is_valid(4, 10, 45));
    }

    #[test]
    fn a_small_next_header_beyond_the_file_is_refused() {
        assert!(!start_header_is_valid(1000, 1, 64));
    }

    #[test]
    fn the_next_header_size_is_capped_even_when_it_fits_the_file() {
        let fits = |size| start_header_is_valid(0, size, SIGNATURE_HEADER_BYTES + size);
        assert!(fits(MAX_7Z_HEADER_BYTES));
        assert!(!fits(MAX_7Z_HEADER_BYTES + 1));
    }

    #[test]
    fn an_overflowing_next_header_position_is_refused() {
        assert!(!start_header_is_valid(u64::MAX, 1, 64));
    }
}

use std::fs::File;
use std::io::{self, BufReader};
use std::path::Path;

use zip::ZipArchive;
use zip::result::ZipError;

use super::limits::MAX_ARCHIVE_ENTRIES;
use super::{
    ArchiveError, Cancel, Decision, Entry, EntryHandler, EntryKind, classify_library_error,
    ensure_running, limit,
};

const UNIX_TYPE_MASK: u32 = 0o170_000;
const UNIX_CHAR_DEVICE: u32 = 0o020_000;
const UNIX_BLOCK_DEVICE: u32 = 0o060_000;
const UNIX_FIFO: u32 = 0o010_000;

fn zip_error(error: ZipError) -> ArchiveError {
    match error {
        ZipError::Io(inner) => inner.into(),
        other => classify_library_error(other.to_string()),
    }
}

fn is_device(mode: Option<u32>) -> bool {
    let Some(mode) = mode else { return false };
    matches!(
        mode & UNIX_TYPE_MASK,
        UNIX_CHAR_DEVICE | UNIX_BLOCK_DEVICE | UNIX_FIFO
    )
}

fn kind_of(member: &zip::read::ZipFile<'_, BufReader<File>>) -> EntryKind {
    if member.is_symlink() {
        return EntryKind::Link;
    }
    if is_device(member.unix_mode()) {
        return EntryKind::Device;
    }
    if member.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::File
    }
}

fn describe(
    archive: &mut ZipArchive<BufReader<File>>,
    index: usize,
) -> Result<Entry, ArchiveError> {
    let member = archive.by_index_raw(index).map_err(zip_error)?;
    Ok(Entry {
        name: String::from_utf8_lossy(member.name_raw()).into_owned(),
        kind: kind_of(&member),
        size: member.size(),
        packed: Some(member.compressed_size()),
        is_encrypted: member.encrypted(),
    })
}

fn copy_member(
    archive: &mut ZipArchive<BufReader<File>>,
    index: usize,
    sink: &mut dyn io::Write,
) -> Result<(), ArchiveError> {
    let mut member = archive.by_index(index).map_err(zip_error)?;
    io::copy(&mut member, sink)?;
    sink.flush()?;
    Ok(())
}

pub(super) fn visit(
    path: &Path,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<(), ArchiveError> {
    let mut archive = ZipArchive::new(BufReader::new(File::open(path)?)).map_err(zip_error)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(limit("el archivo tiene demasiadas entradas"));
    }
    for index in 0..archive.len() {
        ensure_running(cancel)?;
        let entry = describe(&mut archive, index)?;
        match handler.start(&entry)? {
            Decision::Stop => return Ok(()),
            Decision::Skip => {}
            Decision::Write(mut sink) => {
                copy_member(&mut archive, index, &mut sink)?;
                drop(sink);
            }
        }
        handler.finish(&entry)?;
    }
    Ok(())
}

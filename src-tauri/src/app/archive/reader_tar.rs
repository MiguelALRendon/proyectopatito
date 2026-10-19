use std::fs::File;
use std::io::{self, BufReader, Read};
use std::path::Path;

use tar::{Archive, EntryType};

use super::limits::{MAX_ARCHIVE_ENTRIES, MAX_LIST_READ_BYTES, XZ_MEMORY_LIMIT_BYTES};
use super::{
    ArchiveError, ArchiveFormat, Cancel, Decision, Entry, EntryHandler, EntryKind, Interrupt,
    classify_library_error, ensure_running, interrupt, limit,
};

struct Budget<R> {
    inner: R,
    remaining: u64,
}

impl<R: Read> Read for Budget<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            return Err(interrupt(Interrupt::ReadLimit));
        }
        let wanted = buf
            .len()
            .min(usize::try_from(self.remaining).unwrap_or(usize::MAX));
        let read = self.inner.read(&mut buf[..wanted])?;
        self.remaining -= read as u64;
        Ok(read)
    }
}

fn decoder(path: &Path, format: ArchiveFormat) -> Result<Box<dyn Read>, ArchiveError> {
    let input = BufReader::new(File::open(path)?);
    Ok(match format {
        ArchiveFormat::TarGz => Box::new(flate2::read::GzDecoder::new(input)),
        ArchiveFormat::TarBz2 => Box::new(bzip2::read::BzDecoder::new(input)),
        ArchiveFormat::TarXz => {
            let stream = liblzma::stream::Stream::new_stream_decoder(XZ_MEMORY_LIMIT_BYTES, 0)
                .map_err(|error| classify_library_error(error.to_string()))?;
            Box::new(liblzma::read::XzDecoder::new_stream(input, stream))
        }
        _ => Box::new(input),
    })
}

fn kind_of(entry_type: EntryType) -> EntryKind {
    match entry_type {
        EntryType::Directory => EntryKind::Directory,
        EntryType::Symlink | EntryType::Link => EntryKind::Link,
        EntryType::Char | EntryType::Block | EntryType::Fifo => EntryKind::Device,
        _ => EntryKind::File,
    }
}

fn is_metadata_only(entry_type: EntryType) -> bool {
    matches!(
        entry_type,
        EntryType::XGlobalHeader
            | EntryType::XHeader
            | EntryType::GNULongName
            | EntryType::GNULongLink
    )
}

pub(super) fn visit(
    path: &Path,
    format: ArchiveFormat,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<(), ArchiveError> {
    let budget = Budget {
        inner: decoder(path, format)?,
        remaining: MAX_LIST_READ_BYTES,
    };
    let mut archive = Archive::new(budget);
    let mut count = 0usize;
    for member in archive.entries()? {
        ensure_running(cancel)?;
        let mut member = member?;
        let entry_type = member.header().entry_type();
        if is_metadata_only(entry_type) {
            continue;
        }
        count += 1;
        if count > MAX_ARCHIVE_ENTRIES {
            return Err(limit("el archivo tiene demasiadas entradas"));
        }
        let entry = Entry {
            name: String::from_utf8_lossy(&member.path_bytes()).into_owned(),
            kind: kind_of(entry_type),
            size: member.size(),
            packed: None,
            is_encrypted: false,
        };
        match handler.start(&entry)? {
            Decision::Stop => return Ok(()),
            Decision::Skip => {}
            Decision::Write(mut sink) => {
                io::copy(&mut member, &mut sink)?;
                io::Write::flush(&mut sink)?;
                drop(sink);
            }
        }
        handler.finish(&entry)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::archive::interrupt_of;

    #[test]
    fn the_budget_serves_exactly_its_bytes_and_then_stops_the_read() {
        let mut budget = Budget {
            inner: io::Cursor::new(vec![7u8; 100]),
            remaining: 10,
        };
        let mut buffer = [0u8; 64];
        assert_eq!(budget.read(&mut buffer).unwrap(), 10);
        assert_eq!(budget.remaining, 0);
        let error = budget.read(&mut buffer).unwrap_err();
        assert!(matches!(interrupt_of(&error), Some(Interrupt::ReadLimit)));
    }

    #[test]
    fn the_budget_counts_down_across_reads() {
        let mut budget = Budget {
            inner: io::Cursor::new(vec![7u8; 100]),
            remaining: 10,
        };
        let mut buffer = [0u8; 4];
        assert_eq!(budget.read(&mut buffer).unwrap(), 4);
        assert_eq!(budget.remaining, 6);
        assert_eq!(budget.read(&mut buffer).unwrap(), 4);
        assert_eq!(budget.remaining, 2);
    }

    #[test]
    fn entry_types_map_to_kinds() {
        assert_eq!(kind_of(EntryType::Directory), EntryKind::Directory);
        assert_eq!(kind_of(EntryType::Symlink), EntryKind::Link);
        assert_eq!(kind_of(EntryType::Link), EntryKind::Link);
        assert_eq!(kind_of(EntryType::Fifo), EntryKind::Device);
        assert_eq!(kind_of(EntryType::Regular), EntryKind::File);
        assert!(is_metadata_only(EntryType::XGlobalHeader));
        assert!(!is_metadata_only(EntryType::Regular));
    }
}

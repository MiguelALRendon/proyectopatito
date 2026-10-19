use std::io;
use std::path::Path;

use rars::{
    Archive, ArchiveMember, ArchiveReadOptions, ArchiveReader, ErrorKind, ExtractionDecision,
};

use super::limits::{
    MAX_ARCHIVE_ENTRIES, MAX_EXTRACT_BYTES, MAX_RAR_HEADER_BYTES, MAX_RAR_MEMBER_BYTES,
};
use super::{
    ArchiveError, Cancel, Decision, Entry, EntryHandler, EntryKind, classify_library_error,
    ensure_running, interrupt_of, limit,
};

fn interrupted(error: &rars::Error) -> Option<ArchiveError> {
    let mut cause = std::error::Error::source(error);
    while let Some(inner) = cause {
        let interrupt = inner.downcast_ref::<io::Error>().and_then(interrupt_of);
        if let Some(kind) = interrupt {
            return Some(kind.into());
        }
        cause = inner.source();
    }
    None
}

fn map_error(error: &rars::Error) -> ArchiveError {
    if let Some(interruption) = interrupted(error) {
        return interruption;
    }
    let message = error.to_string();
    match error.kind() {
        ErrorKind::PasswordRequired | ErrorKind::BadPassword => ArchiveError::Encrypted,
        ErrorKind::ResourceLimit => ArchiveError::Limit(message),
        ErrorKind::UnsupportedFormat | ErrorKind::UnsupportedFeature => {
            classify_library_error(message)
        }
        ErrorKind::Cancelled => ArchiveError::Cancelled,
        ErrorKind::Io => ArchiveError::Io(io::Error::other(message)),
        _ => ArchiveError::Corrupt(message),
    }
}

fn kind_of(member: &ArchiveMember) -> EntryKind {
    if member.meta.is_redirection {
        EntryKind::Link
    } else if member.meta.is_directory {
        EntryKind::Directory
    } else {
        EntryKind::File
    }
}

fn describe(member: &ArchiveMember) -> Entry {
    Entry {
        name: member.meta.name_lossy(),
        kind: kind_of(member),
        size: member.meta.unpacked_size,
        packed: Some(member.meta.packed_size),
        is_encrypted: member.meta.is_encrypted,
    }
}

fn options() -> ArchiveReadOptions<'static> {
    ArchiveReadOptions::new()
        .with_max_header_count(MAX_ARCHIVE_ENTRIES as u64)
        .with_max_header_bytes(MAX_RAR_HEADER_BYTES)
        .with_max_member_output_bytes(MAX_RAR_MEMBER_BYTES)
        .with_max_total_output_bytes(MAX_EXTRACT_BYTES)
}

fn list_metadata(
    archive: &Archive,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<(), ArchiveError> {
    for (position, member) in archive.members().enumerate() {
        ensure_running(cancel)?;
        if position >= MAX_ARCHIVE_ENTRIES {
            return Err(limit("el archivo tiene demasiadas entradas"));
        }
        let entry = describe(&member);
        if matches!(handler.start(&entry)?, Decision::Stop) {
            return Ok(());
        }
        handler.finish(&entry)?;
    }
    Ok(())
}

struct Walker<'a> {
    cancel: &'a Cancel,
    handler: &'a mut dyn EntryHandler,
    pending: Option<Entry>,
    failure: Option<ArchiveError>,
}

impl Walker<'_> {
    fn close_pending(&mut self) -> Result<(), ArchiveError> {
        match self.pending.take() {
            Some(entry) => self.handler.finish(&entry),
            None => Ok(()),
        }
    }

    fn decide(&mut self, member: &ArchiveMember) -> Result<ExtractionDecision, ArchiveError> {
        self.close_pending()?;
        ensure_running(self.cancel)?;
        let entry = describe(member);
        let decision = match self.handler.start(&entry)? {
            Decision::Stop => return Ok(ExtractionDecision::Stop),
            Decision::Skip => ExtractionDecision::Extract(Box::new(io::sink())),
            Decision::Write(sink) => ExtractionDecision::Extract(sink),
        };
        self.pending = Some(entry);
        Ok(decision)
    }

    fn on_member(&mut self, member: &ArchiveMember) -> rars::Result<ExtractionDecision> {
        match self.decide(member) {
            Ok(decision) => Ok(decision),
            Err(error) => {
                self.failure = Some(error);
                Ok(ExtractionDecision::Stop)
            }
        }
    }
}

pub(super) fn visit(
    path: &Path,
    cancel: &Cancel,
    handler: &mut dyn EntryHandler,
) -> Result<(), ArchiveError> {
    let archive =
        ArchiveReader::read_path_with_options(path, options()).map_err(|e| map_error(&e))?;
    if !handler.wants_data() {
        return list_metadata(&archive, cancel, handler);
    }
    let mut walker = Walker {
        cancel,
        handler,
        pending: None,
        failure: None,
    };
    let outcome = archive.extract_with_control(options(), |member| walker.on_member(member));
    if let Some(error) = walker.failure.take() {
        return Err(error);
    }
    outcome.map_err(|e| map_error(&e))?;
    walker.close_pending()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::archive::{Interrupt, interrupt};

    #[test]
    fn a_sink_interruption_survives_the_library_error_wrapping() {
        let wrapped = rars::Error::from(interrupt(Interrupt::Cancelled));
        assert!(matches!(map_error(&wrapped), ArchiveError::Cancelled));
        let capped = rars::Error::from(interrupt(Interrupt::EntryLimit));
        assert!(matches!(map_error(&capped), ArchiveError::Limit(_)));
    }

    #[test]
    fn password_errors_mean_encrypted() {
        assert!(matches!(
            map_error(&rars::Error::NeedPassword),
            ArchiveError::Encrypted
        ));
        assert!(matches!(
            map_error(&rars::Error::WrongPasswordOrCorruptData),
            ArchiveError::Encrypted
        ));
    }

    #[test]
    fn a_plain_io_error_is_not_mistaken_for_an_interruption() {
        let plain = rars::Error::from(io::Error::from(io::ErrorKind::PermissionDenied));
        assert!(matches!(map_error(&plain), ArchiveError::Io(_)));
    }

    #[test]
    fn the_read_options_carry_the_project_limits() {
        let debug = format!("{:?}", options());
        assert!(debug.contains(&MAX_RAR_MEMBER_BYTES.to_string()), "{debug}");
        assert!(debug.contains(&MAX_RAR_HEADER_BYTES.to_string()), "{debug}");
    }
}

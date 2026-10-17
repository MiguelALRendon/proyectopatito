use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use super::{FileError, FileFacts, FileService, probe_facts};
use crate::app::range::{Outcome, Range, Slice, plan};
use crate::app::workspace::ScopedPath;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Served {
    pub mime: &'static str,
    pub total: u64,
    pub outcome: Outcome,
    pub body: Vec<u8>,
}

impl FileService {
    pub fn open_for_serve(
        &self,
        file: &ScopedPath,
        range: Option<Range>,
    ) -> Result<Served, FileError> {
        let metadata = self.regular_file(file)?;
        let facts = FileFacts {
            len: metadata.len(),
            attributes: metadata.file_attributes(),
        };
        let outcome = plan(range, facts.len);
        Ok(Served {
            mime: probe_facts(file.as_path(), facts, false)?.mime,
            total: facts.len,
            body: read_outcome(file.as_path(), outcome)?,
            outcome,
        })
    }
}

fn read_outcome(path: &Path, outcome: Outcome) -> Result<Vec<u8>, FileError> {
    match outcome {
        Outcome::Full(slice) | Outcome::Partial(slice) => read_slice(path, slice),
        Outcome::TooLarge | Outcome::Unsatisfiable => Ok(Vec::new()),
    }
}

fn read_slice(path: &Path, slice: Slice) -> Result<Vec<u8>, FileError> {
    let mut source = File::open(path)?;
    source.seek(SeekFrom::Start(slice.start))?;
    let mut body = Vec::new();
    source.take(slice.len).read_to_end(&mut body)?;
    if body.len() as u64 != slice.len {
        return Err(FileError::FileChanged);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_shortened_after_its_size_was_read_is_reported_as_changed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dato.bin");
        std::fs::write(&path, [1u8; 100]).unwrap();
        let outcome = plan(None, 100);
        std::fs::write(&path, [1u8; 10]).unwrap();
        assert!(matches!(
            read_outcome(&path, outcome),
            Err(FileError::FileChanged)
        ));
    }
}

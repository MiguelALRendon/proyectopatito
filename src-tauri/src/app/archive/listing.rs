use std::path::Path;

use serde::Serialize;

use super::limits::{Limits, MAX_EXTRACT_RATIO, MAX_LISTED_ENTRIES, SUSPICIOUS_DEPTH};
use super::safety::skip_reason;
use super::{ArchiveError, ArchiveFormat, Cancel, Decision, Entry, EntryHandler, EntryKind, visit};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Suspicion {
    DeclaredSize,
    Ratio,
    Depth,
}

impl Suspicion {
    pub fn code(self) -> &'static str {
        match self {
            Self::DeclaredSize => "declared_size",
            Self::Ratio => "ratio",
            Self::Depth => "depth",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ListedEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub packed: Option<u64>,
    pub encrypted: bool,
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArchiveListing {
    pub format: ArchiveFormat,
    pub entries: Vec<ListedEntry>,
    pub entry_count: usize,
    pub truncated: bool,
    pub declared_bytes: u64,
    pub largest_entry_bytes: u64,
    pub encrypted: bool,
    pub suspicions: Vec<Suspicion>,
}

#[derive(Default)]
struct Lister {
    entries: Vec<ListedEntry>,
    entry_count: usize,
    declared_bytes: u64,
    largest_entry_bytes: u64,
    encrypted: bool,
    deepest: usize,
}

impl EntryHandler for Lister {
    fn wants_data(&self) -> bool {
        false
    }

    fn start(&mut self, entry: &Entry) -> Result<Decision, ArchiveError> {
        self.entry_count += 1;
        self.encrypted |= entry.is_encrypted;
        if entry.kind == EntryKind::File {
            self.declared_bytes = self.declared_bytes.saturating_add(entry.size);
            self.largest_entry_bytes = self.largest_entry_bytes.max(entry.size);
        }
        self.deepest = self.deepest.max(depth_of(&entry.name));
        if self.entries.len() < MAX_LISTED_ENTRIES {
            self.entries.push(listed(entry));
        }
        Ok(Decision::Skip)
    }

    fn finish(&mut self, _entry: &Entry) -> Result<(), ArchiveError> {
        Ok(())
    }
}

fn depth_of(name: &str) -> usize {
    name.split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .count()
}

fn listed(entry: &Entry) -> ListedEntry {
    ListedEntry {
        name: entry.name.clone(),
        kind: entry.kind,
        size: entry.size,
        packed: entry.packed,
        encrypted: entry.is_encrypted,
        skip_reason: skip_reason(entry),
    }
}

impl Lister {
    fn suspicions(&self, archive_bytes: u64, limits: &Limits) -> Vec<Suspicion> {
        let mut found = Vec::new();
        if exceeds(self.declared_bytes, self.largest_entry_bytes, limits) {
            found.push(Suspicion::DeclaredSize);
        }
        let ratio = self.declared_bytes / archive_bytes.max(1);
        if self.declared_bytes >= limits.ratio_min_bytes && ratio > MAX_EXTRACT_RATIO {
            found.push(Suspicion::Ratio);
        }
        if self.deepest > SUSPICIOUS_DEPTH {
            found.push(Suspicion::Depth);
        }
        found
    }

    fn into_listing(
        self,
        format: ArchiveFormat,
        archive_bytes: u64,
        limits: &Limits,
    ) -> ArchiveListing {
        let suspicions = self.suspicions(archive_bytes, limits);
        ArchiveListing {
            format,
            truncated: self.entry_count > self.entries.len(),
            entries: self.entries,
            entry_count: self.entry_count,
            declared_bytes: self.declared_bytes,
            largest_entry_bytes: self.largest_entry_bytes,
            encrypted: self.encrypted,
            suspicions,
        }
    }
}

pub fn exceeds(declared_bytes: u64, largest_entry_bytes: u64, limits: &Limits) -> bool {
    declared_bytes > limits.extract_bytes || largest_entry_bytes > limits.entry_bytes
}

pub fn list(
    path: &Path,
    format: ArchiveFormat,
    cancel: &Cancel,
    limits: &Limits,
) -> Result<ArchiveListing, ArchiveError> {
    let archive_bytes = std::fs::metadata(path)?.len();
    let mut lister = Lister::default();
    visit(path, format, cancel, &mut lister)?;
    Ok(lister.into_listing(format, archive_bytes, limits))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: Limits = Limits {
        entry_bytes: 1000,
        extract_bytes: 5000,
        ratio_min_bytes: 100,
    };

    fn lister(declared: u64, largest: u64, deepest: usize) -> Lister {
        Lister {
            declared_bytes: declared,
            largest_entry_bytes: largest,
            deepest,
            ..Lister::default()
        }
    }

    #[test]
    fn each_suspicion_has_its_own_code() {
        assert_eq!(Suspicion::DeclaredSize.code(), "declared_size");
        assert_eq!(Suspicion::Ratio.code(), "ratio");
        assert_eq!(Suspicion::Depth.code(), "depth");
    }

    #[test]
    fn the_ratio_is_suspicious_only_above_the_limit() {
        assert!(lister(2000, 10, 1).suspicions(10, &LIMITS).is_empty());
        assert_eq!(
            lister(2010, 10, 1).suspicions(10, &LIMITS),
            [Suspicion::Ratio]
        );
    }

    #[test]
    fn the_ratio_needs_the_minimum_declared_size() {
        let limits = Limits {
            ratio_min_bytes: 1000,
            ..LIMITS
        };
        assert!(lister(999, 10, 1).suspicions(1, &limits).is_empty());
        assert_eq!(
            lister(1000, 10, 1).suspicions(1, &limits),
            [Suspicion::Ratio]
        );
    }

    #[test]
    fn depth_is_suspicious_only_above_the_limit() {
        assert!(
            lister(1, 1, SUSPICIOUS_DEPTH)
                .suspicions(1, &LIMITS)
                .is_empty()
        );
        assert_eq!(
            lister(1, 1, SUSPICIOUS_DEPTH + 1).suspicions(1, &LIMITS),
            [Suspicion::Depth]
        );
    }

    #[test]
    fn either_hard_limit_alone_trips_the_declared_size() {
        assert!(!exceeds(5000, 1000, &LIMITS));
        assert!(exceeds(5001, 1, &LIMITS));
        assert!(exceeds(1, 1001, &LIMITS));
    }
}

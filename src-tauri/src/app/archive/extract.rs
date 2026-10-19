use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use serde::Serialize;

use super::limits::{
    Limits, MAX_PATH_LEN, MAX_SKIPPED_REPORTED, MAX_SUFFIX_ATTEMPTS, PROGRESS_INTERVAL_MS,
};
use super::safety::{sanitize, skip_reason};
use super::{
    ArchiveError, ArchiveFormat, Cancel, Decision, Entry, EntryHandler, EntryKind, Interrupt,
    interrupt, visit,
};
use crate::app::workspace::{ScopedPath, Workspace, WorkspaceError};

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Progress {
    pub files: u64,
    pub bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Skipped {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ExtractReport {
    pub destination: String,
    pub files: u64,
    pub directories: u64,
    pub bytes: u64,
    pub skipped: Vec<Skipped>,
    pub skipped_more: u64,
}

pub type ProgressSink = Arc<dyn Fn(Progress) + Send + Sync>;

struct Pulse {
    sink: ProgressSink,
    files: u64,
    total_bytes: u64,
    last_emit: Instant,
}

impl Pulse {
    fn beat(&mut self, bytes: u64) {
        if self.last_emit.elapsed().as_millis() < PROGRESS_INTERVAL_MS {
            return;
        }
        self.last_emit = Instant::now();
        (self.sink)(Progress {
            files: self.files,
            bytes,
            total_bytes: self.total_bytes,
        });
    }
}

struct Limited {
    file: File,
    written: u64,
    total: Arc<AtomicU64>,
    cancel: Cancel,
    limits: Limits,
    pulse: Pulse,
}

impl Write for Limited {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(interrupt(Interrupt::Cancelled));
        }
        let len = buf.len() as u64;
        self.written += len;
        if self.written > self.limits.entry_bytes {
            return Err(interrupt(Interrupt::EntryLimit));
        }
        let so_far = self.total.fetch_add(len, Ordering::Relaxed) + len;
        if so_far > self.limits.extract_bytes {
            return Err(interrupt(Interrupt::TotalLimit));
        }
        self.file.write_all(buf)?;
        self.pulse.beat(so_far);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

struct Extractor {
    workspace: Workspace,
    destination: PathBuf,
    cancel: Cancel,
    limits: Limits,
    total: Arc<AtomicU64>,
    total_bytes: u64,
    report: ExtractReport,
    is_writing: bool,
    last_emit: Instant,
    on_progress: ProgressSink,
}

impl Extractor {
    fn skip(&mut self, entry: &Entry, reason: String) -> Decision {
        if self.report.skipped.len() < MAX_SKIPPED_REPORTED {
            let name = entry.name.clone();
            self.report.skipped.push(Skipped { name, reason });
        } else {
            self.report.skipped_more += 1;
        }
        Decision::Skip
    }

    fn scoped(&self, parts: &[String], allow_existing: bool) -> Result<ScopedPath, WorkspaceError> {
        let relative = parts
            .iter()
            .fold(self.destination.clone(), |acc, part| acc.join(part));
        self.workspace.resolve(&relative, allow_existing)
    }

    fn unique_file(&self, parts: &[String]) -> Result<ScopedPath, ArchiveError> {
        for attempt in 1..=MAX_SUFFIX_ATTEMPTS {
            match self.scoped(&suffixed(parts, attempt), false) {
                Err(WorkspaceError::DestinationExists) => {}
                other => return Ok(other?),
            }
        }
        Err(ArchiveError::Limit(
            "demasiados nombres repetidos".to_owned(),
        ))
    }

    fn make_directory(
        &mut self,
        entry: &Entry,
        parts: &[String],
    ) -> Result<Decision, ArchiveError> {
        let target = match self.scoped(parts, true) {
            Ok(target) => target,
            Err(error) if is_name_conflict(&error) => return Ok(self.occupied(entry)),
            Err(error) => return Err(error.into()),
        };
        match fs::create_dir_all(target.as_path()) {
            Err(error) if is_name_conflict_io(&error) => return Ok(self.occupied(entry)),
            other => other?,
        }
        self.workspace.revalidate(&target)?;
        self.report.directories += 1;
        Ok(Decision::Skip)
    }

    fn occupied(&mut self, entry: &Entry) -> Decision {
        self.skip(entry, "el nombre ya lo ocupa un archivo".to_owned())
    }

    fn open_file(&mut self, entry: &Entry, parts: &[String]) -> Result<Decision, ArchiveError> {
        let target = match self.unique_file(parts) {
            Err(ArchiveError::Workspace(error)) if is_name_conflict(&error) => {
                return Ok(self.occupied(entry));
            }
            other => other?,
        };
        if target
            .as_path()
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .count()
            > MAX_PATH_LEN
        {
            return Ok(self.skip(entry, "la ruta resultante es demasiado larga".to_owned()));
        }
        let file = self.create_file(&target)?;
        self.is_writing = true;
        let (total, cancel) = (self.total.clone(), self.cancel.clone());
        let limits = self.limits;
        let pulse = Pulse {
            sink: self.on_progress.clone(),
            files: self.report.files,
            total_bytes: self.total_bytes,
            last_emit: self.last_emit,
        };
        Ok(Decision::Write(Box::new(Limited {
            file,
            written: 0,
            total,
            cancel,
            limits,
            pulse,
        })))
    }

    fn create_file(&self, target: &ScopedPath) -> Result<File, ArchiveError> {
        if let Some(parent) = target.as_path().parent() {
            fs::create_dir_all(parent)?;
        }
        self.workspace.revalidate(target)?;
        let mut options = OpenOptions::new();
        Ok(options
            .write(true)
            .create_new(true)
            .open(target.as_path())?)
    }

    fn emit_progress(&mut self, force: bool) {
        let due = self.last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS;
        if !force && !due {
            return;
        }
        self.last_emit = Instant::now();
        (self.on_progress)(Progress {
            files: self.report.files,
            bytes: self.total.load(Ordering::Relaxed),
            total_bytes: self.total_bytes,
        });
    }
}

impl EntryHandler for Extractor {
    fn wants_data(&self) -> bool {
        true
    }

    fn start(&mut self, entry: &Entry) -> Result<Decision, ArchiveError> {
        if let Some(reason) = skip_reason(entry) {
            return Ok(self.skip(entry, reason));
        }
        let parts = sanitize(&entry.name)
            .map_err(|why| ArchiveError::UnsafeEntry(why.reason().to_owned()))?;
        match entry.kind {
            EntryKind::Directory => self.make_directory(entry, &parts),
            _ => self.open_file(entry, &parts),
        }
    }

    fn finish(&mut self, _entry: &Entry) -> Result<(), ArchiveError> {
        if self.is_writing {
            self.is_writing = false;
            self.report.files += 1;
            self.emit_progress(false);
        }
        Ok(())
    }
}

fn suffixed(parts: &[String], attempt: u32) -> Vec<String> {
    let mut renamed = parts.to_vec();
    let Some(last) = renamed.last_mut() else {
        return renamed;
    };
    if attempt > 1 {
        *last = with_suffix(last, attempt);
    }
    renamed
}

fn with_suffix(name: &str, attempt: u32) -> String {
    match name.rfind('.').filter(|dot| *dot > 0) {
        Some(dot) => format!("{}-{attempt}{}", &name[..dot], &name[dot..]),
        None => format!("{name}-{attempt}"),
    }
}

fn is_name_conflict(error: &WorkspaceError) -> bool {
    matches!(error, WorkspaceError::Io(inner) if is_name_conflict_io(inner))
}

fn is_name_conflict_io(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotADirectory | io::ErrorKind::AlreadyExists
    )
}

pub struct Job<'a> {
    pub archive: &'a Path,
    pub format: ArchiveFormat,
    pub destination: PathBuf,
    pub total_bytes: u64,
    pub limits: Limits,
}

pub fn run(
    workspace: &Workspace,
    job: &Job<'_>,
    cancel: &Cancel,
    on_progress: ProgressSink,
) -> Result<ExtractReport, ArchiveError> {
    let mut extractor = Extractor {
        workspace: workspace.clone(),
        destination: job.destination.clone(),
        cancel: cancel.clone(),
        limits: job.limits,
        total: Arc::default(),
        total_bytes: job.total_bytes,
        report: ExtractReport::default(),
        is_writing: false,
        last_emit: Instant::now(),
        on_progress,
    };
    visit(job.archive, job.format, cancel, &mut extractor)?;
    extractor.report.bytes = extractor.total.load(Ordering::Relaxed);
    extractor.emit_progress(true);
    Ok(extractor.report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::archive::interrupt_of;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    fn writer(limits: Limits, total: &Arc<AtomicU64>) -> (Limited, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let file = File::create(dir.path().join("f")).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let writer = Limited {
            file,
            written: 0,
            total: total.clone(),
            cancel,
            limits,
            pulse: Pulse {
                sink: Arc::new(|_| {}),
                files: 0,
                total_bytes: 0,
                last_emit: Instant::now(),
            },
        };
        (writer, dir)
    }

    fn pulse_into(seen: &Arc<std::sync::Mutex<Vec<Progress>>>, idle: Duration) -> Pulse {
        let sink = seen.clone();
        Pulse {
            sink: Arc::new(move |progress| sink.lock().unwrap().push(progress)),
            files: 3,
            total_bytes: 99,
            last_emit: Instant::now() - idle,
        }
    }

    #[test]
    fn a_pulse_reports_after_its_interval_and_then_waits() {
        let seen = Arc::default();
        let mut pulse = pulse_into(&seen, Duration::from_secs(5));
        pulse.beat(7);
        pulse.beat(8);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(
            (seen[0].files, seen[0].bytes, seen[0].total_bytes),
            (3, 7, 99)
        );
    }

    #[test]
    fn a_pulse_stays_quiet_before_its_interval() {
        let seen = Arc::default();
        let mut pulse = pulse_into(&seen, Duration::ZERO);
        pulse.beat(7);
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn writing_inside_one_big_file_reports_progress_before_the_file_ends() {
        let seen = Arc::default();
        let total = Arc::default();
        let (mut sink, _dir) = writer(Limits::default(), &total);
        sink.pulse = pulse_into(&seen, Duration::from_secs(5));
        sink.write_all(&[1u8; 40]).unwrap();
        assert_eq!(seen.lock().unwrap()[0].bytes, 40);
    }

    fn interruption(error: io::Error) -> String {
        format!("{:?}", interrupt_of(&error).expect("una interrupción"))
    }

    const SMALL: Limits = Limits {
        entry_bytes: 10,
        extract_bytes: 15,
        ratio_min_bytes: u64::MAX,
    };

    #[test]
    fn a_writer_accepts_its_exact_entry_limit_and_refuses_one_more() {
        let total = Arc::default();
        let (mut exact, _dir) = writer(SMALL, &total);
        exact.write_all(&[1u8; 10]).unwrap();
        let error = exact.write_all(&[1]).unwrap_err();
        assert_eq!(interruption(error), "EntryLimit");
    }

    #[test]
    fn the_entry_count_accumulates_across_writes() {
        let total = Arc::default();
        let (mut piecemeal, _dir) = writer(SMALL, &total);
        for _ in 0..10 {
            piecemeal.write_all(&[1]).unwrap();
        }
        assert!(piecemeal.write_all(&[1]).is_err());
    }

    #[test]
    fn the_total_is_shared_between_writers_and_counts_real_bytes() {
        let total: Arc<AtomicU64> = Arc::default();
        let (mut first, _a) = writer(SMALL, &total);
        let (mut second, _b) = writer(SMALL, &total);
        first.write_all(&[1u8; 10]).unwrap();
        second.write_all(&[1u8; 5]).unwrap();
        assert_eq!(total.load(Ordering::Relaxed), 15);
        let error = second.write_all(&[1]).unwrap_err();
        assert_eq!(interruption(error), "TotalLimit");
    }

    #[test]
    fn a_cancelled_writer_writes_nothing() {
        let total = Arc::default();
        let (mut cancelled, _dir) = writer(SMALL, &total);
        cancelled.cancel.store(true, Ordering::Relaxed);
        let error = cancelled.write_all(&[1]).unwrap_err();
        assert_eq!(interruption(error), "Cancelled");
        assert_eq!(cancelled.file.metadata().unwrap().len(), 0);
    }

    #[test]
    fn repeated_names_get_a_numeric_suffix_before_the_extension() {
        let parts = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        assert_eq!(suffixed(&parts(&["a", "b.txt"]), 1), parts(&["a", "b.txt"]));
        assert_eq!(
            suffixed(&parts(&["a", "b.txt"]), 2),
            parts(&["a", "b-2.txt"])
        );
        assert_eq!(with_suffix("b.tar.gz", 3), "b.tar-3.gz");
        assert_eq!(with_suffix("noext", 2), "noext-2");
        assert_eq!(with_suffix(".hidden", 2), ".hidden-2");
    }

    #[test]
    fn only_name_clashes_count_as_conflicts() {
        assert!(is_name_conflict_io(&io::Error::from(
            io::ErrorKind::NotADirectory
        )));
        assert!(is_name_conflict_io(&io::Error::from(
            io::ErrorKind::AlreadyExists
        )));
        assert!(!is_name_conflict_io(&io::Error::from(
            io::ErrorKind::PermissionDenied
        )));
        let clash = WorkspaceError::Io(io::Error::from(io::ErrorKind::AlreadyExists));
        assert!(is_name_conflict(&clash));
        assert!(!is_name_conflict(&WorkspaceError::OutsideWorkspace));
        assert!(!is_name_conflict(&WorkspaceError::Io(io::Error::from(
            io::ErrorKind::PermissionDenied
        ))));
    }
}

use std::ffi::OsStr;
use std::fs::{self, DirEntry, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const FILE_PREFIX: &str = "dakedaduck-commit-";
const FILE_SUFFIX: &str = ".txt";
const CRLF: &str = "\r\n";
const CR: &str = "\r";
const LF: &str = "\n";
const STALE_AFTER: Duration = Duration::from_secs(2 * 60 * 60);

static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

pub struct MessageFile {
    path: PathBuf,
}

impl MessageFile {
    pub fn create(message: &str) -> io::Result<Self> {
        let path = unique_path();
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        let message_file = Self { path };
        file.write_all(normalize_line_endings(message).as_bytes())?;
        Ok(message_file)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for MessageFile {
    fn drop(&mut self) {
        fs::remove_file(&self.path).ok();
    }
}

fn unique_path() -> PathBuf {
    let sequence = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
    let name = format!(
        "{FILE_PREFIX}{}-{sequence}{FILE_SUFFIX}",
        std::process::id()
    );
    std::env::temp_dir().join(name)
}

// svn rechaza mensajes con finales de linea mezclados (E135000)
fn normalize_line_endings(message: &str) -> String {
    message.replace(CRLF, LF).replace(CR, LF)
}

pub fn purge_stale_in_temp() {
    purge_stale(&std::env::temp_dir(), STALE_AFTER);
}

pub fn purge_stale(dir: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    entries
        .flatten()
        .filter(|entry| is_message_file(&entry.file_name()) && is_older_than(entry, max_age))
        .for_each(|entry| {
            fs::remove_file(entry.path()).ok();
        });
}

fn is_message_file(name: &OsStr) -> bool {
    name.to_str()
        .is_some_and(|name| name.starts_with(FILE_PREFIX) && name.ends_with(FILE_SUFFIX))
}

fn is_older_than(entry: &DirEntry, max_age: Duration) -> bool {
    let modified = entry.metadata().and_then(|meta| meta.modified());
    modified
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age > max_age)
}

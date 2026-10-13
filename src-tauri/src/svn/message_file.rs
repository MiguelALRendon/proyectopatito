use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const FILE_PREFIX: &str = "dakedaduck-commit-";
const FILE_SUFFIX: &str = ".txt";
const CRLF: &str = "\r\n";
const CR: &str = "\r";
const LF: &str = "\n";

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

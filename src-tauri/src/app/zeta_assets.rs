use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::PathBuf;

use crate::app::files::Served;
use crate::app::range::{Outcome, Range, Slice, plan_within};

pub const CHUNK_BYTES: u64 = 8 * 1024 * 1024;

const MIME_HTML: &str = "text/html; charset=utf-8";
const MIME_JS: &str = "text/javascript; charset=utf-8";
const MIME_WASM: &str = "application/wasm";
const MIME_JSON: &str = "application/json";
const MIME_BINARY: &str = "application/octet-stream";

#[derive(Clone, Copy)]
enum Source {
    Embedded(&'static [u8]),
    OnDisk,
}

struct Entry {
    name: &'static str,
    mime: &'static str,
    source: Source,
}

const ENTRIES: [Entry; 8] = [
    Entry {
        name: "soffice.js",
        mime: MIME_JS,
        source: Source::OnDisk,
    },
    Entry {
        name: "soffice.wasm",
        mime: MIME_WASM,
        source: Source::OnDisk,
    },
    Entry {
        name: "soffice.data",
        mime: MIME_BINARY,
        source: Source::OnDisk,
    },
    Entry {
        name: "soffice.data.js.metadata",
        mime: MIME_JSON,
        source: Source::OnDisk,
    },
    Entry {
        name: "zeta.js",
        mime: MIME_JS,
        source: Source::OnDisk,
    },
    Entry {
        name: "host.html",
        mime: MIME_HTML,
        source: Source::Embedded(include_bytes!("../../assets/zeta/host.html")),
    },
    Entry {
        name: "host.js",
        mime: MIME_JS,
        source: Source::Embedded(include_bytes!("../../assets/zeta/host.js")),
    },
    Entry {
        name: "office_thread.js",
        mime: MIME_JS,
        source: Source::Embedded(include_bytes!("../../assets/zeta/office_thread.js")),
    },
];

#[cfg(any(debug_assertions, feature = "e2e-config-dir"))]
const TEST_HOOK_ENTRIES: [Entry; 2] = [
    Entry {
        name: "office_test.js",
        mime: MIME_JS,
        source: Source::Embedded(include_bytes!("../../assets/zeta/office_test.js")),
    },
    Entry {
        name: "office_test_thread.js",
        mime: MIME_JS,
        source: Source::Embedded(include_bytes!("../../assets/zeta/office_test_thread.js")),
    },
];

#[cfg(not(any(debug_assertions, feature = "e2e-config-dir")))]
const TEST_HOOK_ENTRIES: [Entry; 0] = [];

#[derive(Debug, thiserror::Error)]
pub enum AssetError {
    #[error("el recurso no está en la lista de ZetaOffice")]
    NotListed,
    #[error("falta el recurso de ZetaOffice en disco")]
    Missing,
    #[error("no se pudo leer el recurso de ZetaOffice: {0}")]
    Io(#[from] io::Error),
}

pub fn is_listed(name: &str) -> bool {
    entry_named(name).is_some()
}

fn entry_named(name: &str) -> Option<&'static Entry> {
    ENTRIES
        .iter()
        .chain(TEST_HOOK_ENTRIES.iter())
        .find(|entry| entry.name == name)
}

pub struct ZetaAssets {
    directory: PathBuf,
}

impl ZetaAssets {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn serve(&self, name: &str, range: Option<Range>) -> Result<Served, AssetError> {
        let entry = entry_named(name).ok_or(AssetError::NotListed)?;
        let (total, reader) = self.measure(entry)?;
        let outcome = plan_within(range, total, CHUNK_BYTES);
        let body = match outcome {
            Outcome::Full(slice) | Outcome::Partial(slice) => reader.read(slice)?,
            Outcome::TooLarge | Outcome::Unsatisfiable => Vec::new(),
        };
        Ok(Served {
            mime: entry.mime,
            total,
            outcome,
            body,
        })
    }

    fn measure(&self, entry: &Entry) -> Result<(u64, Reader), AssetError> {
        match entry.source {
            Source::Embedded(bytes) => Ok((bytes.len() as u64, Reader::Embedded(bytes))),
            Source::OnDisk => {
                let path = self.directory.join(entry.name);
                let file = File::open(&path).map_err(missing_or_io)?;
                let total = file.metadata()?.len();
                Ok((total, Reader::OnDisk(file)))
            }
        }
    }
}

fn missing_or_io(error: io::Error) -> AssetError {
    match error.kind() {
        io::ErrorKind::NotFound => AssetError::Missing,
        _ => AssetError::Io(error),
    }
}

enum Reader {
    Embedded(&'static [u8]),
    OnDisk(File),
}

impl Reader {
    fn read(self, slice: Slice) -> io::Result<Vec<u8>> {
        match self {
            Self::Embedded(bytes) => Ok(embedded_slice(bytes, slice)),
            Self::OnDisk(mut file) => {
                file.seek(SeekFrom::Start(slice.start))?;
                let mut body = Vec::new();
                file.take(slice.len).read_to_end(&mut body)?;
                if body.len() as u64 != slice.len {
                    return Err(io::ErrorKind::UnexpectedEof.into());
                }
                Ok(body)
            }
        }
    }
}

fn embedded_slice(bytes: &[u8], slice: Slice) -> Vec<u8> {
    let start = slice.start as usize;
    bytes[start..start + slice.len as usize].to_vec()
}

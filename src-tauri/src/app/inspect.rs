use std::fs::File;
use std::io;
use std::path::Path;

use crate::app::compressed_tar::detect_compressed_tar;
use crate::app::container::{has_ole2_signature, has_zip_local_signature, read_zip_directory};
use crate::app::office::{OfficeFile, detect_office, office_format};
use crate::app::sniff::{ProbeKind, Sample, Sniffed, classify};

const MIME_ZIP: &str = "application/zip";
const ZIP_EXTENSION: &str = "zip";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Inspected {
    pub sniffed: Sniffed,
    pub has_macros: bool,
}

impl Inspected {
    pub fn plain(sniffed: Sniffed) -> Self {
        Self {
            sniffed,
            has_macros: false,
        }
    }
}

pub fn extension_of(file_name: &str) -> Option<&str> {
    let (stem, extension) = file_name.rsplit_once('.')?;
    (!stem.is_empty() && !extension.is_empty()).then_some(extension)
}

pub fn inspect(path: &Path, len: u64, head: &[u8], truncated: bool) -> io::Result<Inspected> {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let extension = extension_of(&file_name);
    if let Some(office) = inspect_office(path, len, head, extension)? {
        return Ok(office);
    }
    if let Some(tarball) = detect_compressed_tar(path, &file_name)? {
        return Ok(Inspected::plain(tarball));
    }
    let sample = Sample {
        bytes: head,
        truncated,
        extension,
    };
    let sniffed = classify(sample);
    if is_plain_zip(sniffed, head, extension) && has_zip_directory(path, len)? {
        return Ok(Inspected::plain(zip_archive()));
    }
    Ok(Inspected::plain(sniffed))
}

fn inspect_office(
    path: &Path,
    len: u64,
    head: &[u8],
    extension: Option<&str>,
) -> io::Result<Option<Inspected>> {
    let Some(extension) = extension.filter(|ext| office_format(ext)) else {
        return Ok(None);
    };
    if !(has_zip_local_signature(head) || has_ole2_signature(head)) {
        return Ok(None);
    }
    let office = detect_office(&mut File::open(path)?, len, extension)?;
    Ok(office.map(office_inspected))
}

fn office_inspected(office: OfficeFile) -> Inspected {
    Inspected {
        sniffed: Sniffed {
            kind: ProbeKind::Office,
            mime: office.mime,
            extension: Some(office.extension),
        },
        has_macros: office.has_macros,
    }
}

fn is_plain_zip(sniffed: Sniffed, head: &[u8], extension: Option<&str>) -> bool {
    sniffed.kind == ProbeKind::Binary
        && has_zip_local_signature(head)
        && !extension.is_some_and(office_format)
}

fn has_zip_directory(path: &Path, len: u64) -> io::Result<bool> {
    Ok(read_zip_directory(&mut File::open(path)?, len)?.is_some())
}

fn zip_archive() -> Sniffed {
    Sniffed {
        kind: ProbeKind::Archive,
        mime: MIME_ZIP,
        extension: Some(ZIP_EXTENSION),
    }
}

use std::io::{self, Read, Seek};

use crate::app::container::{ZipEntry, read_ole2_names, read_stored_entry, read_zip_directory};

const OOXML_CONTENT_TYPES: &str = "[Content_Types].xml";
const OOXML_MACRO_PROJECT: &str = "vbaProject.bin";
const ODF_MIMETYPE_ENTRY: &str = "mimetype";
const ODF_MACRO_DIRECTORIES: [&str; 2] = ["Basic/", "Scripts/"];
const ODF_MIMETYPE_MAX_LEN: usize = 128;
const OLE2_MACRO_ENTRIES: [&str; 3] = ["Macros", "_VBA_PROJECT_CUR", "VBA"];

const MIME_DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PPTX: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MIME_ODT: &str = "application/vnd.oasis.opendocument.text";
const MIME_ODS: &str = "application/vnd.oasis.opendocument.spreadsheet";
const MIME_ODP: &str = "application/vnd.oasis.opendocument.presentation";
const MIME_DOC: &str = "application/msword";
const MIME_XLS: &str = "application/vnd.ms-excel";
const MIME_PPT: &str = "application/vnd.ms-powerpoint";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OfficeFile {
    pub mime: &'static str,
    pub extension: &'static str,
    pub has_macros: bool,
}

#[derive(Clone, Copy)]
enum Container {
    Ooxml { part_directory: &'static str },
    Odf,
    Ole2 { streams: &'static [&'static str] },
}

struct Format {
    extension: &'static str,
    mime: &'static str,
    container: Container,
}

const FORMATS: [Format; 9] = [
    Format {
        extension: "docx",
        mime: MIME_DOCX,
        container: Container::Ooxml {
            part_directory: "word/",
        },
    },
    Format {
        extension: "xlsx",
        mime: MIME_XLSX,
        container: Container::Ooxml {
            part_directory: "xl/",
        },
    },
    Format {
        extension: "pptx",
        mime: MIME_PPTX,
        container: Container::Ooxml {
            part_directory: "ppt/",
        },
    },
    Format {
        extension: "odt",
        mime: MIME_ODT,
        container: Container::Odf,
    },
    Format {
        extension: "ods",
        mime: MIME_ODS,
        container: Container::Odf,
    },
    Format {
        extension: "odp",
        mime: MIME_ODP,
        container: Container::Odf,
    },
    Format {
        extension: "doc",
        mime: MIME_DOC,
        container: Container::Ole2 {
            streams: &["WordDocument"],
        },
    },
    Format {
        extension: "xls",
        mime: MIME_XLS,
        container: Container::Ole2 {
            streams: &["Workbook", "Book"],
        },
    },
    Format {
        extension: "ppt",
        mime: MIME_PPT,
        container: Container::Ole2 {
            streams: &["PowerPoint Document"],
        },
    },
];

pub fn office_format(extension: &str) -> bool {
    FORMATS.iter().any(|format| format.extension == extension)
}

pub fn detect_office<R: Read + Seek>(
    reader: &mut R,
    len: u64,
    extension: &str,
) -> io::Result<Option<OfficeFile>> {
    let Some(format) = FORMATS.iter().find(|format| format.extension == extension) else {
        return Ok(None);
    };
    let has_macros = match format.container {
        Container::Ooxml { part_directory } => ooxml_macros(reader, len, part_directory)?,
        Container::Odf => odf_macros(reader, len, format.mime)?,
        Container::Ole2 { streams } => ole2_macros(reader, len, streams)?,
    };
    Ok(has_macros.map(|has_macros| OfficeFile {
        mime: format.mime,
        extension: format.extension,
        has_macros,
    }))
}

fn ooxml_macros<R: Read + Seek>(
    reader: &mut R,
    len: u64,
    part_directory: &str,
) -> io::Result<Option<bool>> {
    let Some(entries) = read_zip_directory(reader, len)? else {
        return Ok(None);
    };
    let has_types = entries
        .iter()
        .any(|entry| entry.name == OOXML_CONTENT_TYPES);
    let has_parts = entries
        .iter()
        .any(|entry| entry.name.starts_with(part_directory));
    let macros = entries
        .iter()
        .any(|entry| entry.name.ends_with(OOXML_MACRO_PROJECT));
    Ok((has_types && has_parts).then_some(macros))
}

fn odf_macros<R: Read + Seek>(reader: &mut R, len: u64, mime: &str) -> io::Result<Option<bool>> {
    let Some(entries) = read_zip_directory(reader, len)? else {
        return Ok(None);
    };
    let Some(declared) = entries
        .iter()
        .find(|entry| entry.name == ODF_MIMETYPE_ENTRY)
    else {
        return Ok(None);
    };
    if !declares_mime(reader, declared, mime)? {
        return Ok(None);
    }
    Ok(Some(entries.iter().any(is_odf_macro)))
}

fn declares_mime<R: Read + Seek>(reader: &mut R, entry: &ZipEntry, mime: &str) -> io::Result<bool> {
    let content = read_stored_entry(reader, entry, ODF_MIMETYPE_MAX_LEN)?;
    Ok(content.is_some_and(|bytes| bytes == mime.as_bytes()))
}

fn is_odf_macro(entry: &ZipEntry) -> bool {
    ODF_MACRO_DIRECTORIES
        .iter()
        .any(|directory| entry.name.starts_with(directory))
}

fn ole2_macros<R: Read + Seek>(
    reader: &mut R,
    len: u64,
    streams: &[&str],
) -> io::Result<Option<bool>> {
    let Some(names) = read_ole2_names(reader, len)? else {
        return Ok(None);
    };
    let belongs = names.iter().any(|name| streams.contains(&name.as_str()));
    let macros = names
        .iter()
        .any(|name| OLE2_MACRO_ENTRIES.contains(&name.as_str()));
    Ok(belongs.then_some(macros))
}

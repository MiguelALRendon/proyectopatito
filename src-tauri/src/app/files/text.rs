use serde::{Deserialize, Serialize};

use super::FileError;
use crate::app::sniff::{UTF8_BOM, UTF16_BE_BOM, UTF16_LE_BOM, UTF16_UNIT_BYTES};

const BYTES_PER_KIB: u64 = 1024;
pub const MAX_EDITABLE_MIB: u64 = 5;
pub const MAX_EDITABLE_BYTES: u64 = MAX_EDITABLE_MIB * BYTES_PER_KIB * BYTES_PER_KIB;
pub const HEX_CHUNK: usize = 64 * 1024;

const CRLF: &str = "\r\n";
const LF: &str = "\n";
const NUL: char = '\0';
const BOM_ENCODINGS: [Encoding; 3] = [Encoding::Utf16Le, Encoding::Utf16Be, Encoding::Utf8];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Eol {
    Lf,
    #[serde(rename = "crlf")]
    CrLf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TextDocument {
    pub content: String,
    pub encoding: Encoding,
    pub has_bom: bool,
    pub eol: Eol,
    pub eol_mixed: bool,
    pub version: String,
    pub len: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct TextUpdate {
    pub content: String,
    pub encoding: Encoding,
    pub has_bom: bool,
    pub eol: Eol,
    pub expected_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TextWritten {
    pub version: String,
}

impl Encoding {
    fn requires_bom(self) -> bool {
        self != Self::Utf8
    }

    fn bom(self) -> &'static [u8] {
        match self {
            Self::Utf8 => UTF8_BOM,
            Self::Utf16Le => &UTF16_LE_BOM,
            Self::Utf16Be => &UTF16_BE_BOM,
        }
    }

    fn of_bom(bytes: &[u8]) -> Option<Self> {
        BOM_ENCODINGS
            .into_iter()
            .find(|encoding| bytes.starts_with(encoding.bom()))
    }

    fn decode(self, bytes: &[u8]) -> Option<String> {
        match self {
            Self::Utf8 => std::str::from_utf8(bytes).ok().map(str::to_owned),
            Self::Utf16Le => decode_utf16(bytes, u16::from_le_bytes),
            Self::Utf16Be => decode_utf16(bytes, u16::from_be_bytes),
        }
    }

    fn encode(self, text: &str) -> Vec<u8> {
        match self {
            Self::Utf8 => text.as_bytes().to_vec(),
            Self::Utf16Le => text.encode_utf16().flat_map(u16::to_le_bytes).collect(),
            Self::Utf16Be => text.encode_utf16().flat_map(u16::to_be_bytes).collect(),
        }
    }
}

fn decode_utf16(bytes: &[u8], unit_from_bytes: fn([u8; 2]) -> u16) -> Option<String> {
    let pairs = bytes.chunks_exact(UTF16_UNIT_BYTES);
    if !pairs.remainder().is_empty() {
        return None;
    }
    let units: Vec<u16> = pairs
        .map(|pair| unit_from_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

pub(super) fn decode_document(bytes: &[u8], version: String) -> Result<TextDocument, FileError> {
    let bom_encoding = Encoding::of_bom(bytes);
    let encoding = bom_encoding.unwrap_or(Encoding::Utf8);
    let body = bom_encoding.map_or(bytes, |found| &bytes[found.bom().len()..]);
    let content = encoding
        .decode(body)
        .filter(|text| !text.contains(NUL))
        .ok_or(FileError::NotText)?;
    let (eol, eol_mixed) = line_endings(&content);
    Ok(TextDocument {
        content,
        encoding,
        has_bom: bom_encoding.is_some(),
        eol,
        eol_mixed,
        version,
        len: bytes.len() as u64,
    })
}

pub(super) fn encode_document(update: &TextUpdate) -> Vec<u8> {
    let bom: &[u8] = if update.has_bom || update.encoding.requires_bom() {
        update.encoding.bom()
    } else {
        &[]
    };
    let body = update
        .encoding
        .encode(&apply_eol(&update.content, update.eol));
    [bom, body.as_slice()].concat()
}

fn line_endings(content: &str) -> (Eol, bool) {
    let crlf = content.matches(CRLF).count();
    let lf = content.matches(LF).count() - crlf;
    let dominant = if crlf > lf { Eol::CrLf } else { Eol::Lf };
    (dominant, crlf > 0 && lf > 0)
}

fn apply_eol(content: &str, eol: Eol) -> String {
    let unix = content.replace(CRLF, LF);
    match eol {
        Eol::Lf => unix,
        Eol::CrLf => unix.replace(LF, CRLF),
    }
}

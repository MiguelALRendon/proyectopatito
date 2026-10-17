use serde::Serialize;

const BYTES_PER_KIB: usize = 1024;
pub const SNIFF_BYTES: usize = 8 * BYTES_PER_KIB;

const MIME_TEXT: &str = "text/plain";
const MIME_BINARY: &str = "application/octet-stream";
const MIME_PDF: &str = "application/pdf";
const MIME_SVG: &str = "image/svg+xml";
const MIME_PNG: &str = "image/png";
const MIME_JPEG: &str = "image/jpeg";
const MIME_GIF: &str = "image/gif";
const MIME_WEBP: &str = "image/webp";
const MIME_BMP: &str = "image/bmp";
const MIME_ICO: &str = "image/x-icon";

const PDF_SIGNATURE: &[u8] = b"%PDF-";
pub(crate) const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
pub(crate) const UTF16_LE_BOM: [u8; 2] = [0xFF, 0xFE];
pub(crate) const UTF16_BE_BOM: [u8; 2] = [0xFE, 0xFF];
type Utf16Decoder = fn([u8; 2]) -> u16;
const UTF16_BOMS: [([u8; 2], Utf16Decoder); 2] = [
    (UTF16_LE_BOM, u16::from_le_bytes),
    (UTF16_BE_BOM, u16::from_be_bytes),
];
pub(crate) const UTF16_UNIT_BYTES: usize = 2;
const SVG_TAG: &[u8] = b"<svg";
const SVG_TAG_TERMINATORS: [u8; 2] = [b'>', b'/'];
const PROLOG_ITEMS: [(&[u8], &[u8]); 3] = [(b"<?", b"?>"), (b"<!--", b"-->"), (b"<!", b">")];

const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const PNG_FIRST_CHUNK_TYPE: &[u8] = b"IHDR";
const PNG_FIRST_CHUNK_LENGTH: u32 = 13;
const PNG_CHUNK_LENGTH_AT: usize = 8;
const PNG_CHUNK_TYPE_AT: usize = 12;
const PNG_WIDTH_AT: usize = 16;
const PNG_HEIGHT_AT: usize = 20;

const JPEG_PREFIX: &[u8] = &[0xFF, 0xD8, 0xFF];
const JPEG_MARKER_AT: usize = 3;
const JPEG_MARKERS: std::ops::RangeInclusive<u8> = 0xC0..=0xFE;

const GIF_SIGNATURES: [&[u8]; 2] = [b"GIF87a", b"GIF89a"];
const GIF_WIDTH_AT: usize = 6;
const GIF_HEIGHT_AT: usize = 8;

const RIFF_SIGNATURE: &[u8] = b"RIFF";
const WEBP_SIGNATURE: &[u8] = b"WEBP";
const WEBP_CHUNK_TYPES: [&[u8]; 3] = [b"VP8 ", b"VP8L", b"VP8X"];
const RIFF_SIZE_AT: usize = 4;
const WEBP_SIGNATURE_AT: usize = 8;
const WEBP_CHUNK_TYPE_AT: usize = 12;
const WEBP_MIN_RIFF_SIZE: u32 = 12;

const BMP_SIGNATURE: &[u8] = b"BM";
const BMP_FILE_SIZE_AT: usize = 2;
const BMP_RESERVED_AT: usize = 6;
const BMP_PIXEL_OFFSET_AT: usize = 10;
const BMP_DIB_SIZE_AT: usize = 14;
const BMP_FILE_HEADER_LEN: u32 = 14;
const BMP_DIB_SIZES: [u32; 7] = [12, 40, 52, 56, 64, 108, 124];

const ICO_SIGNATURE: &[u8] = &[0, 0, 1, 0];
const ICO_COUNT_AT: usize = 4;
const ICO_DIRECTORY_LEN: u32 = 6;
const ICO_ENTRY_LEN: u32 = 16;
const ICO_MAX_IMAGES: u16 = 256;
const ICO_ENTRY_RESERVED_AT: usize = 9;
const ICO_ENTRY_PLANES_AT: usize = 10;
const ICO_ENTRY_BIT_DEPTH_AT: usize = 12;
const ICO_ENTRY_SIZE_AT: usize = 14;
const ICO_ENTRY_OFFSET_AT: usize = 18;
const ICO_MAX_PLANES: u16 = 1;
const ICO_BIT_DEPTHS: [u16; 7] = [0, 1, 4, 8, 16, 24, 32];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeKind {
    Text,
    Image,
    Pdf,
    Binary,
    Cloud,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sniffed {
    pub kind: ProbeKind,
    pub mime: &'static str,
    pub extension: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
pub struct Sample<'a> {
    pub bytes: &'a [u8],
    pub truncated: bool,
}

struct ImageFormat {
    mime: &'static str,
    extension: &'static str,
    has_coherent_header: fn(&[u8]) -> bool,
}

const IMAGE_FORMATS: [ImageFormat; 6] = [
    ImageFormat {
        mime: MIME_PNG,
        extension: "png",
        has_coherent_header: is_png,
    },
    ImageFormat {
        mime: MIME_JPEG,
        extension: "jpg",
        has_coherent_header: is_jpeg,
    },
    ImageFormat {
        mime: MIME_GIF,
        extension: "gif",
        has_coherent_header: is_gif,
    },
    ImageFormat {
        mime: MIME_WEBP,
        extension: "webp",
        has_coherent_header: is_webp,
    },
    ImageFormat {
        mime: MIME_BMP,
        extension: "bmp",
        has_coherent_header: is_bmp,
    },
    ImageFormat {
        mime: MIME_ICO,
        extension: "ico",
        has_coherent_header: is_ico,
    },
];

const TEXT: Sniffed = Sniffed {
    kind: ProbeKind::Text,
    mime: MIME_TEXT,
    extension: None,
};
const BINARY: Sniffed = Sniffed {
    kind: ProbeKind::Binary,
    mime: MIME_BINARY,
    extension: None,
};
pub const CLOUD_PLACEHOLDER: Sniffed = Sniffed {
    kind: ProbeKind::Cloud,
    mime: MIME_BINARY,
    extension: None,
};
const PDF: Sniffed = Sniffed {
    kind: ProbeKind::Pdf,
    mime: MIME_PDF,
    extension: Some("pdf"),
};
const SVG: Sniffed = Sniffed {
    kind: ProbeKind::Image,
    mime: MIME_SVG,
    extension: Some("svg"),
};

pub fn classify(sample: Sample<'_>) -> Sniffed {
    if let Some(format) = image_format(sample.bytes) {
        return Sniffed {
            kind: ProbeKind::Image,
            mime: format.mime,
            extension: Some(format.extension),
        };
    }
    if is_pdf(sample.bytes) {
        return PDF;
    }
    if !is_text(sample) {
        return BINARY;
    }
    if is_svg(sample.bytes) { SVG } else { TEXT }
}

fn image_format(bytes: &[u8]) -> Option<&'static ImageFormat> {
    IMAGE_FORMATS
        .iter()
        .find(|format| (format.has_coherent_header)(bytes))
}

fn is_pdf(bytes: &[u8]) -> bool {
    bytes
        .strip_prefix(PDF_SIGNATURE)
        .and_then(<[u8]>::first)
        .is_some_and(u8::is_ascii_digit)
}

fn is_text(sample: Sample<'_>) -> bool {
    let utf16 = UTF16_BOMS.iter().find_map(|(bom, decode)| {
        let body = sample.bytes.strip_prefix(bom.as_slice())?;
        Some((body, *decode))
    });
    match utf16 {
        Some((body, decode)) => is_utf16_text(
            Sample {
                bytes: body,
                ..sample
            },
            decode,
        ),
        None => is_utf8_text(sample),
    }
}

fn is_utf8_text(sample: Sample<'_>) -> bool {
    if sample.bytes.contains(&0) {
        return false;
    }
    match std::str::from_utf8(sample.bytes) {
        Ok(_) => true,
        Err(error) => sample.truncated && error.error_len().is_none(),
    }
}

fn is_utf16_text(sample: Sample<'_>, decode: Utf16Decoder) -> bool {
    if !sample.truncated && sample.bytes.len() % UTF16_UNIT_BYTES != 0 {
        return false;
    }
    let units = sample
        .bytes
        .chunks_exact(UTF16_UNIT_BYTES)
        .map(|pair| decode([pair[0], pair[1]]));
    let mut decoded: Vec<_> = char::decode_utf16(units).collect();
    if sample.truncated && decoded.last().is_some_and(Result::is_err) {
        decoded.pop();
    }
    decoded
        .iter()
        .all(|unit| matches!(unit, Ok(ch) if *ch != '\0'))
}

fn is_svg(bytes: &[u8]) -> bool {
    let mut rest = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);
    loop {
        rest = rest.trim_ascii_start();
        let Some(next) = skip_prolog_item(rest) else {
            break;
        };
        rest = next;
    }
    let Some(after_tag) = rest.strip_prefix(SVG_TAG) else {
        return false;
    };
    after_tag
        .first()
        .is_some_and(|next| next.is_ascii_whitespace() || SVG_TAG_TERMINATORS.contains(next))
}

fn skip_prolog_item(rest: &[u8]) -> Option<&[u8]> {
    PROLOG_ITEMS.iter().find_map(|(open, close)| {
        let body = rest.strip_prefix(*open)?;
        let end = body
            .windows(close.len())
            .position(|window| window == *close)?;
        Some(&body[end + close.len()..])
    })
}

fn u16_le(bytes: &[u8], at: usize) -> Option<u16> {
    let field = bytes.get(at..at + size_of::<u16>())?;
    Some(u16::from_le_bytes(field.try_into().ok()?))
}

fn u32_le(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at + size_of::<u32>())?;
    Some(u32::from_le_bytes(field.try_into().ok()?))
}

fn u32_be(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at + size_of::<u32>())?;
    Some(u32::from_be_bytes(field.try_into().ok()?))
}

fn is_positive(value: Option<u32>) -> bool {
    value.is_some_and(|number| number > 0)
}

fn has_at(bytes: &[u8], at: usize, expected: &[u8]) -> bool {
    bytes.get(at..at + expected.len()) == Some(expected)
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(PNG_SIGNATURE)
        && u32_be(bytes, PNG_CHUNK_LENGTH_AT) == Some(PNG_FIRST_CHUNK_LENGTH)
        && has_at(bytes, PNG_CHUNK_TYPE_AT, PNG_FIRST_CHUNK_TYPE)
        && is_positive(u32_be(bytes, PNG_WIDTH_AT))
        && is_positive(u32_be(bytes, PNG_HEIGHT_AT))
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(JPEG_PREFIX)
        && bytes
            .get(JPEG_MARKER_AT)
            .is_some_and(|marker| JPEG_MARKERS.contains(marker))
}

fn is_gif(bytes: &[u8]) -> bool {
    GIF_SIGNATURES
        .iter()
        .any(|signature| bytes.starts_with(signature))
        && u16_le(bytes, GIF_WIDTH_AT).is_some_and(|width| width > 0)
        && u16_le(bytes, GIF_HEIGHT_AT).is_some_and(|height| height > 0)
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.starts_with(RIFF_SIGNATURE)
        && u32_le(bytes, RIFF_SIZE_AT).is_some_and(|size| size >= WEBP_MIN_RIFF_SIZE)
        && has_at(bytes, WEBP_SIGNATURE_AT, WEBP_SIGNATURE)
        && WEBP_CHUNK_TYPES
            .iter()
            .any(|chunk_type| has_at(bytes, WEBP_CHUNK_TYPE_AT, chunk_type))
}

fn is_bmp(bytes: &[u8]) -> bool {
    let (Some(size), Some(reserved), Some(offset), Some(dib_size)) = (
        u32_le(bytes, BMP_FILE_SIZE_AT),
        u32_le(bytes, BMP_RESERVED_AT),
        u32_le(bytes, BMP_PIXEL_OFFSET_AT),
        u32_le(bytes, BMP_DIB_SIZE_AT),
    ) else {
        return false;
    };
    bytes.starts_with(BMP_SIGNATURE)
        && reserved == 0
        && BMP_DIB_SIZES.contains(&dib_size)
        && offset >= BMP_FILE_HEADER_LEN + dib_size
        && size >= offset
}

fn is_ico(bytes: &[u8]) -> bool {
    let Some(count) = u16_le(bytes, ICO_COUNT_AT) else {
        return false;
    };
    bytes.starts_with(ICO_SIGNATURE)
        && (1..=ICO_MAX_IMAGES).contains(&count)
        && has_plausible_first_ico_entry(bytes, count)
}

fn has_plausible_first_ico_entry(bytes: &[u8], count: u16) -> bool {
    let table_end = ICO_DIRECTORY_LEN + ICO_ENTRY_LEN * u32::from(count);
    bytes.get(ICO_ENTRY_RESERVED_AT) == Some(&0)
        && u16_le(bytes, ICO_ENTRY_PLANES_AT).is_some_and(|planes| planes <= ICO_MAX_PLANES)
        && u16_le(bytes, ICO_ENTRY_BIT_DEPTH_AT)
            .is_some_and(|depth| ICO_BIT_DEPTHS.contains(&depth))
        && is_positive(u32_le(bytes, ICO_ENTRY_SIZE_AT))
        && u32_le(bytes, ICO_ENTRY_OFFSET_AT).is_some_and(|offset| offset >= table_end)
}

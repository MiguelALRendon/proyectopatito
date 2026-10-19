use crate::app::sniff::{ProbeKind, Sniffed};

const MIME_MP3: &str = "audio/mpeg";
const MIME_WAV: &str = "audio/wav";
const MIME_FLAC: &str = "audio/flac";
const MIME_OGG_AUDIO: &str = "audio/ogg";
const MIME_OGG_VIDEO: &str = "video/ogg";
const MIME_M4A: &str = "audio/mp4";
const MIME_MP4: &str = "video/mp4";
const MIME_QUICKTIME: &str = "video/quicktime";
const MIME_AVI: &str = "video/x-msvideo";
const MIME_WEBM_VIDEO: &str = "video/webm";
const MIME_WEBM_AUDIO: &str = "audio/webm";
const MIME_MATROSKA_VIDEO: &str = "video/x-matroska";
const MIME_MATROSKA_AUDIO: &str = "audio/x-matroska";
const MIME_7Z: &str = "application/x-7z-compressed";
const MIME_RAR: &str = "application/vnd.rar";
const MIME_TAR: &str = "application/x-tar";

const ID3_SIGNATURE: &[u8] = b"ID3";
const ID3_HEADER_LEN: usize = 10;
const ID3_VERSIONS: std::ops::RangeInclusive<u8> = 2..=4;
const ID3_VERSION_AT: usize = 3;
const ID3_REVISION_AT: usize = 4;
const ID3_UNSET_REVISION: u8 = 0xFF;
const ID3_SIZE_AT: usize = 6;
const ID3_SYNCSAFE_BIT: u8 = 0x80;
const MPEG_EXTENSIONS: [&str; 3] = ["mp3", "mp2", "mpga"];
const MPEG_SYNC_SHIFT: u32 = 21;
const MPEG_SYNC: u32 = 0x7FF;
const MPEG_RESERVED_VERSION: u32 = 1;
const MPEG_RESERVED_LAYER: u32 = 0;
const MPEG_RESERVED_SAMPLE_RATE: u32 = 3;
const MPEG_BAD_BITRATES: [u32; 2] = [0, 0xF];

const RIFF_SIGNATURE: &[u8] = b"RIFF";
const RIFF_FORM_AT: usize = 8;
const RIFF_CHUNK_AT: usize = 12;
const WAVE_FORM: &[u8] = b"WAVE";
const WAVE_FORMAT_CHUNK: &[u8] = b"fmt ";
const AVI_FORM: &[u8] = b"AVI ";
const AVI_LIST_CHUNK: &[u8] = b"LIST";

const FLAC_SIGNATURE: &[u8] = b"fLaC";
const FLAC_BLOCK_TYPE_AT: usize = 4;
const FLAC_BLOCK_TYPE_MASK: u8 = 0x7F;
const FLAC_STREAMINFO_TYPE: u8 = 0;
const FLAC_STREAMINFO_LENGTH: [u8; 3] = [0, 0, 34];
const FLAC_LENGTH_AT: usize = 5;

const OGG_SIGNATURE: &[u8] = b"OggS";
const OGG_VERSION_AT: usize = 4;
const OGG_FLAGS_AT: usize = 5;
const OGG_UNDEFINED_FLAGS: u8 = 0xF8;
const OGG_SEGMENTS_AT: usize = 26;
const OGG_AUDIO_CODECS: [&[u8]; 3] = [b"\x01vorbis", b"OpusHead", b"\x7fFLAC"];
const OGG_VIDEO_CODECS: [&[u8]; 1] = [b"\x80theora"];

const FTYP_TYPE_AT: usize = 4;
const FTYP_BRAND_AT: usize = 8;
const FTYP_MIN_SIZE: u32 = 16;
const FTYP_BRAND_LEN: usize = 4;
const FTYP_AUDIO_BRANDS: [&[u8]; 3] = [b"M4A ", b"M4B ", b"M4P "];
const FTYP_QUICKTIME_BRAND: &[u8] = b"qt  ";
const FTYP_VIDEO_BRANDS: [&[u8]; 17] = [
    b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"dash", b"msnv",
    b"M4V ", b"M4VH", b"M4VP", b"3gp4", b"3gp5", b"3gp6", b"f4v ",
];
const AUDIO_MP4_EXTENSIONS: [&str; 2] = ["m4a", "m4b"];

const EBML_SIGNATURE: &[u8] = &[0x1A, 0x45, 0xDF, 0xA3];
const EBML_HEADER_WINDOW: usize = 64;
const EBML_DOCTYPE_ID: [u8; 2] = [0x42, 0x82];
const EBML_DOCTYPE_WEBM: &[u8] = b"\x84webm";
const EBML_DOCTYPE_MATROSKA: &[u8] = b"\x88matroska";
const AUDIO_EBML_EXTENSIONS: [&str; 2] = ["weba", "mka"];

const SEVEN_ZIP_SIGNATURE: &[u8] = &[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];
const SEVEN_ZIP_MAJOR_AT: usize = 6;
const SEVEN_ZIP_START_CRC_AT: usize = 8;
const SEVEN_ZIP_START_HEADER: std::ops::Range<usize> = 12..32;
const RAR4_SIGNATURE: &[u8] = b"Rar!\x1A\x07\x00";
const RAR5_SIGNATURE: &[u8] = b"Rar!\x1A\x07\x01\x00";

const TAR_BLOCK_LEN: usize = 512;
const TAR_MAGIC_AT: usize = 257;
const TAR_MAGICS: [&[u8]; 2] = [b"ustar\x0000", b"ustar  \x00"];
const TAR_CHECKSUM_FIELD: std::ops::Range<usize> = 148..156;
const TAR_CHECKSUM_BLANK: u32 = b' ' as u32;
const TAR_OCTAL_RADIX: u32 = 8;
const TAR_NAME_AT: usize = 0;

const CRC32_POLYNOMIAL: u32 = 0xEDB8_8320;
const BITS_PER_BYTE: u32 = 8;

type Detector = fn(&[u8], Option<&str>) -> Option<Sniffed>;

const DETECTORS: [Detector; 10] = [
    id3, mpeg_frame, riff, flac, ogg, mp4_family, ebml, seven_zip, rar, tar,
];

pub fn classify_media(bytes: &[u8], extension: Option<&str>) -> Option<Sniffed> {
    DETECTORS.iter().find_map(|detect| detect(bytes, extension))
}

pub fn has_tar_header(bytes: &[u8]) -> bool {
    tar(bytes, None).is_some()
}

fn sniffed(kind: ProbeKind, mime: &'static str, extension: &'static str) -> Sniffed {
    Sniffed {
        kind,
        mime,
        extension: Some(extension),
    }
}

fn audio(mime: &'static str, extension: &'static str) -> Option<Sniffed> {
    Some(sniffed(ProbeKind::Audio, mime, extension))
}

fn video(mime: &'static str, extension: &'static str) -> Option<Sniffed> {
    Some(sniffed(ProbeKind::Video, mime, extension))
}

fn archive(mime: &'static str, extension: &'static str) -> Option<Sniffed> {
    Some(sniffed(ProbeKind::Archive, mime, extension))
}

fn has_at(bytes: &[u8], at: usize, expected: &[u8]) -> bool {
    bytes.get(at..at + expected.len()) == Some(expected)
}

fn u32_be(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at + size_of::<u32>())?;
    Some(u32::from_be_bytes(field.try_into().ok()?))
}

fn u32_le(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at + size_of::<u32>())?;
    Some(u32::from_le_bytes(field.try_into().ok()?))
}

fn id3(bytes: &[u8], _extension: Option<&str>) -> Option<Sniffed> {
    let header = bytes.get(..ID3_HEADER_LEN)?;
    let coherent = header.starts_with(ID3_SIGNATURE)
        && ID3_VERSIONS.contains(&header[ID3_VERSION_AT])
        && header[ID3_REVISION_AT] != ID3_UNSET_REVISION
        && header[ID3_SIZE_AT..]
            .iter()
            .all(|byte| byte & ID3_SYNCSAFE_BIT == 0);
    coherent.then_some(())?;
    audio(MIME_MP3, "mp3")
}

fn mpeg_frame(bytes: &[u8], extension: Option<&str>) -> Option<Sniffed> {
    if !extension.is_some_and(|ext| MPEG_EXTENSIONS.contains(&ext)) {
        return None;
    }
    let header = u32_be(bytes, 0)?;
    let field = |shift: u32, mask: u32| (header >> shift) & mask;
    let coherent = header >> MPEG_SYNC_SHIFT == MPEG_SYNC
        && field(19, 3) != MPEG_RESERVED_VERSION
        && field(17, 3) != MPEG_RESERVED_LAYER
        && !MPEG_BAD_BITRATES.contains(&field(12, 0xF))
        && field(10, 3) != MPEG_RESERVED_SAMPLE_RATE;
    coherent.then_some(())?;
    audio(MIME_MP3, "mp3")
}

fn riff(bytes: &[u8], _extension: Option<&str>) -> Option<Sniffed> {
    if !bytes.starts_with(RIFF_SIGNATURE) {
        return None;
    }
    let has_form = |form: &[u8], chunk: &[u8]| {
        has_at(bytes, RIFF_FORM_AT, form) && has_at(bytes, RIFF_CHUNK_AT, chunk)
    };
    if has_form(WAVE_FORM, WAVE_FORMAT_CHUNK) {
        return audio(MIME_WAV, "wav");
    }
    if has_form(AVI_FORM, AVI_LIST_CHUNK) {
        return video(MIME_AVI, "avi");
    }
    None
}

fn flac(bytes: &[u8], _extension: Option<&str>) -> Option<Sniffed> {
    let coherent = bytes.starts_with(FLAC_SIGNATURE)
        && bytes
            .get(FLAC_BLOCK_TYPE_AT)
            .map(|kind| kind & FLAC_BLOCK_TYPE_MASK)
            == Some(FLAC_STREAMINFO_TYPE)
        && has_at(bytes, FLAC_LENGTH_AT, &FLAC_STREAMINFO_LENGTH);
    coherent.then_some(())?;
    audio(MIME_FLAC, "flac")
}

fn ogg(bytes: &[u8], _extension: Option<&str>) -> Option<Sniffed> {
    let segments = usize::from(*bytes.get(OGG_SEGMENTS_AT)?);
    let coherent = bytes.starts_with(OGG_SIGNATURE)
        && bytes.get(OGG_VERSION_AT) == Some(&0)
        && bytes
            .get(OGG_FLAGS_AT)
            .is_some_and(|flags| flags & OGG_UNDEFINED_FLAGS == 0)
        && segments > 0;
    coherent.then_some(())?;
    let packet_at = OGG_SEGMENTS_AT + 1 + segments;
    let starts_with_codec =
        |codecs: &[&[u8]]| codecs.iter().any(|codec| has_at(bytes, packet_at, codec));
    if starts_with_codec(&OGG_AUDIO_CODECS) {
        return audio(MIME_OGG_AUDIO, "ogg");
    }
    starts_with_codec(&OGG_VIDEO_CODECS)
        .then_some(())
        .and_then(|()| video(MIME_OGG_VIDEO, "ogv"))
}

fn mp4_family(bytes: &[u8], extension: Option<&str>) -> Option<Sniffed> {
    let size = u32_be(bytes, 0)?;
    if !has_at(bytes, FTYP_TYPE_AT, b"ftyp") || size < FTYP_MIN_SIZE {
        return None;
    }
    let brand = bytes.get(FTYP_BRAND_AT..FTYP_BRAND_AT + FTYP_BRAND_LEN)?;
    let audio_extension = extension.is_some_and(|ext| AUDIO_MP4_EXTENSIONS.contains(&ext));
    if FTYP_AUDIO_BRANDS.contains(&brand) || (audio_extension && FTYP_VIDEO_BRANDS.contains(&brand))
    {
        return audio(MIME_M4A, "m4a");
    }
    if brand == FTYP_QUICKTIME_BRAND {
        return video(MIME_QUICKTIME, "mov");
    }
    FTYP_VIDEO_BRANDS
        .contains(&brand)
        .then_some(())
        .and_then(|()| video(MIME_MP4, "mp4"))
}

fn ebml(bytes: &[u8], extension: Option<&str>) -> Option<Sniffed> {
    if !bytes.starts_with(EBML_SIGNATURE) {
        return None;
    }
    let window = &bytes[..bytes.len().min(EBML_HEADER_WINDOW)];
    let doc_type = |value: &[u8]| {
        let needle = [EBML_DOCTYPE_ID.as_slice(), value].concat();
        window.windows(needle.len()).any(|part| part == needle)
    };
    let audio_only = extension.is_some_and(|ext| AUDIO_EBML_EXTENSIONS.contains(&ext));
    match (
        doc_type(EBML_DOCTYPE_WEBM),
        doc_type(EBML_DOCTYPE_MATROSKA),
        audio_only,
    ) {
        (true, _, true) => audio(MIME_WEBM_AUDIO, "weba"),
        (true, _, false) => video(MIME_WEBM_VIDEO, "webm"),
        (_, true, true) => audio(MIME_MATROSKA_AUDIO, "mka"),
        (_, true, false) => video(MIME_MATROSKA_VIDEO, "mkv"),
        _ => None,
    }
}

fn seven_zip(bytes: &[u8], _extension: Option<&str>) -> Option<Sniffed> {
    let start_header = bytes.get(SEVEN_ZIP_START_HEADER)?;
    let coherent = bytes.starts_with(SEVEN_ZIP_SIGNATURE)
        && bytes.get(SEVEN_ZIP_MAJOR_AT) == Some(&0)
        && u32_le(bytes, SEVEN_ZIP_START_CRC_AT) == Some(crc32(start_header));
    coherent.then_some(())?;
    archive(MIME_7Z, "7z")
}

fn rar(bytes: &[u8], _extension: Option<&str>) -> Option<Sniffed> {
    let signed = bytes.starts_with(RAR4_SIGNATURE) || bytes.starts_with(RAR5_SIGNATURE);
    signed.then_some(())?;
    archive(MIME_RAR, "rar")
}

fn tar(bytes: &[u8], _extension: Option<&str>) -> Option<Sniffed> {
    let block = bytes.get(..TAR_BLOCK_LEN)?;
    let coherent = TAR_MAGICS
        .iter()
        .any(|magic| has_at(block, TAR_MAGIC_AT, magic))
        && block[TAR_NAME_AT] != 0
        && tar_checksum(block).is_some_and(|stored| stored == computed_tar_checksum(block));
    coherent.then_some(())?;
    archive(MIME_TAR, "tar")
}

fn tar_checksum(block: &[u8]) -> Option<u32> {
    let field = std::str::from_utf8(&block[TAR_CHECKSUM_FIELD]).ok()?;
    u32::from_str_radix(
        field.trim_matches(|ch| ch == '\0' || ch == ' '),
        TAR_OCTAL_RADIX,
    )
    .ok()
}

fn computed_tar_checksum(block: &[u8]) -> u32 {
    block
        .iter()
        .enumerate()
        .map(|(at, byte)| {
            if TAR_CHECKSUM_FIELD.contains(&at) {
                TAR_CHECKSUM_BLANK
            } else {
                u32::from(*byte)
            }
        })
        .sum()
}

fn crc32(bytes: &[u8]) -> u32 {
    !bytes.iter().fold(u32::MAX, |crc, byte| {
        (0..BITS_PER_BYTE).fold(crc ^ u32::from(*byte), |value, _| {
            (value >> 1) ^ (CRC32_POLYNOMIAL & (value & 1).wrapping_neg())
        })
    })
}

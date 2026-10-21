mod common;

use common::containers::{set_u32, tar_block};
use dakedaduck_svn_lib::app::sniff::{ProbeKind, Sample, Sniffed, classify};

const MP3_HEADER: [u8; 4] = [0xFF, 0xFB, 0x90, 0x00];
const SEVEN_ZIP_SIGNATURE: [u8; 6] = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];
const SEVEN_ZIP_START_HEADER_LEN: usize = 20;
const TAR_CHECKSUM_AT: usize = 148;
const SCAN_WINDOW: usize = 8192;

fn sniff(bytes: &[u8], extension: Option<&str>) -> Sniffed {
    classify(Sample {
        bytes,
        truncated: false,
        extension,
    })
}

fn kind_of(bytes: &[u8], extension: Option<&str>) -> ProbeKind {
    sniff(bytes, extension).kind
}

fn rejected(bytes: &[u8], extension: Option<&str>) -> bool {
    let claimed = kind_of(bytes, extension);
    matches!(claimed, ProbeKind::Binary | ProbeKind::Text) && claimed == kind_of(bytes, None)
}

fn padded(mut bytes: Vec<u8>) -> Vec<u8> {
    bytes.resize(bytes.len().max(64), 0);
    bytes
}

fn id3() -> Vec<u8> {
    padded(b"ID3\x04\x00\x00\x00\x00\x00\x00".to_vec())
}

fn wave() -> Vec<u8> {
    padded([b"RIFF".as_slice(), &[36, 0, 0, 0], b"WAVE", b"fmt "].concat())
}

fn avi() -> Vec<u8> {
    padded([b"RIFF".as_slice(), &[36, 0, 0, 0], b"AVI ", b"LIST"].concat())
}

fn flac() -> Vec<u8> {
    padded([b"fLaC".as_slice(), &[0, 0, 0, 34]].concat())
}

fn ogg(codec: &[u8]) -> Vec<u8> {
    let mut page = b"OggS".to_vec();
    page.extend([0, 2]);
    page.resize(26, 0);
    page.extend([1, 30]);
    page.extend(codec);
    padded(page)
}

fn ftyp(brand: &[u8; 4]) -> Vec<u8> {
    padded([&[0, 0, 0, 24][..], b"ftyp", brand, &[0; 4], brand].concat())
}

fn ebml(doc_type: &[u8]) -> Vec<u8> {
    padded([&[0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x82][..], doc_type].concat())
}

fn crc32(bytes: &[u8]) -> u32 {
    !bytes.iter().fold(u32::MAX, |crc, byte| {
        (0..8).fold(crc ^ u32::from(*byte), |value, _| {
            (value >> 1) ^ (0xEDB8_8320 & (value & 1).wrapping_neg())
        })
    })
}

fn seven_zip() -> Vec<u8> {
    let mut bytes = SEVEN_ZIP_SIGNATURE.to_vec();
    bytes.extend([0, 4, 0, 0, 0, 0]);
    bytes.extend(vec![1; SEVEN_ZIP_START_HEADER_LEN]);
    let crc = crc32(&bytes[12..32]);
    set_u32(&mut bytes, 8, crc);
    bytes
}

fn assert_media(bytes: &[u8], extension: Option<&str>, kind: ProbeKind, mime: &str) {
    let found = sniff(bytes, extension);
    assert_eq!((found.kind, found.mime), (kind, mime), "{extension:?}");
}

#[test]
fn random_bytes_named_mp3_are_not_audio() {
    let noise: Vec<u8> = (0..SCAN_WINDOW)
        .map(|n| (n * 131 + 7) as u8 | 0x80)
        .collect();
    assert!(rejected(&noise, Some("mp3")));
    assert!(rejected(&[0xFF, 0xFB], Some("mp3")));
}

#[test]
fn an_mpeg_frame_header_needs_a_coherent_header_and_an_mpeg_extension() {
    assert!(rejected(&MP3_HEADER, Some("txt")));
    assert!(rejected(&MP3_HEADER, None));
    for broken in [
        [0xFF, 0xF9, 0x90, 0x00],
        [0xFF, 0xF1, 0x90, 0x00],
        [0xFF, 0xFB, 0xF0, 0x00],
        [0xFF, 0xFB, 0x00, 0x00],
        [0xFF, 0xFB, 0x9C, 0x00],
        [0xFF, 0xE0, 0x00, 0x00],
    ] {
        assert!(rejected(&broken, Some("mp3")), "{broken:?}");
    }
}

#[test]
fn an_id3_tag_with_impossible_fields_is_not_audio() {
    let mut version = id3();
    version[3] = 9;
    let mut revision = id3();
    revision[4] = 0xFF;
    let mut size = id3();
    size[7] = 0x80;
    for bytes in [
        version,
        revision,
        size,
        b"ID3".to_vec(),
        b"ID3\x04\x00".to_vec(),
    ] {
        assert!(rejected(&bytes, Some("mp3")));
    }
}

#[test]
fn riff_files_without_their_form_and_first_chunk_are_not_media() {
    let mut no_format = wave();
    no_format[12..16].copy_from_slice(b"data");
    let mut no_list = avi();
    no_list[12..16].copy_from_slice(b"junk");
    let mut other_form = wave();
    other_form[8..12].copy_from_slice(b"ACON");
    for bytes in [
        no_format,
        no_list,
        other_form,
        b"RIFF".to_vec(),
        b"RIFF\x00\x00\x00\x00WAVE".to_vec(),
    ] {
        assert!(rejected(&bytes, Some("wav")));
    }
}

#[test]
fn flac_needs_a_streaminfo_block_of_the_right_length() {
    let mut wrong_type = flac();
    wrong_type[4] = 3;
    let mut wrong_length = flac();
    wrong_length[7] = 35;
    for bytes in [wrong_type, wrong_length, b"fLaC".to_vec()] {
        assert!(rejected(&bytes, Some("flac")));
    }
}

#[test]
fn ogg_needs_a_coherent_page_and_a_known_codec() {
    let mut version = ogg(b"\x01vorbis");
    version[4] = 1;
    let mut flags = ogg(b"\x01vorbis");
    flags[5] = 0x80;
    let mut no_segments = ogg(b"\x01vorbis");
    no_segments[26] = 0;
    for bytes in [
        ogg(b"desconocido"),
        version,
        flags,
        no_segments,
        b"OggS".to_vec(),
    ] {
        assert!(rejected(&bytes, Some("ogg")));
    }
}

#[test]
fn an_ogg_page_with_no_segment_table_is_rejected_even_if_a_codec_follows() {
    let mut page = b"OggS".to_vec();
    page.extend([0, 2]);
    page.resize(26, 0);
    page.extend([0]);
    page.extend(b"\x01vorbis");
    assert!(rejected(&padded(page), Some("ogg")));
}

#[test]
fn an_mp4_box_needs_a_media_brand_and_a_sane_size() {
    for brand in [b"heic", b"mif1", b"avif", b"heix", b"zzzz"] {
        assert!(rejected(&ftyp(brand), Some("mp4")), "{brand:?}");
    }
    let mut tiny = ftyp(b"isom");
    tiny[3] = 8;
    assert!(rejected(&tiny, Some("mp4")));
    assert!(rejected(b"\x00\x00\x00\x18ftyp", Some("mp4")));
}

#[test]
fn an_mp4_box_of_exactly_the_minimum_size_is_accepted() {
    let mut minimal = ftyp(b"isom");
    minimal[3] = 16;
    assert_eq!(kind_of(&minimal, Some("mp4")), ProbeKind::Video);
}

#[test]
fn an_ebml_header_without_a_known_doc_type_is_not_media() {
    assert!(rejected(&ebml(b"\x84abcd"), Some("webm")));
    assert!(rejected(&[0x1A, 0x45, 0xDF, 0xA3], Some("mkv")));
}

#[test]
fn an_archive_signature_with_incoherent_fields_is_not_an_archive() {
    let mut bad_crc = seven_zip();
    bad_crc[8] ^= 0xFF;
    let mut bad_major = seven_zip();
    bad_major[6] = 1;
    let truncated = seven_zip()[..20].to_vec();
    for bytes in [bad_crc, bad_major, truncated, SEVEN_ZIP_SIGNATURE.to_vec()] {
        assert!(rejected(&bytes, Some("7z")));
    }
    for bytes in [
        &b"Rar!\x1A\x07"[..],
        b"Rar!\x1A\x07\x02",
        b"Rar!",
        b"Rar!\x1A\x07\x01",
    ] {
        assert!(rejected(bytes, Some("rar")));
    }
}

#[test]
fn a_tar_header_needs_its_checksum_magic_and_a_full_block() {
    let mut bad_sum = tar_block("a.txt");
    bad_sum[TAR_CHECKSUM_AT] = b'7';
    let mut no_magic = tar_block("a.txt");
    no_magic[257..262].copy_from_slice(b"xxxxx");
    let mut no_name = tar_block("a.txt");
    no_name[0] = 0;
    let short = tar_block("a.txt")[..511].to_vec();
    for bytes in [
        bad_sum,
        no_magic,
        no_name,
        short,
        vec![0; 300],
        b"ustar".to_vec(),
    ] {
        assert!(rejected(&bytes, Some("tar")));
    }
}

#[test]
fn signatures_in_files_shorter_than_their_offset_never_panic() {
    for length in 0..=272 {
        let mut bytes = vec![0u8; length];
        for (at, value) in b"ustar".iter().enumerate().take(length.saturating_sub(257)) {
            bytes[257 + at] = *value;
        }
        let found = kind_of(&bytes, Some("tar"));
        assert!(
            matches!(found, ProbeKind::Binary | ProbeKind::Text),
            "{length}: {found:?}"
        );
    }
}

#[test]
fn bm_and_mz_stubs_are_never_media() {
    for bytes in [
        &b"BM"[..],
        b"MZ",
        b"MZ\x90\x00\x03\x00\x00\x00",
        b"BM\x00\x00\x00\x00",
    ] {
        let found = kind_of(bytes, Some("mp3"));
        assert!(
            matches!(found, ProbeKind::Binary | ProbeKind::Text),
            "{bytes:?}"
        );
    }
}

#[test]
fn every_audio_signature_is_recognised_with_its_mime() {
    assert_media(&id3(), None, ProbeKind::Audio, "audio/mpeg");
    assert_media(&MP3_HEADER, Some("mp3"), ProbeKind::Audio, "audio/mpeg");
    assert_media(&wave(), None, ProbeKind::Audio, "audio/wav");
    assert_media(&flac(), None, ProbeKind::Audio, "audio/flac");
    assert_media(&ogg(b"\x01vorbis"), None, ProbeKind::Audio, "audio/ogg");
    assert_media(&ogg(b"OpusHead"), None, ProbeKind::Audio, "audio/ogg");
    assert_media(&ogg(b"\x7fFLAC"), None, ProbeKind::Audio, "audio/ogg");
    assert_media(&ftyp(b"M4A "), None, ProbeKind::Audio, "audio/mp4");
}

#[test]
fn every_video_signature_is_recognised_with_its_mime() {
    assert_media(&avi(), None, ProbeKind::Video, "video/x-msvideo");
    assert_media(&ogg(b"\x80theora"), None, ProbeKind::Video, "video/ogg");
    assert_media(&ftyp(b"isom"), Some("mp4"), ProbeKind::Video, "video/mp4");
    assert_media(&ftyp(b"mp42"), None, ProbeKind::Video, "video/mp4");
    assert_media(
        &ftyp(b"qt  "),
        Some("mov"),
        ProbeKind::Video,
        "video/quicktime",
    );
    assert_media(
        &ebml(b"\x84webm"),
        Some("webm"),
        ProbeKind::Video,
        "video/webm",
    );
    assert_media(
        &ebml(b"\x88matroska"),
        Some("mkv"),
        ProbeKind::Video,
        "video/x-matroska",
    );
}

#[test]
fn the_extension_decides_audio_or_video_only_where_the_container_is_shared() {
    assert_media(&ftyp(b"isom"), Some("m4a"), ProbeKind::Audio, "audio/mp4");
    assert_media(&ftyp(b"isom"), Some("m4b"), ProbeKind::Audio, "audio/mp4");
    assert_media(
        &ebml(b"\x84webm"),
        Some("weba"),
        ProbeKind::Audio,
        "audio/webm",
    );
    assert_media(
        &ebml(b"\x88matroska"),
        Some("mka"),
        ProbeKind::Audio,
        "audio/x-matroska",
    );
}

#[test]
fn archive_signatures_are_recognised_with_their_mime() {
    assert_media(
        &seven_zip(),
        Some("7z"),
        ProbeKind::Archive,
        "application/x-7z-compressed",
    );
    assert_media(
        &padded(b"Rar!\x1A\x07\x00".to_vec()),
        None,
        ProbeKind::Archive,
        "application/vnd.rar",
    );
    assert_media(
        &padded(b"Rar!\x1A\x07\x01\x00".to_vec()),
        None,
        ProbeKind::Archive,
        "application/vnd.rar",
    );
    assert_media(
        &tar_block("a.txt"),
        None,
        ProbeKind::Archive,
        "application/x-tar",
    );
}

#[test]
fn text_that_merely_starts_like_a_signature_stays_text() {
    for text in [
        "ID3 tags are fun",
        "RIFF is a format",
        "OggS is a capture pattern",
        "Rar! hola",
    ] {
        assert_eq!(
            kind_of(text.as_bytes(), Some("txt")),
            ProbeKind::Text,
            "{text}"
        );
    }
}

fn ebml_with_doc_type_ending_at(end: usize) -> Vec<u8> {
    let mut bytes = vec![0x1A, 0x45, 0xDF, 0xA3, 0x9F];
    let needle = [0x42, 0x82, 0x84, b'w', b'e', b'b', b'm'];
    bytes.resize(end - needle.len(), 0);
    bytes.extend(needle);
    padded(bytes)
}

#[test]
fn the_ebml_doc_type_must_end_inside_the_first_64_bytes() {
    assert_eq!(
        kind_of(&ebml_with_doc_type_ending_at(64), Some("webm")),
        ProbeKind::Video
    );
    assert!(rejected(&ebml_with_doc_type_ending_at(65), Some("webm")));
}

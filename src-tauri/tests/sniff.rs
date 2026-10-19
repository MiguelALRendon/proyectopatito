use dakedaduck_svn_lib::app::sniff::{ProbeKind, SNIFF_BYTES, Sample, Sniffed, classify};

const MIME_BINARY: &str = "application/octet-stream";
const MIME_TEXT: &str = "text/plain";
const MIME_SVG: &str = "image/svg+xml";

fn classify_complete(bytes: &[u8]) -> Sniffed {
    classify(Sample {
        bytes,
        truncated: false,
        extension: None,
    })
}

fn classify_cut(bytes: &[u8]) -> Sniffed {
    classify(Sample {
        bytes,
        truncated: true,
        extension: None,
    })
}

fn kind_of(bytes: &[u8]) -> ProbeKind {
    classify_complete(bytes).kind
}

fn padded(mut bytes: Vec<u8>, total: usize) -> Vec<u8> {
    bytes.resize(total, 0);
    bytes
}

fn png() -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&1u32.to_be_bytes());
    bytes.extend_from_slice(&1u32.to_be_bytes());
    padded(bytes, 40)
}

fn jpeg() -> Vec<u8> {
    padded(vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10], 32)
}

fn gif() -> Vec<u8> {
    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    padded(bytes, 32)
}

fn webp() -> Vec<u8> {
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&30u32.to_le_bytes());
    bytes.extend_from_slice(b"WEBPVP8X");
    padded(bytes, 40)
}

fn bmp() -> Vec<u8> {
    let mut bytes = b"BM".to_vec();
    bytes.extend_from_slice(&66u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&54u32.to_le_bytes());
    bytes.extend_from_slice(&40u32.to_le_bytes());
    padded(bytes, 66)
}

fn ico() -> Vec<u8> {
    let mut bytes = vec![0, 0, 1, 0];
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&[16, 16, 0, 0]);
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&32u16.to_le_bytes());
    bytes.extend_from_slice(&100u32.to_le_bytes());
    bytes.extend_from_slice(&22u32.to_le_bytes());
    padded(bytes, 64)
}

fn utf16(text: &str, bom: [u8; 2], encode: fn(u16) -> [u8; 2]) -> Vec<u8> {
    let mut bytes = bom.to_vec();
    bytes.extend(text.encode_utf16().flat_map(encode));
    bytes
}

#[test]
fn a_binary_with_a_nul_is_never_text() {
    let sniffed = classify_complete(b"MZ\x90\x00\x03\x00\x00\x00");
    assert_eq!(sniffed.kind, ProbeKind::Binary);
    assert_eq!(sniffed.mime, MIME_BINARY);
    assert_eq!(sniffed.extension, None);
}

#[test]
fn bytes_that_are_not_valid_utf8_are_binary_even_without_nul() {
    assert_eq!(
        kind_of(&[b'h', 0xFF, 0xFE, b'i', 0xC0, 0x80]),
        ProbeKind::Binary
    );
    assert_eq!(kind_of(&[0xC3]), ProbeKind::Binary);
}

#[test]
fn the_bm_signature_alone_is_not_a_bitmap() {
    assert_eq!(classify_complete(b"BM").kind, ProbeKind::Text);
    assert_eq!(
        classify_complete(b"BM is not a bitmap").kind,
        ProbeKind::Text
    );
    assert_eq!(kind_of(&padded(b"BM".to_vec(), 64)), ProbeKind::Binary);
}

#[test]
fn a_bitmap_with_incoherent_header_fields_is_not_an_image() {
    let mut offset_beyond_size = bmp();
    offset_beyond_size[2..6].copy_from_slice(&20u32.to_le_bytes());
    let mut offset_inside_header = bmp();
    offset_inside_header[10..14].copy_from_slice(&20u32.to_le_bytes());
    let mut unknown_dib = bmp();
    unknown_dib[14..18].copy_from_slice(&41u32.to_le_bytes());
    let mut dirty_reserved = bmp();
    dirty_reserved[6..10].copy_from_slice(&1u32.to_le_bytes());
    for forged in [
        offset_beyond_size,
        offset_inside_header,
        unknown_dib,
        dirty_reserved,
    ] {
        assert_eq!(kind_of(&forged), ProbeKind::Binary);
    }
}

#[test]
fn the_ico_signature_alone_is_not_an_icon() {
    assert_eq!(kind_of(&[0, 0, 1, 0]), ProbeKind::Binary);
    assert_eq!(kind_of(&padded(vec![0, 0, 1, 0], 64)), ProbeKind::Binary);
    let mut many_images = ico();
    many_images[4..6].copy_from_slice(&u16::MAX.to_le_bytes());
    assert_eq!(kind_of(&many_images), ProbeKind::Binary);
    let mut offset_inside_directory = ico();
    offset_inside_directory[18..22].copy_from_slice(&2u32.to_le_bytes());
    assert_eq!(kind_of(&offset_inside_directory), ProbeKind::Binary);
    let mut empty_image = ico();
    empty_image[14..18].copy_from_slice(&0u32.to_le_bytes());
    assert_eq!(kind_of(&empty_image), ProbeKind::Binary);
}

#[test]
fn image_signatures_without_a_coherent_header_are_not_images() {
    assert_eq!(
        kind_of(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        ProbeKind::Binary
    );
    assert_eq!(kind_of(&[0xFF, 0xD8, 0xFF, 0x00, 0x01]), ProbeKind::Binary);
    assert_eq!(kind_of(b"RIFF\x00\x00\x00\x00WEBP"), ProbeKind::Binary);
    assert_eq!(kind_of(&padded(b"GIF89a".to_vec(), 32)), ProbeKind::Binary);
    assert_eq!(classify_complete(b"GIF89a").kind, ProbeKind::Text);
}

fn patched(mut bytes: Vec<u8>, at: usize, patch: &[u8]) -> Vec<u8> {
    bytes[at..at + patch.len()].copy_from_slice(patch);
    bytes
}

#[test]
fn a_png_header_that_breaks_one_rule_is_binary() {
    let forged = [
        ("chunk length 12", patched(png(), 8, &12u32.to_be_bytes())),
        ("chunk length 14", patched(png(), 8, &14u32.to_be_bytes())),
        ("first chunk is not IHDR", patched(png(), 12, b"IDAT")),
        ("zero width", patched(png(), 16, &0u32.to_be_bytes())),
        ("zero height", patched(png(), 20, &0u32.to_be_bytes())),
    ];
    for (rule, bytes) in forged {
        assert_eq!(kind_of(&bytes), ProbeKind::Binary, "{rule}");
    }
}

#[test]
fn a_gif_header_that_breaks_one_rule_is_binary() {
    let forged = [
        ("zero width", patched(gif(), 6, &0u16.to_le_bytes())),
        ("zero height", patched(gif(), 8, &0u16.to_le_bytes())),
    ];
    for (rule, bytes) in forged {
        assert_eq!(kind_of(&bytes), ProbeKind::Binary, "{rule}");
    }
}

#[test]
fn a_webp_header_that_breaks_one_rule_is_binary() {
    let forged = [
        ("riff size 11", patched(webp(), 4, &11u32.to_le_bytes())),
        ("unknown chunk", patched(webp(), 12, b"VP8Z")),
        ("not a webp form", patched(webp(), 8, b"WEBX")),
    ];
    for (rule, bytes) in forged {
        assert_eq!(kind_of(&bytes), ProbeKind::Binary, "{rule}");
    }
}

#[test]
fn the_smallest_riff_size_and_every_webp_chunk_type_are_images() {
    let smallest = patched(webp(), 4, &12u32.to_le_bytes());
    assert_eq!(kind_of(&smallest), ProbeKind::Image);
    for chunk in [b"VP8 ", b"VP8L", b"VP8X"] {
        assert_eq!(kind_of(&patched(webp(), 12, chunk)), ProbeKind::Image);
    }
}

#[test]
fn an_icon_entry_that_breaks_one_rule_is_binary() {
    let forged = [
        ("reserved byte set", patched(ico(), 9, &[1])),
        ("two planes", patched(ico(), 10, &2u16.to_le_bytes())),
        ("bit depth 2", patched(ico(), 12, &2u16.to_le_bytes())),
        ("bit depth 33", patched(ico(), 12, &33u16.to_le_bytes())),
    ];
    for (rule, bytes) in forged {
        assert_eq!(kind_of(&bytes), ProbeKind::Binary, "{rule}");
    }
}

#[test]
fn an_icon_entry_with_zero_planes_or_a_listed_bit_depth_is_an_image() {
    assert_eq!(
        kind_of(&patched(ico(), 10, &0u16.to_le_bytes())),
        ProbeKind::Image
    );
    for depth in [0u16, 1, 4, 8, 16, 24, 32] {
        let bytes = patched(ico(), 12, &depth.to_le_bytes());
        assert_eq!(kind_of(&bytes), ProbeKind::Image, "{depth}");
    }
}

#[test]
fn the_first_icon_image_must_start_exactly_after_the_whole_entry_table() {
    let two_entries = patched(ico(), 4, &2u16.to_le_bytes());
    let table_end = 6 + 16 * 2;
    let at_end = patched(two_entries.clone(), 18, &(table_end as u32).to_le_bytes());
    let inside_table = patched(two_entries, 18, &(table_end as u32 - 1).to_le_bytes());
    assert_eq!(kind_of(&at_end), ProbeKind::Image);
    assert_eq!(kind_of(&inside_table), ProbeKind::Binary);
}

#[test]
fn a_larger_icon_directory_moves_the_earliest_valid_image_offset() {
    let table_end = 6 + 16 * 256;
    let count = patched(ico(), 4, &256u16.to_le_bytes());
    let at_end = patched(count.clone(), 18, &(table_end as u32).to_le_bytes());
    let inside_table = patched(count, 18, &(table_end as u32 - 1).to_le_bytes());
    assert_eq!(kind_of(&at_end), ProbeKind::Image);
    assert_eq!(kind_of(&inside_table), ProbeKind::Binary);
}

#[test]
fn a_pdf_needs_its_version_after_the_signature() {
    assert_eq!(classify_complete(b"%PDF-").kind, ProbeKind::Text);
    assert_eq!(
        classify_complete(b"%PDF- no es un pdf").kind,
        ProbeKind::Text
    );
    assert_eq!(classify_complete(b"%PDF").kind, ProbeKind::Text);
}

#[test]
fn utf16_without_a_bom_is_not_text() {
    let without_bom: Vec<u8> = "hola".encode_utf16().flat_map(u16::to_le_bytes).collect();
    assert_eq!(kind_of(&without_bom), ProbeKind::Binary);
}

#[test]
fn a_utf16_bom_followed_by_garbage_is_binary() {
    let lone_surrogate = [0xFF, 0xFE, 0x00, 0xD8, 0x41, 0x00];
    assert_eq!(kind_of(&lone_surrogate), ProbeKind::Binary);
    let odd_length = [0xFF, 0xFE, 0x41, 0x00, 0x42];
    assert_eq!(kind_of(&odd_length), ProbeKind::Binary);
    let utf32_little_endian = [0xFF, 0xFE, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00];
    assert_eq!(kind_of(&utf32_little_endian), ProbeKind::Binary);
}

#[test]
fn svg_is_recognised_only_when_svg_is_the_root_element() {
    let prolog =
        b"\xEF\xBB\xBF<?xml version=\"1.0\"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg xmlns=\"x\"/>";
    let sniffed = classify_complete(prolog);
    assert_eq!((sniffed.kind, sniffed.mime), (ProbeKind::Image, MIME_SVG));
    assert_eq!(sniffed.extension, Some("svg"));
    assert_eq!(kind_of(b"<svg>"), ProbeKind::Image);
    assert_eq!(
        kind_of(b"<html><body><svg></svg></body></html>"),
        ProbeKind::Text
    );
    assert_eq!(kind_of(b"<svgfoo>"), ProbeKind::Text);
    assert_eq!(kind_of(b"<svg"), ProbeKind::Text);
    assert_eq!(kind_of(b"<!-- <svg> sin cerrar"), ProbeKind::Text);
}

#[test]
fn a_buffer_cut_in_the_middle_of_a_utf8_character_is_still_text() {
    let mut bytes = vec![b'a'; SNIFF_BYTES - 1];
    bytes.extend_from_slice("é".as_bytes());
    let cut = &bytes[..SNIFF_BYTES];
    assert_eq!(classify_cut(cut).kind, ProbeKind::Text);
    assert_eq!(classify_complete(cut).kind, ProbeKind::Binary);
}

#[test]
fn a_buffer_cut_in_the_middle_of_a_utf16_surrogate_pair_is_still_text() {
    let bytes = utf16("a😀", [0xFF, 0xFE], u16::to_le_bytes);
    let cut = &bytes[..bytes.len() - 2];
    assert_eq!(classify_cut(cut).kind, ProbeKind::Text);
    assert_eq!(classify_complete(cut).kind, ProbeKind::Binary);
    let odd_cut = &bytes[..bytes.len() - 1];
    assert_eq!(classify_cut(odd_cut).kind, ProbeKind::Text);
}

#[test]
fn the_sample_window_is_eight_kibibytes() {
    assert_eq!(SNIFF_BYTES, 8192);
}

#[test]
fn an_empty_buffer_is_empty_text() {
    let sniffed = classify_complete(&[]);
    assert_eq!((sniffed.kind, sniffed.mime), (ProbeKind::Text, MIME_TEXT));
}

#[test]
fn coherent_image_headers_are_images_with_their_mime_and_extension() {
    let cases = [
        (png(), "image/png", "png"),
        (jpeg(), "image/jpeg", "jpg"),
        (gif(), "image/gif", "gif"),
        (webp(), "image/webp", "webp"),
        (bmp(), "image/bmp", "bmp"),
        (ico(), "image/x-icon", "ico"),
    ];
    for (bytes, mime, extension) in cases {
        let sniffed = classify_complete(&bytes);
        assert_eq!(sniffed.kind, ProbeKind::Image, "{mime}");
        assert_eq!((sniffed.mime, sniffed.extension), (mime, Some(extension)));
    }
}

#[test]
fn a_pdf_with_its_version_is_a_pdf() {
    let sniffed = classify_complete(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj");
    assert_eq!(
        (sniffed.kind, sniffed.mime),
        (ProbeKind::Pdf, "application/pdf")
    );
    assert_eq!(sniffed.extension, Some("pdf"));
}

#[test]
fn plain_text_in_utf8_and_utf16_is_text() {
    assert_eq!(kind_of("línea ñandú\r\n".as_bytes()), ProbeKind::Text);
    assert_eq!(kind_of(b"\xEF\xBB\xBFcon bom"), ProbeKind::Text);
    let little_endian = utf16("hola 😀\r\n", [0xFF, 0xFE], u16::to_le_bytes);
    let big_endian = utf16("hola 😀\r\n", [0xFE, 0xFF], u16::to_be_bytes);
    assert_eq!(kind_of(&little_endian), ProbeKind::Text);
    assert_eq!(kind_of(&big_endian), ProbeKind::Text);
    assert_eq!(classify_complete(b"texto").mime, MIME_TEXT);
}

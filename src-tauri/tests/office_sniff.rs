#![cfg(windows)]

mod common;

use std::fs;
use std::path::Path;

use common::containers::{
    MIME_ODP, MIME_ODS, MIME_ODT, bzip2, docx, end_record, gzip, odf, ole2, pptx, set_u16, set_u32,
    tar_archive, xlsx, xz, zip,
};
use dakedaduck_svn_lib::app::files::{FileFacts, FileProbe, probe_facts};
use dakedaduck_svn_lib::app::sniff::ProbeKind;
use tempfile::TempDir;

const MIME_DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PPTX: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MIME_BINARY: &str = "application/octet-stream";
const WORD_STREAM: &str = "WordDocument";
const EXCEL_STREAM: &str = "Workbook";
const POWERPOINT_STREAM: &str = "PowerPoint Document";
const MANY_ENTRIES: usize = 300;
const MAX_U16_ENTRIES: u16 = u16::MAX;
const HUGE_DIFAT_SECTORS: u32 = 5000;
const OLE2_FIRST_DIRECTORY_AT: usize = 0x30;
const OLE2_DIFAT_COUNT_AT: usize = 0x48;
const OLE2_MAJOR_AT: usize = 0x1A;
const OLE2_FAT_SECTOR_AT: usize = 512;
const NOISE_BYTES: usize = 300_000;
const GZIP_FLAGS_AT: usize = 3;
const GZIP_HEADER_LEN: usize = 10;
const GZIP_FEXTRA: u8 = 4;
const GZIP_EXTRA_BYTES: usize = 20_000;

fn noise(len: usize) -> Vec<u8> {
    let mut state = 0x2545_F491_4F6C_DD1Du64;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 24) as u8
        })
        .collect()
}

fn probe_named(name: &str, bytes: &[u8]) -> FileProbe {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join(name);
    fs::write(&path, bytes).unwrap();
    probe_at(&path, bytes.len() as u64)
}

fn probe_at(path: &Path, len: u64) -> FileProbe {
    let facts = FileFacts { len, attributes: 0 };
    probe_facts(path, facts, false).unwrap()
}

fn kind_of(name: &str, bytes: &[u8]) -> ProbeKind {
    probe_named(name, bytes).kind
}

fn office(name: &str, bytes: &[u8]) -> FileProbe {
    let probe = probe_named(name, bytes);
    assert_eq!(probe.kind, ProbeKind::Office, "{name}");
    probe
}

#[test]
fn a_zip_without_content_types_named_docx_is_not_office() {
    let bytes = zip(&[("word/document.xml", b"<x/>")]);
    assert_eq!(kind_of("a.docx", &bytes), ProbeKind::Binary);
}

#[test]
fn a_plain_zip_renamed_to_every_office_extension_stays_binary() {
    let bytes = zip(&[("leeme.txt", b"hola"), ("datos/a.bin", b"\x00\x01")]);
    for name in ["a.docx", "a.xlsx", "a.pptx", "a.odt", "a.ods", "a.odp"] {
        assert_eq!(kind_of(name, &bytes), ProbeKind::Binary, "{name}");
    }
}

#[test]
fn content_types_without_the_parts_of_the_format_is_not_office() {
    let bytes = zip(&[
        ("[Content_Types].xml", b"<Types/>"),
        ("otra/cosa.xml", b"<x/>"),
    ]);
    assert_eq!(kind_of("a.docx", &bytes), ProbeKind::Binary);
}

#[test]
fn an_office_container_under_the_wrong_extension_is_not_trusted() {
    assert_eq!(kind_of("a.docx", &xlsx(&[])), ProbeKind::Binary);
    assert_eq!(kind_of("a.xlsx", &pptx(&[])), ProbeKind::Binary);
    assert_eq!(kind_of("a.pptx", &docx(&[])), ProbeKind::Binary);
    assert_eq!(kind_of("a.ods", &odf(MIME_ODT, &[])), ProbeKind::Binary);
    assert_eq!(kind_of("a.odt", &odf(MIME_ODP, &[])), ProbeKind::Binary);
    assert_eq!(kind_of("a.docx", &odf(MIME_ODT, &[])), ProbeKind::Binary);
}

#[test]
fn an_odf_whose_mimetype_is_not_the_first_stored_value_is_not_office() {
    let bytes = zip(&[("content.xml", b"<x/>")]);
    assert_eq!(kind_of("a.odt", &bytes), ProbeKind::Binary);
    let garbled = odf("texto cualquiera", &[]);
    assert_eq!(kind_of("a.odt", &garbled), ProbeKind::Binary);
}

#[test]
fn a_text_file_named_docx_is_text_and_never_office() {
    assert_eq!(
        kind_of("a.docx", b"hola, esto no es un docx"),
        ProbeKind::Text
    );
}

#[test]
fn an_ole2_of_another_family_named_doc_is_not_office() {
    assert_eq!(kind_of("a.doc", &ole2(&[EXCEL_STREAM])), ProbeKind::Binary);
    assert_eq!(kind_of("a.xls", &ole2(&[WORD_STREAM])), ProbeKind::Binary);
    assert_eq!(kind_of("a.ppt", &ole2(&[EXCEL_STREAM])), ProbeKind::Binary);
}

#[test]
fn an_msi_or_msg_style_ole2_renamed_to_doc_is_not_office() {
    let msi = ole2(&["\u{5}SummaryInformation", "Binary.Icon", "Property"]);
    let msg = ole2(&["__properties_version1.0", "__substg1.0_0037001F"]);
    for name in ["a.doc", "a.xls", "a.ppt"] {
        assert_eq!(kind_of(name, &msi), ProbeKind::Binary, "{name}");
        assert_eq!(kind_of(name, &msg), ProbeKind::Binary, "{name}");
    }
}

#[test]
fn the_marker_only_in_the_last_name_of_a_long_directory_is_still_found() {
    let names: Vec<String> = (0..MANY_ENTRIES)
        .map(|index| format!("relleno/{index}.bin"))
        .collect();
    let mut entries: Vec<(&str, &[u8])> = names
        .iter()
        .map(|name| (name.as_str(), b"x" as &[u8]))
        .collect();
    entries.push(("word/document.xml", b"<x/>"));
    entries.push(("[Content_Types].xml", b"<Types/>"));
    let probe = office("a.docx", &zip(&entries));
    assert_eq!(probe.mime, MIME_DOCX);
}

#[test]
fn a_loose_gz_xz_or_bz2_is_binary_even_when_it_holds_a_tar() {
    let tar = tar_archive("a.txt", b"hola");
    assert_eq!(kind_of("suelto.gz", &gzip(&tar)), ProbeKind::Binary);
    assert_eq!(kind_of("suelto.xz", &xz(&tar)), ProbeKind::Binary);
    assert_eq!(kind_of("suelto.bz2", &bzip2(&tar)), ProbeKind::Binary);
}

#[test]
fn a_tar_extension_over_a_stream_that_is_not_a_tar_is_binary() {
    let not_a_tar = vec![b'z'; 2048];
    assert_eq!(kind_of("a.tar.gz", &gzip(&not_a_tar)), ProbeKind::Binary);
    assert_eq!(kind_of("a.tgz", &gzip(&not_a_tar)), ProbeKind::Binary);
    assert_eq!(kind_of("a.tar.bz2", &bzip2(&not_a_tar)), ProbeKind::Binary);
    assert_eq!(kind_of("a.tar.xz", &xz(&not_a_tar)), ProbeKind::Binary);
}

#[test]
fn a_tar_extension_over_bytes_that_are_not_even_compressed_is_binary() {
    for name in [
        "a.tar.gz",
        "a.tgz",
        "a.tar.bz2",
        "a.tbz2",
        "a.tar.xz",
        "a.txz",
    ] {
        assert_eq!(kind_of(name, &[0x00; 64]), ProbeKind::Binary, "{name}");
        assert_eq!(kind_of(name, b"texto plano"), ProbeKind::Text, "{name}");
    }
}

#[test]
fn truncated_containers_never_panic_and_are_not_office() {
    let good = docx(&[]);
    for cut in [0, 3, 30, good.len() / 2, good.len() - 10, good.len() - 1] {
        assert_ne!(
            kind_of("a.docx", &good[..cut]),
            ProbeKind::Office,
            "corte {cut}"
        );
    }
    let good = ole2(&[WORD_STREAM]);
    for cut in [0, 8, 200, 512, 700, good.len() - 1] {
        assert_ne!(
            kind_of("a.doc", &good[..cut]),
            ProbeKind::Office,
            "corte {cut}"
        );
    }
}

#[test]
fn a_signature_alone_without_a_directory_is_not_office() {
    assert_ne!(kind_of("a.docx", b"PK\x03\x04"), ProbeKind::Office);
    assert_eq!(
        kind_of("a.doc", &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
        ProbeKind::Binary
    );
}

#[test]
fn hostile_zip_end_records_are_refused_without_reading_beyond_the_file() {
    let good = docx(&[]);
    let at = good.len() - 22;
    let mut zip64 = good.clone();
    set_u16(&mut zip64, at + 10, MAX_U16_ENTRIES);
    assert_eq!(kind_of("a.docx", &zip64), ProbeKind::Binary);
    let mut beyond = good.clone();
    set_u32(&mut beyond, at + 16, u32::MAX - 1);
    assert_eq!(kind_of("a.docx", &beyond), ProbeKind::Binary);
    let mut too_many = good.clone();
    set_u16(&mut too_many, at + 10, 3);
    assert_eq!(kind_of("a.docx", &too_many), ProbeKind::Binary);
    let mut huge_directory = good;
    set_u32(&mut huge_directory, at + 12, u32::MAX - 1);
    assert_eq!(kind_of("a.docx", &huge_directory), ProbeKind::Binary);
}

#[test]
fn an_end_record_whose_comment_length_lies_is_ignored() {
    let mut bytes = docx(&[]);
    let at = bytes.len() - 2;
    set_u16(&mut bytes, at, 40);
    assert_eq!(kind_of("a.docx", &bytes), ProbeKind::Binary);
    let orphan = end_record(0, 0, 0);
    assert_eq!(kind_of("a.docx", &orphan), ProbeKind::Binary);
}

#[test]
fn hostile_ole2_headers_are_refused() {
    let good = ole2(&[WORD_STREAM]);
    let mut difat = good.clone();
    set_u32(&mut difat, OLE2_DIFAT_COUNT_AT, HUGE_DIFAT_SECTORS);
    assert_eq!(kind_of("a.doc", &difat), ProbeKind::Binary);
    let mut shift = good.clone();
    set_u16(&mut shift, OLE2_MAJOR_AT, 4);
    assert_eq!(kind_of("a.doc", &shift), ProbeKind::Binary);
    let mut far = good.clone();
    set_u32(&mut far, OLE2_FIRST_DIRECTORY_AT, 900_000);
    assert_eq!(kind_of("a.doc", &far), ProbeKind::Binary);
    let mut order = good;
    order[0x1C] = 0;
    assert_eq!(kind_of("a.doc", &order), ProbeKind::Binary);
}

#[test]
fn an_ole2_directory_chain_that_loops_ends_instead_of_hanging() {
    let mut looping = ole2(&[WORD_STREAM]);
    set_u32(&mut looping, OLE2_FAT_SECTOR_AT + 4, 1);
    assert_eq!(kind_of("a.doc", &looping), ProbeKind::Binary);
}

#[test]
fn every_office_format_is_recognised_with_its_mime_and_extension() {
    let cases: [(&str, Vec<u8>, &str); 9] = [
        ("a.docx", docx(&[]), MIME_DOCX),
        ("a.xlsx", xlsx(&[]), MIME_XLSX),
        ("a.pptx", pptx(&[]), MIME_PPTX),
        ("a.odt", odf(MIME_ODT, &[]), MIME_ODT),
        ("a.ods", odf(MIME_ODS, &[]), MIME_ODS),
        ("a.odp", odf(MIME_ODP, &[]), MIME_ODP),
        ("a.doc", ole2(&[WORD_STREAM]), "application/msword"),
        ("a.xls", ole2(&["Book"]), "application/vnd.ms-excel"),
        (
            "a.ppt",
            ole2(&[POWERPOINT_STREAM]),
            "application/vnd.ms-powerpoint",
        ),
    ];
    for (name, bytes, mime) in cases {
        let probe = office(name, &bytes);
        assert_eq!(probe.mime, mime, "{name}");
        assert_eq!(probe.extension, Some(&name[2..]), "{name}");
        assert!(!probe.has_macros, "{name}");
    }
}

#[test]
fn the_extension_is_matched_without_regard_to_case() {
    assert_eq!(office("INFORME.DOCX", &docx(&[])).mime, MIME_DOCX);
    assert_eq!(office("Hoja.Ods", &odf(MIME_ODS, &[])).mime, MIME_ODS);
}

#[test]
fn macros_are_reported_for_each_container_family() {
    assert!(office("a.docx", &docx(&[("word/vbaProject.bin", b"x")])).has_macros);
    assert!(office("a.xlsx", &xlsx(&[("xl/vbaProject.bin", b"x")])).has_macros);
    assert!(
        office(
            "a.odt",
            &odf(MIME_ODT, &[("Basic/Standard/Modulo1.xml", b"x")])
        )
        .has_macros
    );
    assert!(office("a.ods", &odf(MIME_ODS, &[("Scripts/python/a.py", b"x")])).has_macros);
    assert!(office("a.doc", &ole2(&[WORD_STREAM, "Macros"])).has_macros);
    assert!(office("a.xls", &ole2(&[EXCEL_STREAM, "_VBA_PROJECT_CUR"])).has_macros);
    assert!(office("a.ppt", &ole2(&[POWERPOINT_STREAM, "VBA"])).has_macros);
}

#[test]
fn documents_without_macros_report_none() {
    assert!(!office("a.docx", &docx(&[("word/media/a.png", b"x")])).has_macros);
    assert!(!office("a.odt", &odf(MIME_ODT, &[("Pictures/a.png", b"x")])).has_macros);
    assert!(!office("a.doc", &ole2(&[WORD_STREAM, "SummaryInformation"])).has_macros);
}

#[test]
fn a_zip_with_another_extension_is_an_archive_even_if_it_looks_like_office() {
    let plain = probe_named("datos.zip", &zip(&[("leeme.txt", b"hola")]));
    assert_eq!(plain.kind, ProbeKind::Archive);
    assert_eq!(plain.mime, "application/zip");
    assert_eq!(plain.extension, Some("zip"));
    assert_eq!(kind_of("informe.zip", &docx(&[])), ProbeKind::Archive);
    assert_eq!(kind_of("sin-extension", &docx(&[])), ProbeKind::Archive);
}

#[test]
fn a_zip_signature_without_a_central_directory_is_binary() {
    let mut bytes = zip(&[("a.txt", b"hola")]);
    bytes.truncate(bytes.len() - 22);
    assert_eq!(kind_of("roto.zip", &bytes), ProbeKind::Binary);
    assert_ne!(kind_of("corto.zip", b"PK\x03\x04"), ProbeKind::Archive);
}

#[test]
fn real_tarballs_are_archives_with_their_compound_extension() {
    let tar = tar_archive("a.txt", b"hola");
    let cases: [(&str, Vec<u8>, &str, &str); 6] = [
        ("a.tar.gz", gzip(&tar), "application/gzip", "tar.gz"),
        ("a.tgz", gzip(&tar), "application/gzip", "tar.gz"),
        ("a.tar.bz2", bzip2(&tar), "application/x-bzip2", "tar.bz2"),
        ("a.tbz2", bzip2(&tar), "application/x-bzip2", "tar.bz2"),
        ("a.tar.xz", xz(&tar), "application/x-xz", "tar.xz"),
        ("a.txz", xz(&tar), "application/x-xz", "tar.xz"),
    ];
    for (name, bytes, mime, extension) in cases {
        let probe = probe_named(name, &bytes);
        assert_eq!(probe.kind, ProbeKind::Archive, "{name}");
        assert_eq!(probe.mime, mime, "{name}");
        assert_eq!(probe.extension, Some(extension), "{name}");
    }
}

#[test]
fn a_binary_named_like_a_tarball_with_a_large_first_block_is_still_judged_by_its_stream() {
    let payload = tar_archive("grande.bin", &noise(NOISE_BYTES));
    assert_eq!(
        kind_of("grande.tar.bz2", &bzip2(&payload)),
        ProbeKind::Archive
    );
    assert_eq!(kind_of("grande.tar.xz", &xz(&payload)), ProbeKind::Archive);
}

#[test]
fn a_gzip_header_longer_than_a_few_kilobytes_is_still_read() {
    let compressed = gzip(&tar_archive("a.txt", b"hola"));
    let mut bytes = compressed[..GZIP_FLAGS_AT].to_vec();
    bytes.push(compressed[GZIP_FLAGS_AT] | GZIP_FEXTRA);
    bytes.extend(&compressed[GZIP_FLAGS_AT + 1..GZIP_HEADER_LEN]);
    bytes.extend((GZIP_EXTRA_BYTES as u16).to_le_bytes());
    bytes.extend(vec![b'x'; GZIP_EXTRA_BYTES]);
    bytes.extend(&compressed[GZIP_HEADER_LEN..]);
    assert_eq!(kind_of("a.tar.gz", &bytes), ProbeKind::Archive);
}

#[test]
fn a_name_that_is_only_an_extension_is_not_an_office_document() {
    assert_ne!(kind_of(".docx", &docx(&[])), ProbeKind::Office);
}

#[test]
fn unknown_binary_with_no_signature_keeps_the_generic_mime() {
    let probe = probe_named("a.docx", &[0x00, 0x01, 0x02, 0x03]);
    assert_eq!(probe.kind, ProbeKind::Binary);
    assert_eq!(probe.mime, MIME_BINARY);
}

#[test]
fn the_tbz_suffix_is_a_bzip2_tarball() {
    let probe = probe_named("a.tbz", &bzip2(&tar_archive("a.txt", b"hola")));
    assert_eq!(probe.kind, ProbeKind::Archive);
    assert_eq!(probe.extension, Some("tar.bz2"));
}

#![cfg(windows)]

mod archive_support;

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use archive_support::*;
use dakedaduck_svn_lib::app::archive::limits::{Limits, MAX_ARCHIVE_ENTRIES, MAX_LISTED_ENTRIES};
use dakedaduck_svn_lib::app::archive::listing::{ArchiveListing, Suspicion};
use dakedaduck_svn_lib::app::archive::service::ArchiveService;
use dakedaduck_svn_lib::app::archive::{ArchiveError, ArchiveFormat, EntryKind};
use dakedaduck_svn_lib::app::operations::OperationManager;
use dakedaduck_svn_lib::app::workspace::Workspace;
use tempfile::TempDir;

const KIB: usize = 1024;
const MIB: usize = 1024 * KIB;

struct Bench {
    dir: TempDir,
    service: ArchiveService,
}

fn bench() -> Bench {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::new(dir.path()).unwrap();
    let service = ArchiveService::new(workspace, Arc::new(OperationManager::default()));
    Bench { dir, service }
}

fn list(bench: &Bench, name: &str, bytes: &[u8]) -> Result<ArchiveListing, ArchiveError> {
    put(bench.dir.path(), name, bytes);
    bench.service.list(Path::new(name), &running())
}

fn names(listing: &ArchiveListing) -> Vec<&str> {
    listing
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect()
}

#[test]
fn a_zip_lists_files_and_folders_with_their_sizes() {
    let bench = bench();
    let bytes = zip_stored(&[
        ("docs/", b""),
        ("docs/a.txt", b"hola"),
        ("b.bin", &[0u8; 300]),
    ]);
    let listing = list(&bench, "one.zip", &bytes).unwrap();
    assert_eq!(listing.format, ArchiveFormat::Zip);
    assert_eq!(names(&listing), ["docs/", "docs/a.txt", "b.bin"]);
    assert_eq!(listing.entries[0].kind, EntryKind::Directory);
    assert_eq!(listing.entries[1].size, 4);
    assert_eq!(listing.declared_bytes, 304);
    assert_eq!(listing.largest_entry_bytes, 300);
    assert!(listing.suspicions.is_empty() && !listing.truncated && !listing.encrypted);
}

#[test]
fn hostile_names_are_listed_with_the_reason_they_will_be_skipped() {
    let bench = bench();
    let hostile = [
        "../evil.txt",
        "C:/Windows/x.txt",
        "/etc/x",
        "con.txt",
        ".svn/entries",
        "a.txt:stream",
        "dot.",
    ];
    let entries: Vec<(&str, &[u8])> = hostile.iter().map(|name| (*name, &b"x"[..])).collect();
    let listing = list(&bench, "hostile.zip", &zip_stored(&entries)).unwrap();
    assert_eq!(listing.entries.len(), hostile.len());
    for entry in &listing.entries {
        assert!(entry.skip_reason.is_some(), "{} debía marcarse", entry.name);
    }
}

#[test]
fn links_and_special_files_are_marked_to_skip() {
    let bench = bench();
    let tar = tar_raw(&[
        file("ok.txt", b"ok"),
        RawTar {
            name: "l",
            kind: tar::EntryType::Symlink,
            data: b"",
            link: Some("/etc/passwd"),
        },
        RawTar {
            name: "d",
            kind: tar::EntryType::Char,
            data: b"",
            link: None,
        },
    ]);
    let listing = list(&bench, "mix.tar", &tar).unwrap();
    let reasons: Vec<_> = listing
        .entries
        .iter()
        .map(|e| e.skip_reason.is_some())
        .collect();
    assert_eq!(reasons, [false, true, true]);
    assert_eq!(listing.entries[1].kind, EntryKind::Link);
    assert_eq!(listing.entries[2].kind, EntryKind::Device);
}

#[test]
fn every_tar_flavour_lists_the_same_entries() {
    let bench = bench();
    let tar = tar_raw(&[file("a.txt", b"uno"), file("dir/b.txt", b"dos")]);
    let listing = list(&bench, "plain.tar", &tar).unwrap();
    assert_eq!(names(&listing), ["a.txt", "dir/b.txt"]);
    let gz = list(&bench, "packed.tar.gz", &gzip(&tar)).unwrap();
    assert_eq!(gz.format, ArchiveFormat::TarGz);
    assert_eq!(names(&gz), names(&listing));
    assert_eq!(
        list(&bench, "short.tgz", &gzip(&tar)).unwrap().format,
        ArchiveFormat::TarGz
    );
}

#[test]
fn a_seven_zip_lists_its_files() {
    let bench = bench();
    let listing = list(
        &bench,
        "x.7z",
        &sevenz(&[("a.txt", b"hola"), ("d/b.txt", b"mundo")]),
    )
    .unwrap();
    assert_eq!(listing.format, ArchiveFormat::SevenZ);
    assert_eq!(names(&listing), ["a.txt", "d/b.txt"]);
    assert_eq!(listing.declared_bytes, 9);
}

#[test]
fn real_rar_archives_list_in_both_generations() {
    let bench = bench();
    for name in [
        "rar4.rar",
        "rar5.rar",
        "solid.rar",
        "multifile.rar",
        "with_comment.rar",
    ] {
        let bytes = std::fs::read(fixture(name)).unwrap();
        let listing = list(&bench, name, &bytes).unwrap();
        assert_eq!(listing.format, ArchiveFormat::Rar, "{name}");
        assert!(!listing.entries.is_empty(), "{name} sin entradas");
    }
}

#[test]
fn encrypted_archives_are_reported_not_listed_as_plain() {
    let bench = bench();
    for name in ["cifrado.zip", "password_aes.rar"] {
        let listing = list(&bench, name, &std::fs::read(fixture(name)).unwrap()).unwrap();
        assert!(listing.encrypted, "{name}");
    }
    let header_encrypted = std::fs::read(fixture("header_encrypted.rar")).unwrap();
    let outcome = list(&bench, "h.rar", &header_encrypted);
    assert!(
        matches!(outcome, Err(ArchiveError::Encrypted)),
        "{outcome:?}"
    );
}

#[test]
fn a_high_ratio_marks_the_archive_as_suspicious() {
    let bench = bench();
    let bomb = zip_zeros("zeros.bin", 40 * MIB);
    let listing = list(&bench, "bomb.zip", &bomb).unwrap();
    assert!(
        listing.suspicions.contains(&Suspicion::Ratio),
        "{:?}",
        listing.suspicions
    );
}

#[test]
fn a_tiny_highly_compressed_file_is_not_suspicious() {
    let bench = bench();
    let listing = list(&bench, "small.zip", &zip_zeros("z.bin", 64 * KIB)).unwrap();
    assert!(listing.suspicions.is_empty());
}

#[test]
fn declared_sizes_over_the_limit_are_flagged() {
    let bench = bench();
    let limits = Limits {
        entry_bytes: 1024,
        extract_bytes: 4096,
        ratio_min_bytes: u64::MAX,
    };
    let service = ArchiveService::new(
        Workspace::new(bench.dir.path()).unwrap(),
        Arc::new(OperationManager::default()),
    )
    .with_limits(limits);
    put(bench.dir.path(), "big.zip", &zip_zeros("z.bin", 8 * KIB));
    let listing = service.list(Path::new("big.zip"), &running()).unwrap();
    assert_eq!(listing.suspicions, [Suspicion::DeclaredSize]);
}

#[test]
fn deep_folders_are_flagged() {
    let bench = bench();
    let name = format!("{}f.txt", "d/".repeat(40));
    let listing = list(&bench, "deep.zip", &zip_stored(&[(name.as_str(), b"x")])).unwrap();
    assert_eq!(listing.suspicions, [Suspicion::Depth]);
}

#[test]
fn a_huge_entry_count_is_truncated_in_the_listing_but_counted() {
    let bench = bench();
    let listing = list(&bench, "many.zip", &zip_many(MAX_LISTED_ENTRIES + 10)).unwrap();
    assert!(listing.truncated);
    assert_eq!(listing.entries.len(), MAX_LISTED_ENTRIES);
    assert_eq!(listing.entry_count, MAX_LISTED_ENTRIES + 10);
}

#[test]
fn more_entries_than_the_hard_limit_are_refused() {
    let bench = bench();
    let outcome = list(&bench, "toomany.zip", &zip_many(MAX_ARCHIVE_ENTRIES + 1));
    assert!(
        matches!(outcome, Err(ArchiveError::Limit(_))),
        "{outcome:?}"
    );
}

#[test]
fn damaged_and_truncated_archives_report_corruption() {
    let bench = bench();
    let good = zip_stored(&[("a.txt", b"hola mundo")]);
    for (name, bytes) in [
        ("cut.zip", good[..good.len() / 2].to_vec()),
        ("noise.zip", vec![0xA5; 400]),
        ("empty.zip", Vec::new()),
        ("noise.7z", vec![0x11; 300]),
        ("noise.tar.gz", vec![0x22; 300]),
        ("noise.rar", vec![0x33; 300]),
    ] {
        let outcome = list(&bench, name, &bytes);
        assert!(
            matches!(
                outcome,
                Err(ArchiveError::Corrupt(_) | ArchiveError::Unsupported(_))
            ),
            "{name}: {outcome:?}"
        );
    }
}

#[test]
fn an_unknown_extension_is_not_an_archive() {
    let bench = bench();
    let outcome = list(&bench, "notes.txt", b"hola");
    assert!(
        matches!(outcome, Err(ArchiveError::Unsupported(_))),
        "{outcome:?}"
    );
}

#[test]
fn a_cancelled_listing_stops_before_reading() {
    let bench = bench();
    put(bench.dir.path(), "c.zip", &zip_stored(&[("a", b"x")]));
    let cancel = running();
    cancel.store(true, Ordering::Relaxed);
    let outcome = bench.service.list(Path::new("c.zip"), &cancel);
    assert!(
        matches!(outcome, Err(ArchiveError::Cancelled)),
        "{outcome:?}"
    );
}

#[test]
fn paths_outside_the_workspace_are_refused() {
    let bench = bench();
    let outcome = bench.service.list(Path::new("..\\fuera.zip"), &running());
    assert!(
        matches!(outcome, Err(ArchiveError::Workspace(_))),
        "{outcome:?}"
    );
}

#[test]
fn bzip2_and_xz_tarballs_list_like_the_others() {
    let bench = bench();
    let tar = tar_raw(&[file("a.txt", b"uno"), file("d/b.txt", b"dos")]);
    for (name, bytes, format) in [
        ("b.tar.bz2", bzip2(&tar), ArchiveFormat::TarBz2),
        ("x.tar.xz", xz(&tar), ArchiveFormat::TarXz),
    ] {
        let listing = list(&bench, name, &bytes).unwrap();
        assert_eq!(listing.format, format, "{name}");
        assert_eq!(names(&listing), ["a.txt", "d/b.txt"], "{name}");
    }
}

#[test]
fn tar_folders_are_folders_and_global_headers_are_not_entries() {
    let bench = bench();
    let tar = tar_raw(&[
        RawTar {
            name: "pax",
            kind: tar::EntryType::XGlobalHeader,
            data: b"15 a=b\n",
            link: None,
        },
        RawTar {
            name: "dir/",
            kind: tar::EntryType::Directory,
            data: b"",
            link: None,
        },
        file("dir/a.txt", b"x"),
    ]);
    let listing = list(&bench, "dirs.tar", &tar).unwrap();
    assert_eq!(names(&listing), ["dir/", "dir/a.txt"]);
    assert_eq!(listing.entries[0].kind, EntryKind::Directory);
}

#[test]
fn the_entry_limit_is_inclusive_in_zip_and_tar() {
    let bench = bench();
    let zip = list(&bench, "edge.zip", &zip_many(MAX_ARCHIVE_ENTRIES)).unwrap();
    assert_eq!(zip.entry_count, MAX_ARCHIVE_ENTRIES);
    let tar = list(&bench, "edge.tar", &tar_many(MAX_ARCHIVE_ENTRIES)).unwrap();
    assert_eq!(tar.entry_count, MAX_ARCHIVE_ENTRIES);
    let over = list(&bench, "over.tar", &tar_many(MAX_ARCHIVE_ENTRIES + 1));
    assert!(matches!(over, Err(ArchiveError::Limit(_))), "{over:?}");
}

#[test]
fn seven_zip_counts_its_entries_against_the_limit() {
    let bench = bench();
    let edge = list(&bench, "edge.7z", &sevenz_many(MAX_ARCHIVE_ENTRIES)).unwrap();
    assert_eq!(edge.entry_count, MAX_ARCHIVE_ENTRIES);
    let over = list(&bench, "over.7z", &sevenz_many(MAX_ARCHIVE_ENTRIES + 1));
    assert!(matches!(over, Err(ArchiveError::Limit(_))), "{over:?}");
}

#[test]
fn seven_zip_attributes_decide_links_and_devices() {
    let bench = bench();
    let cases = [
        (SEVENZ_REPARSE_POINT, EntryKind::Link),
        (unix_attributes(0o120_777), EntryKind::Link),
        (unix_attributes(0o020_644), EntryKind::Device),
        (unix_attributes(0o060_644), EntryKind::Device),
        (unix_attributes(0o010_644), EntryKind::Device),
        (unix_attributes(0o100_644), EntryKind::File),
        (0x20, EntryKind::File),
        (0o120_000 << 16, EntryKind::File),
        (0o020_000 << 16, EntryKind::File),
    ];
    for (attributes, expected) in cases {
        let bytes = sevenz_with_attributes("x", attributes);
        let listing = list(&bench, "attrs.7z", &bytes).unwrap();
        assert_eq!(
            listing.entries[0].kind, expected,
            "atributos {attributes:#x}"
        );
    }
}

#[test]
fn zip_special_files_are_devices_and_links_by_unix_mode() {
    let bench = bench();
    for (mode, expected) in [
        (0o020_644, EntryKind::Device),
        (0o060_644, EntryKind::Device),
        (0o010_644, EntryKind::Device),
        (0o120_777, EntryKind::Link),
        (0o100_644, EntryKind::File),
    ] {
        let listing = list(&bench, "mode.zip", &zip_with_unix_mode("x", mode)).unwrap();
        assert_eq!(listing.entries[0].kind, expected, "modo {mode:o}");
    }
}

#[test]
fn a_folder_with_an_archive_name_is_not_an_archive() {
    let bench = bench();
    std::fs::create_dir(bench.dir.path().join("carpeta.zip")).unwrap();
    let outcome = bench.service.list(Path::new("carpeta.zip"), &running());
    assert!(
        matches!(outcome, Err(ArchiveError::Unsupported(_))),
        "{outcome:?}"
    );
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                0xEDB8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn sevenz_with_a_valid_signature_and_a_hostile_header(tail: u8) -> Vec<u8> {
    let start_header = [tail; 20];
    let mut bytes = vec![0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C, 0, 4];
    bytes.extend_from_slice(&crc32(&start_header).to_le_bytes());
    bytes.extend_from_slice(&start_header);
    bytes.resize(512, 0);
    bytes
}

#[test]
fn a_seven_zip_with_a_valid_signature_and_a_hostile_header_is_an_error_not_a_crash() {
    let bench = bench();
    for tail in [0x01, 0x00, 0xFF, 0x7F] {
        let bytes = sevenz_with_a_valid_signature_and_a_hostile_header(tail);
        let outcome = list(&bench, "hostile.7z", &bytes);
        assert!(
            matches!(
                outcome,
                Err(ArchiveError::Corrupt(_)
                    | ArchiveError::Unsupported(_)
                    | ArchiveError::Limit(_))
            ),
            "{tail:#x}: {outcome:?}"
        );
    }
}

#[test]
fn a_cloud_only_archive_is_not_a_local_file() {
    let bench = bench();
    let path = put(
        bench.dir.path(),
        "nube.zip",
        &zip_stored(&[("a.txt", b"x")]),
    );
    let marked = std::process::Command::new("attrib")
        .args(["+O", &path.to_string_lossy()])
        .status()
        .unwrap();
    assert!(marked.success());
    let outcome = bench.service.list(Path::new("nube.zip"), &running());
    assert!(
        matches!(outcome, Err(ArchiveError::Unsupported(_))),
        "{outcome:?}"
    );
}

#[test]
fn a_seven_zip_shorter_than_its_signature_header_is_corrupt() {
    let bench = bench();
    let outcome = list(&bench, "corto.7z", &[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C]);
    assert!(
        matches!(outcome, Err(ArchiveError::Corrupt(_))),
        "{outcome:?}"
    );
}

#[test]
fn seven_zip_anti_items_are_not_listed() {
    let bench = bench();
    let bytes = sevenz_with_anti_item("borrado.txt", ("queda.txt", b"hola"));
    let listing = list(&bench, "a.7z", &bytes).unwrap();
    assert_eq!(names(&listing), ["queda.txt"]);
}

#[test]
fn listing_a_seven_zip_reads_metadata_and_never_decodes_the_data() {
    let bench = bench();
    let noise: Vec<u8> = (0..4096u32)
        .map(|index| (index.wrapping_mul(2_654_435_761) >> 13) as u8)
        .collect();
    let mut bytes = sevenz(&[("a.txt", &noise)]);
    for byte in &mut bytes[100..140] {
        *byte ^= 0xFF;
    }
    let listing = list(&bench, "dañado.7z", &bytes).unwrap();
    assert_eq!(names(&listing), ["a.txt"]);
}

#[test]
fn an_xz_stream_asking_for_more_than_256_mib_of_memory_is_a_limit_error() {
    let bench = bench();
    let outcome = list(&bench, "voraz.tar.xz", &xz_asking_for_dictionary(0x22));
    assert!(
        matches!(outcome, Err(ArchiveError::Limit(_))),
        "{outcome:?}"
    );
}

#[test]
fn an_xz_stream_within_the_memory_budget_is_not_a_limit_error() {
    let bench = bench();
    let outcome = list(&bench, "modesto.tar.xz", &xz_asking_for_dictionary(0x18));
    assert!(
        !matches!(outcome, Err(ArchiveError::Limit(_))),
        "{outcome:?}"
    );
}

#[test]
fn a_seven_zip_block_declaring_more_than_256_mib_is_refused_for_its_size() {
    let bench = bench();
    let bomb = std::fs::read(fixture("bomba.7z")).unwrap();
    let outcome = list(&bench, "bomba.7z", &bomb);
    assert!(
        matches!(&outcome, Err(ArchiveError::Limit(why)) if why.contains("bloque")),
        "{outcome:?}"
    );
}

#[test]
fn a_rar_redirection_entry_is_listed_as_a_link() {
    let bench = bench();
    let listing = list(&bench, "enlace.rar", &rar_with_symlink("atajo", "../fuera")).unwrap();
    assert_eq!(listing.entries[0].kind, EntryKind::Link);
}

#[test]
fn listing_a_rar_reads_metadata_and_never_decodes_the_data() {
    let bench = bench();
    let mut bytes = rar_with_file("a.txt", &[b'x'; 4096]);
    let at = bytes
        .windows(8)
        .position(|window| window == [b'x'; 8])
        .unwrap();
    for byte in &mut bytes[at + 10..at + 40] {
        *byte = 0x55;
    }
    let listing = list(&bench, "dañado.rar", &bytes).unwrap();
    assert_eq!(names(&listing), ["a.txt"]);
}

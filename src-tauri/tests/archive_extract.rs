#![cfg(windows)]

mod archive_support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use archive_support::*;
use dakedaduck_svn_lib::app::archive::extract::ExtractReport;
use dakedaduck_svn_lib::app::archive::limits::Limits;
use dakedaduck_svn_lib::app::archive::service::{ArchiveService, ExtractOptions};
use dakedaduck_svn_lib::app::archive::{ArchiveError, Cancel, Suspicion};
use dakedaduck_svn_lib::app::operations::OperationManager;
use dakedaduck_svn_lib::app::workspace::Workspace;
use tempfile::TempDir;

const KIB: usize = 1024;
const MIB: usize = 1024 * KIB;

struct Bench {
    dir: TempDir,
    manager: Arc<OperationManager>,
    service: ArchiveService,
}

fn bench_with(limits: Limits) -> Bench {
    let dir = tempfile::tempdir().unwrap();
    let manager = Arc::new(OperationManager::default());
    let workspace = Workspace::new(dir.path()).unwrap();
    let service = ArchiveService::new(workspace, manager.clone()).with_limits(limits);
    Bench {
        dir,
        manager,
        service,
    }
}

fn bench() -> Bench {
    bench_with(Limits::default())
}

impl Bench {
    fn extract(&self, name: &str, bytes: &[u8]) -> Result<ExtractReport, ArchiveError> {
        put(self.dir.path(), name, bytes);
        self.extract_existing(name, ExtractOptions::default(), &running())
    }

    fn extract_existing(
        &self,
        name: &str,
        options: ExtractOptions,
        cancel: &Cancel,
    ) -> Result<ExtractReport, ArchiveError> {
        self.service
            .extract(Path::new(name), options, cancel, Arc::new(|_| {}))
    }

    fn read(&self, relative: &str) -> Vec<u8> {
        fs::read(self.dir.path().join(relative)).unwrap()
    }

    fn exists(&self, relative: &str) -> bool {
        self.dir.path().join(relative).exists()
    }

    fn files_under(&self, relative: &str) -> Vec<PathBuf> {
        let mut found = Vec::new();
        let mut pending = vec![self.dir.path().join(relative)];
        while let Some(dir) = pending.pop() {
            for item in fs::read_dir(dir).unwrap().flatten() {
                match item.file_type().unwrap().is_dir() {
                    true => pending.push(item.path()),
                    false => found.push(item.path()),
                }
            }
        }
        found
    }
}

fn skipped_names(report: &ExtractReport) -> Vec<&str> {
    report
        .skipped
        .iter()
        .map(|item| item.name.as_str())
        .collect()
}

#[test]
fn a_zip_is_extracted_into_a_folder_named_after_it() {
    let bench = bench();
    let zip = zip_stored(&[
        ("docs/", b""),
        ("docs/a.txt", b"hola"),
        ("b.bin", &[7u8; 5000]),
    ]);
    let report = bench.extract("paquete.zip", &zip).unwrap();
    assert_eq!(report.destination, "paquete");
    assert_eq!(
        (report.files, report.directories, report.bytes),
        (2, 1, 5004)
    );
    assert_eq!(bench.read("paquete/docs/a.txt"), b"hola");
    assert_eq!(bench.read("paquete/b.bin"), vec![7u8; 5000]);
    assert!(bench.exists("paquete.zip"));
}

#[test]
fn the_destination_never_overwrites_an_existing_folder() {
    let bench = bench();
    let zip = zip_stored(&[("a.txt", b"uno")]);
    let first = bench.extract("x.zip", &zip).unwrap();
    let second = bench
        .extract("x.zip", &zip_stored(&[("a.txt", b"dos")]))
        .unwrap();
    assert_eq!(
        (first.destination.as_str(), second.destination.as_str()),
        ("x", "x-2")
    );
    assert_eq!(bench.read("x/a.txt"), b"uno");
    assert_eq!(bench.read("x-2/a.txt"), b"dos");
}

#[test]
fn compound_extensions_are_stripped_from_the_folder_name() {
    let bench = bench();
    let tar = gzip(&tar_raw(&[file("a.txt", b"hola")]));
    assert_eq!(
        bench.extract("datos.tar.gz", &tar).unwrap().destination,
        "datos"
    );
    assert_eq!(bench.extract("otro.TGZ", &tar).unwrap().destination, "otro");
}

#[test]
fn entries_that_climb_out_are_skipped_and_nothing_is_written_outside() {
    let bench = bench();
    let sub = bench.dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    put(
        &sub,
        "slip.zip",
        &zip_stored(&[
            ("../evil.txt", b"x"),
            ("..\\evil2.txt", b"x"),
            ("ok.txt", b"ok"),
        ]),
    );
    let report = bench
        .service
        .extract(
            Path::new("sub/slip.zip"),
            ExtractOptions::default(),
            &running(),
            Arc::new(|_| {}),
        )
        .unwrap();
    assert_eq!(skipped_names(&report), ["../evil.txt", "..\\evil2.txt"]);
    assert_eq!(fs::read(sub.join("slip/ok.txt")).unwrap(), b"ok");
    assert!(!sub.join("evil.txt").exists() && !bench.exists("evil.txt"));
    assert!(!bench.exists("evil2.txt") && !sub.join("evil2.txt").exists());
}

#[test]
fn absolute_drive_device_and_reserved_names_are_skipped() {
    let bench = bench();
    let hostile = [
        "/etc/passwd",
        "C:/Windows/x.txt",
        "C:\\Windows\\y.txt",
        "\\\\server\\share\\z.txt",
        "con.txt",
        "NUL",
        "aux/inner.txt",
        "com1.log",
        "trail.",
        "space ",
        "ads.txt:hidden",
        "wild*.txt",
        "bar|.txt",
    ];
    let entries: Vec<(&str, &[u8])> = hostile.iter().map(|name| (*name, &b"x"[..])).collect();
    let report = bench.extract("h.zip", &zip_stored(&entries)).unwrap();
    assert_eq!(report.skipped.len(), hostile.len(), "{:?}", report.skipped);
    assert_eq!(report.files, 0);
    assert!(bench.files_under("h").is_empty());
}

#[test]
fn subversion_admin_folders_are_never_extracted() {
    let bench = bench();
    let zip = zip_stored(&[
        (".svn/entries", b"x"),
        ("_svn/entries", b"x"),
        ("src/.SVN/wc.db", b"x"),
        ("src/ok.txt", b"ok"),
    ]);
    let report = bench.extract("w.zip", &zip).unwrap();
    assert_eq!(report.skipped.len(), 3);
    assert_eq!(bench.files_under("w").len(), 1);
}

#[test]
fn names_that_differ_only_in_case_do_not_overwrite_each_other() {
    let bench = bench();
    let zip = zip_stored(&[
        ("Readme.txt", b"mayus"),
        ("README.TXT", b"upper"),
        ("readme.txt", b"lower"),
    ]);
    let report = bench.extract("c.zip", &zip).unwrap();
    assert_eq!(report.files, 3);
    let mut contents: Vec<Vec<u8>> = bench
        .files_under("c")
        .iter()
        .map(|p| fs::read(p).unwrap())
        .collect();
    contents.sort();
    assert_eq!(
        contents,
        [b"lower".to_vec(), b"mayus".to_vec(), b"upper".to_vec()]
    );
}

#[test]
fn a_file_and_a_folder_with_the_same_name_do_not_break_the_extraction() {
    let bench = bench();
    let zip = zip_stored(&[
        ("a", b"archivo"),
        ("a/inside.txt", b"dentro"),
        ("z.txt", b"z"),
    ]);
    let report = bench.extract("conflict.zip", &zip).unwrap();
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(bench.read("conflict/a"), b"archivo");
    assert_eq!(bench.read("conflict/z.txt"), b"z");
}

#[test]
fn links_and_devices_are_skipped_with_a_reason() {
    let bench = bench();
    let tar = tar_raw(&[
        file("ok.txt", b"ok"),
        RawTar {
            name: "link",
            kind: tar::EntryType::Symlink,
            data: b"",
            link: Some("C:/Windows"),
        },
        RawTar {
            name: "hard",
            kind: tar::EntryType::Link,
            data: b"",
            link: Some("ok.txt"),
        },
        RawTar {
            name: "dev",
            kind: tar::EntryType::Block,
            data: b"",
            link: None,
        },
    ]);
    let report = bench.extract("l.tar", &tar).unwrap();
    assert_eq!(skipped_names(&report), ["link", "hard", "dev"]);
    assert_eq!(bench.files_under("l").len(), 1);
}

#[test]
fn every_format_extracts_the_same_content() {
    let bench = bench();
    let tar = tar_raw(&[file("a.txt", b"uno"), file("d/b.txt", b"dos")]);
    let cases: [(&str, Vec<u8>); 4] = [
        ("t.tar", tar.clone()),
        ("g.tar.gz", gzip(&tar)),
        (
            "z.zip",
            zip_stored(&[("a.txt", b"uno"), ("d/b.txt", b"dos")]),
        ),
        ("s.7z", sevenz(&[("a.txt", b"uno"), ("d/b.txt", b"dos")])),
    ];
    for (name, bytes) in cases {
        let report = bench.extract(name, &bytes).unwrap();
        assert_eq!(report.files, 2, "{name}");
        assert_eq!(
            bench.read(&format!("{}/a.txt", report.destination)),
            b"uno",
            "{name}"
        );
        assert_eq!(
            bench.read(&format!("{}/d/b.txt", report.destination)),
            b"dos",
            "{name}"
        );
    }
}

#[test]
fn real_rar_archives_extract() {
    let bench = bench();
    for name in ["rar4.rar", "rar5.rar", "solid.rar", "multifile.rar"] {
        let report = bench
            .extract(name, &fs::read(fixture(name)).unwrap())
            .unwrap();
        assert!(report.files > 0, "{name}");
        assert!(!bench.files_under(&report.destination).is_empty(), "{name}");
    }
}

#[test]
fn encrypted_archives_are_refused_before_anything_is_written() {
    let bench = bench();
    for name in [
        "cifrado.zip",
        "cifrado.7z",
        "password_aes.rar",
        "header_encrypted.rar",
    ] {
        let outcome = bench.extract(name, &fs::read(fixture(name)).unwrap());
        assert!(
            matches!(outcome, Err(ArchiveError::Encrypted)),
            "{name}: {outcome:?}"
        );
    }
    assert!(!bench.exists("cifrado") && !bench.exists("password_aes"));
}

#[test]
fn rejected_rar_headers_fail_with_a_typed_error_and_leave_no_folder() {
    let bench = bench();
    for name in [
        "algorithm_version_2.rar",
        "subdata_size_underflow.rar",
        "zero_fill_out_of_window.rar",
    ] {
        let outcome = bench.extract(name, &fs::read(fixture(name)).unwrap());
        let stem = name.trim_end_matches(".rar");
        if outcome.is_err() {
            assert!(!bench.exists(stem), "{name} dejó una carpeta a medias");
        }
    }
}

#[test]
fn a_bomb_by_ratio_asks_for_confirmation_and_writes_nothing() {
    let bench = bench();
    let outcome = bench.extract("bomb.zip", &zip_zeros("zeros.bin", 40 * MIB));
    match outcome {
        Err(ArchiveError::NeedsConfirmation(found)) => assert!(found.contains(&Suspicion::Ratio)),
        other => panic!("{other:?}"),
    }
    assert!(!bench.exists("bomb"));
}

#[test]
fn a_confirmed_suspicious_archive_does_extract() {
    let bench = bench();
    put(
        bench.dir.path(),
        "ok.zip",
        &zip_zeros("zeros.bin", 20 * MIB),
    );
    let options = ExtractOptions {
        allow_suspicious: true,
    };
    let report = bench
        .extract_existing("ok.zip", options, &running())
        .unwrap();
    assert_eq!(report.bytes, 20 * MIB as u64);
}

#[test]
fn declared_sizes_over_the_limit_are_refused_even_when_confirmed() {
    let limits = Limits {
        entry_bytes: 1024,
        extract_bytes: 4096,
        ratio_min_bytes: u64::MAX,
    };
    let bench = bench_with(limits);
    put(bench.dir.path(), "big.zip", &zip_zeros("z.bin", 8 * KIB));
    let options = ExtractOptions {
        allow_suspicious: true,
    };
    let outcome = bench.extract_existing("big.zip", options, &running());
    assert!(
        matches!(outcome, Err(ArchiveError::Limit(_))),
        "{outcome:?}"
    );
    assert!(!bench.exists("big"));
}

#[test]
fn a_lying_header_never_leaves_more_than_a_refused_extraction() {
    let limits = Limits {
        entry_bytes: MIB as u64,
        extract_bytes: 8 * MIB as u64,
        ratio_min_bytes: u64::MAX,
    };
    let bench = bench_with(limits);
    let liar = zip_lying_about_size("liar.bin", 3 * MIB, 10);
    let outcome = bench.extract("liar.zip", &liar);
    assert!(
        matches!(
            outcome,
            Err(ArchiveError::Limit(_) | ArchiveError::Corrupt(_))
        ),
        "{outcome:?}"
    );
    assert!(!bench.exists("liar"), "la carpeta a medias debe borrarse");
}

#[test]
fn the_total_limit_counts_every_entry() {
    let limits = Limits {
        entry_bytes: 4 * KIB as u64,
        extract_bytes: 6 * KIB as u64,
        ratio_min_bytes: u64::MAX,
    };
    let bench = bench_with(limits);
    let big = [1u8; 3 * KIB];
    let outcome = bench.extract(
        "sum.zip",
        &zip_stored(&[("a", &big), ("b", &big), ("c", &big)]),
    );
    assert!(
        matches!(outcome, Err(ArchiveError::Limit(_))),
        "{outcome:?}"
    );
    assert!(!bench.exists("sum"));
}

#[test]
fn a_corrupt_archive_leaves_no_partial_folder() {
    let bench = bench();
    let good = zip_stored(&[("a.txt", &[9u8; 4000])]);
    let outcome = bench.extract("cut.zip", &good[..good.len() - 30]);
    assert!(outcome.is_err());
    assert!(!bench.exists("cut"));
}

#[test]
fn a_cancelled_extraction_removes_what_it_created() {
    let bench = bench();
    put(
        bench.dir.path(),
        "c.zip",
        &zip_stored(&[("a.txt", b"hola")]),
    );
    let cancel = running();
    cancel.store(true, Ordering::Relaxed);
    let outcome = bench.extract_existing("c.zip", ExtractOptions::default(), &cancel);
    assert!(
        matches!(outcome, Err(ArchiveError::Cancelled)),
        "{outcome:?}"
    );
    assert!(!bench.exists("c"));
}

#[test]
fn cancelling_in_the_middle_of_a_file_removes_the_partial_folder() {
    let bench = bench();
    put(
        bench.dir.path(),
        "m.zip",
        &zip_stored(&[("a.txt", &vec![1u8; 96 * MIB])]),
    );
    let cancel = running();
    let (flag, written) = (cancel.clone(), bench.dir.path().join("m").join("a.txt"));
    let watcher = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while std::time::Instant::now() < deadline {
            if fs::metadata(&written).is_ok_and(|meta| meta.len() > 0) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        flag.store(true, Ordering::Relaxed);
    });
    let outcome = bench.extract_existing("m.zip", ExtractOptions::default(), &cancel);
    watcher.join().unwrap();
    assert!(
        matches!(outcome, Err(ArchiveError::Cancelled)),
        "{outcome:?}"
    );
    assert!(!bench.exists("m"));
}

#[test]
fn an_operation_on_the_same_folder_blocks_the_extraction() {
    let bench = bench();
    put(
        bench.dir.path(),
        "busy.zip",
        &zip_stored(&[("a.txt", b"x")]),
    );
    let destination = Workspace::new(bench.dir.path())
        .unwrap()
        .root()
        .as_path()
        .join("busy");
    let _held = bench.manager.try_lock_for_write(&destination).unwrap();
    let outcome = bench.extract_existing("busy.zip", ExtractOptions::default(), &running());
    assert!(matches!(outcome, Err(ArchiveError::Busy(_))), "{outcome:?}");
    assert!(!bench.exists("busy"));
}

#[test]
fn progress_reports_the_final_totals() {
    let bench = bench();
    put(
        bench.dir.path(),
        "p.zip",
        &zip_stored(&[("a", &[1u8; 100]), ("b", &[2u8; 50])]),
    );
    let last = Arc::new(Mutex::new(None));
    let sink = last.clone();
    bench
        .service
        .extract(
            Path::new("p.zip"),
            ExtractOptions::default(),
            &running(),
            Arc::new(move |p| *sink.lock().unwrap() = Some(p)),
        )
        .unwrap();
    let last = last.lock().unwrap().expect("al menos el cierre");
    assert_eq!((last.files, last.bytes, last.total_bytes), (2, 150, 150));
}

#[test]
fn more_than_the_reported_limit_of_skips_are_counted_not_listed() {
    let bench = bench();
    let names: Vec<String> = (0..1100).map(|i| format!("../x{i}")).collect();
    let entries: Vec<(&str, &[u8])> = names.iter().map(|name| (name.as_str(), &b""[..])).collect();
    let report = bench.extract("skips.zip", &zip_stored(&entries)).unwrap();
    assert_eq!(report.skipped.len(), 1000);
    assert_eq!(report.skipped_more, 100);
}

#[test]
fn the_archive_inside_a_subversion_admin_folder_is_refused() {
    let bench = bench();
    let admin = bench.dir.path().join(".svn");
    fs::create_dir(&admin).unwrap();
    put(&admin, "a.zip", &zip_stored(&[("a", b"x")]));
    let outcome = bench.extract_existing(".svn/a.zip", ExtractOptions::default(), &running());
    assert!(
        matches!(outcome, Err(ArchiveError::UnsafeEntry(_))),
        "{outcome:?}"
    );
}

#[test]
fn recorded_bombs_are_stopped_before_writing_in_every_compressed_format() {
    let bench = bench();
    for name in ["bomba.7z", "bomba.tar.xz", "bomba.tar.bz2"] {
        put(bench.dir.path(), name, &fs::read(fixture(name)).unwrap());
        let outcome = bench.extract_existing(name, ExtractOptions::default(), &running());
        let stopped = matches!(
            outcome,
            Err(ArchiveError::NeedsConfirmation(_) | ArchiveError::Limit(_))
        );
        assert!(stopped, "{name}: {outcome:?}");
        assert!(
            !bench.exists(name.split('.').next().unwrap()),
            "{name} dejó datos"
        );
    }
}

#[test]
fn the_entry_limit_accepts_its_exact_size_and_refuses_one_byte_more() {
    let limits = Limits {
        entry_bytes: 1000,
        extract_bytes: 100_000,
        ratio_min_bytes: u64::MAX,
    };
    let bench = bench_with(limits);
    let exact = bench.extract("exact.zip", &zip_stored(&[("a", &[1u8; 1000])]));
    assert_eq!(exact.unwrap().bytes, 1000);
    let over = bench.extract("over.zip", &zip_stored(&[("a", &[1u8; 1001])]));
    assert!(matches!(over, Err(ArchiveError::Limit(_))), "{over:?}");
    assert!(!bench.exists("over"));
}

#[test]
fn the_total_limit_accepts_its_exact_size_and_refuses_one_byte_more() {
    let limits = Limits {
        entry_bytes: 2000,
        extract_bytes: 2000,
        ratio_min_bytes: u64::MAX,
    };
    let bench = bench_with(limits);
    let exact = bench.extract(
        "exact.zip",
        &zip_stored(&[("a", &[1u8; 1000]), ("b", &[1u8; 1000])]),
    );
    assert_eq!(exact.unwrap().bytes, 2000);
    let over = bench.extract(
        "over.zip",
        &zip_stored(&[("a", &[1u8; 1000]), ("b", &[1u8; 1001])]),
    );
    assert!(matches!(over, Err(ArchiveError::Limit(_))), "{over:?}");
}

#[test]
fn an_entry_whose_final_path_is_too_long_is_skipped() {
    let bench = bench();
    let long = format!("{}/{}/f.txt", "a".repeat(120), "b".repeat(120));
    let report = bench
        .extract(
            "long.zip",
            &zip_stored(&[(long.as_str(), b"x"), ("ok.txt", b"ok")]),
        )
        .unwrap();
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(report.files, 1);
}

#[test]
fn bzip2_and_xz_tarballs_extract() {
    let bench = bench();
    let tar = tar_raw(&[file("a.txt", b"uno"), file("d/b.txt", b"dos")]);
    for (name, bytes) in [("b.tar.bz2", bzip2(&tar)), ("x.tar.xz", xz(&tar))] {
        let report = bench.extract(name, &bytes).unwrap();
        assert_eq!(report.files, 2, "{name}");
        assert_eq!(
            bench.read(&format!("{}/d/b.txt", report.destination)),
            b"dos",
            "{name}"
        );
    }
}

#[test]
fn an_archive_named_only_by_its_extension_extracts_into_a_fallback_folder() {
    let bench = bench();
    let report = bench
        .extract(".zip", &zip_stored(&[("a.txt", b"x")]))
        .unwrap();
    assert_eq!(report.destination, "extraido");
}

#[test]
fn a_folder_named_like_an_archive_is_refused() {
    let bench = bench();
    fs::create_dir(bench.dir.path().join("d.zip")).unwrap();
    let outcome = bench.extract_existing("d.zip", ExtractOptions::default(), &running());
    assert!(
        matches!(outcome, Err(ArchiveError::Unsupported(_))),
        "{outcome:?}"
    );
}

#[test]
fn a_folder_entry_over_a_file_is_skipped_not_fatal() {
    let bench = bench();
    let zip = zip_stored(&[
        ("a", b"archivo"),
        ("a/", b""),
        ("a/b/", b""),
        ("z.txt", b"z"),
    ]);
    let report = bench.extract("clash.zip", &zip).unwrap();
    assert_eq!(skipped_names(&report), ["a/", "a/b/"]);
    assert_eq!(bench.read("clash/a"), b"archivo");
    assert_eq!(bench.read("clash/z.txt"), b"z");
}

#[test]
fn the_final_path_length_is_limited_at_its_exact_edge() {
    let bench = bench();
    let root = Workspace::new(bench.dir.path())
        .unwrap()
        .root()
        .as_path()
        .to_string_lossy()
        .encode_utf16()
        .count();
    let fixed = root + "\\edge\\".len();
    let fits = "a".repeat(240 - fixed);
    let over = "b".repeat(241 - fixed);
    let zip = zip_stored(&[(fits.as_str(), b"x"), (over.as_str(), b"x")]);
    let report = bench.extract("edge.zip", &zip).unwrap();
    assert_eq!(
        (report.files, report.skipped.len()),
        (1, 1),
        "{:?}",
        report.skipped
    );
    assert_eq!(skipped_names(&report), [over.as_str()]);
}

#[test]
fn progress_is_throttled_but_always_ends_with_the_totals() {
    let bench = bench();
    let names: Vec<String> = (0..300).map(|index| format!("f{index}")).collect();
    let entries: Vec<(&str, &[u8])> = names
        .iter()
        .map(|name| (name.as_str(), &b"xy"[..]))
        .collect();
    put(bench.dir.path(), "many.zip", &zip_stored(&entries));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    bench
        .service
        .extract(
            Path::new("many.zip"),
            ExtractOptions::default(),
            &running(),
            Arc::new(move |p| sink.lock().unwrap().push(p)),
        )
        .unwrap();
    let seen = seen.lock().unwrap();
    assert!(seen.len() < 100, "{} avisos de progreso", seen.len());
    let last = seen.last().unwrap();
    assert_eq!((last.files, last.bytes), (300, 600));
}

#[test]
fn the_status_cache_of_the_destination_is_invalidated() {
    use dakedaduck_svn_lib::app::wc_status::{Lookup, StatusCache, StatusKey, WcStatusMap};
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::new(dir.path()).unwrap();
    let cache = Arc::new(StatusCache::default());
    let root = workspace.root().as_path().to_path_buf();
    let key = StatusKey {
        wc: &root,
        remote: false,
    };
    let generation = cache.generation();
    cache.store(key, generation, &WcStatusMap::default());
    assert!(matches!(cache.lookup(key), Lookup::Hit(_)));
    let service = ArchiveService::new(workspace, Arc::new(OperationManager::default()))
        .with_statuses(cache.clone());
    put(dir.path(), "s.zip", &zip_stored(&[("a", b"x")]));
    service
        .extract(
            Path::new("s.zip"),
            ExtractOptions::default(),
            &running(),
            Arc::new(|_| {}),
        )
        .unwrap();
    assert!(matches!(cache.lookup(key), Lookup::Miss { .. }));
}

#[test]
fn recorded_seven_zip_bomb_is_refused_before_decoding() {
    let bench = bench();
    put(
        bench.dir.path(),
        "b.7z",
        &fs::read(fixture("bomba.7z")).unwrap(),
    );
    let options = ExtractOptions {
        allow_suspicious: true,
    };
    let outcome = bench.extract_existing("b.7z", options, &running());
    assert!(
        matches!(outcome, Err(ArchiveError::Limit(_))),
        "{outcome:?}"
    );
    assert!(!bench.exists("b"));
}

#[test]
fn nine_hundred_ninety_nine_taken_folder_names_end_in_a_limit_error() {
    let bench = bench();
    put(bench.dir.path(), "a.zip", &zip_stored(&[("x.txt", b"x")]));
    fs::create_dir(bench.dir.path().join("a")).unwrap();
    for attempt in 2..=999 {
        fs::create_dir(bench.dir.path().join(format!("a-{attempt}"))).unwrap();
    }
    let outcome = bench.extract_existing("a.zip", ExtractOptions::default(), &running());
    assert!(
        matches!(outcome, Err(ArchiveError::Limit(_))),
        "{outcome:?}"
    );
}

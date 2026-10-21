#![cfg(windows)]

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::FakeSvn;
use dakedaduck_svn_lib::app::state::{AppState, SvnDetection};
use dakedaduck_svn_lib::config::{CONFIG_FILE_NAME, ConfigStore};
use dakedaduck_svn_lib::svn::bundled::{BundleProblem, MANIFEST_JSON, verify};
use dakedaduck_svn_lib::svn::locator::{
    Bundle, Located, LocatorError, SvnBinary, SvnOrigin, SvnVersion, locate, locate_full,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::TempDir;

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn manifest_of(files: &[(&str, &[u8])]) -> String {
    let entries: Vec<_> = files
        .iter()
        .map(|(name, bytes)| json!({ "name": name, "bytes": bytes.len(), "sha256": sha(bytes) }))
        .collect();
    json!({ "version": "1.14.5", "runtime": "14", "files": entries }).to_string()
}

fn write_bundle(files: &[(&str, &[u8])]) -> TempDir {
    let dir = TempDir::new().unwrap();
    for (name, bytes) in files {
        fs::write(dir.path().join(name), bytes).unwrap();
    }
    dir
}

const SAMPLE: [(&str, &[u8]); 3] = [
    ("svn.exe", b"programa"),
    ("libuno.dll", b"uno"),
    ("libdos.dll", b"dos"),
];

#[test]
fn an_intact_bundle_verifies_and_yields_its_svn_exe() {
    let dir = write_bundle(&SAMPLE);
    let found = verify(dir.path(), &manifest_of(&SAMPLE)).unwrap();
    assert_eq!(found, dir.path().join("svn.exe"));
}

#[test]
fn a_missing_file_is_reported_by_name() {
    let dir = write_bundle(&SAMPLE);
    fs::remove_file(dir.path().join("libdos.dll")).unwrap();
    assert_eq!(
        verify(dir.path(), &manifest_of(&SAMPLE)),
        Err(BundleProblem::Missing("libdos.dll".to_owned()))
    );
}

#[test]
fn a_changed_file_is_refused_even_with_the_same_size() {
    let dir = write_bundle(&SAMPLE);
    fs::write(dir.path().join("libuno.dll"), b"unX").unwrap();
    assert_eq!(
        verify(dir.path(), &manifest_of(&SAMPLE)),
        Err(BundleProblem::Changed("libuno.dll".to_owned()))
    );
}

#[test]
fn a_file_with_another_size_is_refused() {
    let dir = write_bundle(&SAMPLE);
    fs::write(dir.path().join("libuno.dll"), b"uno y mas").unwrap();
    assert_eq!(
        verify(dir.path(), &manifest_of(&SAMPLE)),
        Err(BundleProblem::Changed("libuno.dll".to_owned()))
    );
}

#[test]
fn a_directory_in_place_of_a_file_is_refused() {
    let dir = write_bundle(&SAMPLE[..2]);
    fs::create_dir(dir.path().join("libdos.dll")).unwrap();
    assert!(matches!(
        verify(dir.path(), &manifest_of(&SAMPLE)),
        Err(BundleProblem::Changed(_))
    ));
}

#[test]
fn an_extra_dll_that_the_manifest_does_not_list_is_refused() {
    let dir = write_bundle(&SAMPLE);
    fs::write(dir.path().join("Intrusa.DLL"), b"x").unwrap();
    assert_eq!(
        verify(dir.path(), &manifest_of(&SAMPLE)),
        Err(BundleProblem::Unexpected("intrusa.dll".to_owned()))
    );
}

#[test]
fn a_subfolder_of_licenses_is_allowed() {
    let dir = write_bundle(&SAMPLE);
    fs::create_dir(dir.path().join("licenses")).unwrap();
    fs::write(dir.path().join("licenses").join("a.txt"), b"texto").unwrap();
    assert!(verify(dir.path(), &manifest_of(&SAMPLE)).is_ok());
}

#[test]
fn an_upper_case_hash_in_the_manifest_still_matches() {
    let dir = write_bundle(&SAMPLE);
    let upper = manifest_of(&SAMPLE).replace(&sha(b"uno"), &sha(b"uno").to_uppercase());
    assert!(verify(dir.path(), &upper).is_ok());
}

#[test]
fn a_manifest_that_is_not_json_or_has_no_svn_exe_is_refused() {
    let dir = write_bundle(&SAMPLE);
    assert_eq!(
        verify(dir.path(), "no es json"),
        Err(BundleProblem::BadManifest)
    );
    assert_eq!(
        verify(dir.path(), &manifest_of(&SAMPLE[1..])),
        Err(BundleProblem::Missing("svn.exe".to_owned()))
    );
}

#[test]
fn a_folder_that_does_not_exist_is_reported_as_missing() {
    let nowhere = Path::new(r"C:\no\existe\svn-incluido");
    assert!(matches!(
        verify(nowhere, &manifest_of(&SAMPLE)),
        Err(BundleProblem::Missing(_))
    ));
}

struct RealBundle {
    dir: TempDir,
    manifest: String,
    system_dir: PathBuf,
}

fn real_bundle() -> RealBundle {
    let system = locate(None).expect("se necesita Subversion >= 1.10");
    let system_dir = system.path.parent().unwrap().to_path_buf();
    let dir = TempDir::new().unwrap();
    let mut files = Vec::new();
    for item in fs::read_dir(&system_dir).unwrap().flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        let lower = name.to_ascii_lowercase();
        if lower == "svn.exe" || lower.ends_with(".dll") {
            let bytes = fs::read(item.path()).unwrap();
            fs::write(dir.path().join(&name), &bytes).unwrap();
            files.push((name, bytes));
        }
    }
    let borrowed: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
        .collect();
    RealBundle {
        manifest: manifest_of(&borrowed),
        dir,
        system_dir,
    }
}

fn bundle_of(real: &RealBundle) -> Bundle<'_> {
    Bundle {
        dir: real.dir.path(),
        manifest: &real.manifest,
    }
}

#[test]
fn the_bundled_svn_wins_over_the_system_ones() {
    let real = real_bundle();
    let located = locate_full(None, Some(bundle_of(&real)), &[real.system_dir.clone()]).unwrap();
    assert_eq!(located.binary.origin, SvnOrigin::Bundled);
    assert_eq!(located.binary.path, real.dir.path().join("svn.exe"));
    assert_eq!(located.skipped_bundle, None);
}

#[test]
fn a_configured_path_wins_over_the_bundled_svn() {
    let real = real_bundle();
    let configured = real.system_dir.join("svn.exe");
    let located = locate_full(Some(&configured), Some(bundle_of(&real)), &[]).unwrap();
    assert_eq!(located.binary.origin, SvnOrigin::Configured);
    assert_eq!(located.binary.path, configured);
}

#[test]
fn a_tampered_bundle_is_skipped_with_its_reason_and_the_system_svn_is_used() {
    let real = real_bundle();
    let victim = fs::read_dir(real.dir.path())
        .unwrap()
        .flatten()
        .find(|item| item.file_name().to_string_lossy().ends_with(".dll"))
        .unwrap();
    let victim_name = victim.file_name().to_string_lossy().into_owned();
    let mut bytes = fs::read(victim.path()).unwrap();
    bytes[0] ^= 0xFF;
    fs::write(victim.path(), bytes).unwrap();
    let located = locate_full(None, Some(bundle_of(&real)), &[real.system_dir.clone()]).unwrap();
    assert_eq!(located.binary.origin, SvnOrigin::System);
    assert_eq!(
        located.skipped_bundle,
        Some(BundleProblem::Changed(victim_name.clone()))
    );
    let warning = SvnDetection::from(Ok(located)).warning.unwrap();
    assert!(warning.contains(&victim_name) && warning.contains("se ignoró"));
}

#[test]
fn a_tampered_bundle_with_no_other_svn_is_an_explicit_error() {
    let real = real_bundle();
    fs::write(real.dir.path().join("intrusa.dll"), b"x").unwrap();
    assert_eq!(
        locate_full(None, Some(bundle_of(&real)), &[]),
        Err(LocatorError::BundleDamaged(BundleProblem::Unexpected(
            "intrusa.dll".to_owned()
        )))
    );
}

#[test]
fn without_a_bundle_the_search_directories_decide_as_before() {
    let real = real_bundle();
    let located = locate_full(None, None, &[real.system_dir.clone()]).unwrap();
    assert_eq!(located.binary.origin, SvnOrigin::System);
    assert_eq!(located.skipped_bundle, None);
    assert_eq!(locate_full(None, None, &[]), Err(LocatorError::NotFound));
}

fn located(version: SvnVersion, skipped: Option<BundleProblem>) -> Located {
    Located {
        binary: SvnBinary {
            path: PathBuf::from(r"C:\svn\svn.exe"),
            version,
            origin: SvnOrigin::System,
        },
        skipped_bundle: skipped,
    }
}

fn version(major: u32, minor: u32, patch: u32) -> SvnVersion {
    SvnVersion {
        major,
        minor,
        patch,
    }
}

#[test]
fn a_client_before_1_14_4_is_accepted_with_a_persistent_cve_warning() {
    for old in [version(1, 10, 0), version(1, 14, 2), version(1, 14, 3)] {
        let detection = SvnDetection::from(Ok(located(old, None)));
        let warning = detection.warning.expect("debe avisar");
        assert!(warning.contains("CVE-2024-45720") && warning.contains(&old.to_string()));
        assert!(detection.binary.is_some() && detection.error.is_none());
    }
}

#[test]
fn a_client_from_1_14_4_on_carries_no_warning() {
    for current in [version(1, 14, 4), version(1, 14, 5), version(1, 15, 0)] {
        let detection = SvnDetection::from(Ok(located(current, None)));
        assert_eq!(detection.warning, None, "{current}");
    }
}

#[test]
fn an_ignored_bundle_is_reported_in_the_warning() {
    let detection = SvnDetection::from(Ok(located(
        version(1, 14, 5),
        Some(BundleProblem::Changed("libuno.dll".to_owned())),
    )));
    let warning = detection.warning.unwrap();
    assert!(warning.contains("libuno.dll") && warning.contains("se ignoró"));
}

#[test]
fn a_failed_detection_carries_the_error_and_no_binary() {
    let detection = SvnDetection::from(Err(LocatorError::NotFound));
    assert!(detection.binary.is_none());
    assert!(detection.error.is_some() && detection.warning.is_none());
}

#[test]
fn the_embedded_manifest_lists_svn_exe_the_runtime_and_well_formed_hashes() {
    let manifest: serde_json::Value =
        serde_json::from_str(dakedaduck_svn_lib::svn::bundled::MANIFEST_JSON).unwrap();
    let files = manifest["files"].as_array().unwrap();
    let names: Vec<&str> = files
        .iter()
        .map(|file| file["name"].as_str().unwrap())
        .collect();
    for required in [
        "svn.exe",
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "msvcp140.dll",
    ] {
        assert!(names.contains(&required), "falta {required}");
    }
    for file in files {
        let hash = file["sha256"].as_str().unwrap();
        assert!(hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert!(file["bytes"].as_u64().unwrap() > 0);
    }
    assert_eq!(manifest["version"], "1.14.5");
}

fn fake_svn_bytes(version: &'static str) -> Vec<u8> {
    let scratch = TempDir::new().unwrap();
    let exe = FakeSvn::with_version(version).build(scratch.path());
    fs::read(exe).unwrap()
}

fn locate_bundle_only(files: &[(&str, &[u8])]) -> Result<Located, LocatorError> {
    let dir = write_bundle(files);
    let manifest = manifest_of(files);
    let bundle = Bundle {
        dir: dir.path(),
        manifest: &manifest,
    };
    locate_full(None, Some(bundle), &[])
}

#[test]
fn an_intact_bundle_whose_svn_does_not_start_is_unusable() {
    let unusable = || LocatorError::BundleDamaged(BundleProblem::Unusable);
    assert_eq!(
        locate_bundle_only(&[("svn.exe", b"no es un ejecutable")]),
        Err(unusable())
    );
    let silent = fake_svn_bytes("sin version");
    assert_eq!(locate_bundle_only(&[("svn.exe", &silent)]), Err(unusable()));
}

#[test]
fn an_intact_bundle_with_a_svn_older_than_the_minimum_is_unusable() {
    let old = fake_svn_bytes("1.9.9");
    assert_eq!(
        locate_bundle_only(&[("svn.exe", &old)]),
        Err(LocatorError::BundleDamaged(BundleProblem::Unusable))
    );
}

#[test]
fn a_damaged_bundle_with_only_an_outdated_system_svn_reports_too_old() {
    let system = TempDir::new().unwrap();
    FakeSvn::with_version("1.9.9").build(system.path());
    let empty = TempDir::new().unwrap();
    let manifest = manifest_of(&SAMPLE);
    let bundle = Bundle {
        dir: empty.path(),
        manifest: &manifest,
    };
    let outcome = locate_full(None, Some(bundle), &[system.path().to_path_buf()]);
    assert!(
        matches!(outcome, Err(LocatorError::TooOld { .. })),
        "{outcome:?}"
    );
}

#[test]
fn svn_set_path_accepts_the_executable_name_in_any_case() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("SVN.EXE"), fake_svn_bytes("1.14.5")).unwrap();
    let store = ConfigStore {
        path: dir.path().join("cfg").join(CONFIG_FILE_NAME),
    };
    let detection = AppState::new(store).svn_set_path(&dir.path().join("SVN.EXE"));
    assert!(detection.binary.is_some(), "{detection:?}");
}

#[test]
fn the_embedded_manifest_matches_the_lock_and_the_shipped_folder() {
    let lock: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../third_party/svn.lock.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let manifest: serde_json::Value = serde_json::from_str(MANIFEST_JSON).unwrap();
    assert_eq!(manifest["version"], lock["version"]);
    let mut wanted: Vec<String> = lock["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap().to_ascii_lowercase())
        .collect();
    for runtime in lock["runtime"].as_array().unwrap() {
        wanted.push(runtime["name"].as_str().unwrap().to_ascii_lowercase());
    }
    let mut listed: Vec<String> = manifest["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["name"].as_str().unwrap().to_ascii_lowercase())
        .collect();
    wanted.sort();
    listed.sort();
    assert_eq!(listed, wanted);
    for runtime in lock["runtime"].as_array().unwrap() {
        let entry = manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["name"] == runtime["name"])
            .unwrap();
        assert_eq!(entry["sha256"], runtime["sha256"]);
    }
}

#[test]
fn the_shipped_folder_verifies_against_the_embedded_manifest_when_it_exists() {
    let shipped = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/svn"));
    // resources/svn is gitignored: it only exists after scripts/bundle-svn.ps1 ran
    if !shipped.join("svn.exe").is_file() {
        assert!(
            std::env::var_os("ALLOW_MISSING_SHIPPED_SVN").is_some(),
            "falta src-tauri/resources/svn: corre scripts/bundle-svn.ps1 o define ALLOW_MISSING_SHIPPED_SVN"
        );
        return;
    }
    assert_eq!(verify(shipped, MANIFEST_JSON), Ok(shipped.join("svn.exe")));
}

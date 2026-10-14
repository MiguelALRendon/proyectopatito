#![cfg(windows)]

mod common;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use common::FakeSvn;

use dakedaduck_svn_lib::app::svn_locator::{
    LocatorError, MIN_VERSION, SvnVersion, default_search_dirs, locate, locate_in, parse_version,
    search_dirs,
};
use dakedaduck_svn_lib::svn::error::{
    CODE_AUTH_REQUIRED, Captured, SvnError, SvnErrorKind, extract_codes, redact_command,
};
use dakedaduck_svn_lib::svn::runner::{RunOptions, SvnRunner, decode_stderr};
use tempfile::TempDir;
use tokio::sync::Notify;

const POWERSHELL: &str = "powershell.exe";
const MARKER_DELAY_SECS: u64 = 3;
const PROBE_DEADLINE: Duration = Duration::from_secs(8);
const ECHO_STDIN_SCRIPT: &str = "$line = [Console]::In.ReadLine(); Write-Output $line; #";
const SHORT_TIMEOUT: Duration = Duration::from_millis(400);
const CANCEL_DELAY: Duration = Duration::from_millis(300);
const KILL_DEADLINE: Duration = Duration::from_secs(10);

fn os_args(parts: &[&str]) -> Vec<OsString> {
    parts.iter().map(OsString::from).collect()
}

fn codes(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| part.to_string()).collect()
}

fn powershell_runner() -> SvnRunner {
    SvnRunner::new(PathBuf::from(POWERSHELL))
}

fn powershell_args(script: &str) -> Vec<OsString> {
    os_args(&["-NoProfile", "-Command", script])
}

fn marker_script(marker: &Path) -> String {
    format!(
        "Start-Sleep -Seconds {MARKER_DELAY_SECS}; Set-Content -Path '{}' -Value x; #",
        marker.display()
    )
}

async fn assert_process_was_killed(marker: &Path) {
    tokio::time::sleep(Duration::from_secs(MARKER_DELAY_SECS + 2)).await;
    assert!(
        !marker.exists(),
        "el proceso sobrevivió y terminó su trabajo"
    );
}

fn batch_file(dir: &TempDir, body: &str) -> PathBuf {
    let path = dir.path().join("fake-svn.bat");
    fs::write(&path, format!("@echo off\r\n{body}\r\n")).unwrap();
    path
}

#[test]
fn extract_codes_returns_nothing_for_empty_stderr() {
    assert!(extract_codes("").is_empty());
}

#[test]
fn extract_codes_ignores_lines_without_svn_prefix() {
    assert!(extract_codes("E170001: sin prefijo\nruido").is_empty());
}

#[test]
fn extract_codes_rejects_malformed_codes() {
    let stderr =
        "svn: E12: corto\nsvn: e170001: minuscula\nsvn: E17000x: no numerico\nsvn: E1700011: largo";
    assert!(extract_codes(stderr).is_empty());
}

#[test]
fn extract_codes_keeps_every_code_of_a_chained_error_in_order() {
    let stderr = "svn: E170013: no se pudo conectar\nsvn: E230001: fallo TLS\r\n";
    assert_eq!(extract_codes(stderr), codes(&["E170013", "E230001"]));
}

#[test]
fn kind_is_other_for_empty_codes() {
    assert_eq!(SvnErrorKind::from_codes(&[]), SvnErrorKind::Other);
}

#[test]
fn kind_is_other_for_unrecognized_codes() {
    assert_eq!(
        SvnErrorKind::from_codes(&codes(&["E999999"])),
        SvnErrorKind::Other
    );
}

#[test]
fn kind_uses_the_first_recognized_code_in_a_chain() {
    let chain = codes(&["E170013", "E230001", "E170001"]);
    assert_eq!(
        SvnErrorKind::from_codes(&chain),
        SvnErrorKind::UntrustedCertificate
    );
}

#[test]
fn kind_maps_each_known_code() {
    let expected = [
        ("E170001", SvnErrorKind::AuthRequired),
        ("E215004", SvnErrorKind::AuthRequired),
        ("E215001", SvnErrorKind::AuthRequired),
        ("E230001", SvnErrorKind::UntrustedCertificate),
        ("E155036", SvnErrorKind::WorkingCopyTooOld),
        ("E155004", SvnErrorKind::WorkingCopyLocked),
    ];
    for (code, kind) in expected {
        assert_eq!(SvnErrorKind::from_codes(&codes(&[code])), kind, "{code}");
    }
}

#[test]
fn redact_hides_the_value_after_password_flag() {
    let command = redact_command(&os_args(&["commit", "--password", "s3cret", "-m", "x"]));
    assert!(!command.contains("s3cret"));
    assert!(command.contains("***"));
}

#[test]
fn redact_hides_the_value_of_password_equals_form() {
    let command = redact_command(&os_args(&["update", "--password=s3cret"]));
    assert!(!command.contains("s3cret"));
}

#[test]
fn redact_survives_password_flag_as_last_argument() {
    assert_eq!(
        redact_command(&os_args(&["info", "--password"])),
        "info --password"
    );
}

#[test]
fn redact_leaves_password_from_stdin_flag_and_next_argument_alone() {
    let command = redact_command(&os_args(&["--password-from-stdin", "visible"]));
    assert_eq!(command, "--password-from-stdin visible");
}

#[test]
fn redact_keeps_arguments_untouched_without_password() {
    assert_eq!(redact_command(&os_args(&["info", "--xml"])), "info --xml");
}

#[test]
fn error_from_process_normalizes_auth_failure_without_leaking_password() {
    let captured = Captured {
        stderr: "svn: E170001: Authorization failed\n".into(),
        exit_code: Some(1),
        ..Captured::default()
    };
    let args = os_args(&["info", "--password=s3cret", "https://host/repo"]);
    let error = SvnError::from_process(&args, captured);
    assert_eq!(error.kind, SvnErrorKind::AuthRequired);
    assert_eq!(error.codes, codes(&[CODE_AUTH_REQUIRED]));
    assert_eq!(error.exit_code, Some(1));
    assert!(!error.command.contains("s3cret"));
    assert!(!error.to_string().contains("s3cret"));
}

#[test]
fn decode_stderr_returns_empty_for_empty_bytes() {
    assert_eq!(decode_stderr(&[]), "");
}

#[test]
fn decode_stderr_falls_back_to_latin1_for_invalid_utf8() {
    assert_eq!(
        decode_stderr(b"C:\\no existe\\\xf1and\xfa"),
        "C:\\no existe\\ñandú"
    );
}

#[test]
fn decode_stderr_keeps_valid_utf8_intact() {
    assert_eq!(decode_stderr("ñandú".as_bytes()), "ñandú");
}

#[tokio::test]
async fn run_reports_spawn_failure_for_missing_binary() {
    let runner = SvnRunner::new(PathBuf::from(r"C:\no\existe\svn.exe"));
    let error = runner
        .run(&os_args(&["info"]), RunOptions::default())
        .await
        .unwrap_err();
    assert_eq!(error.kind, SvnErrorKind::Other);
    assert!(!error.stderr.is_empty());
}

#[tokio::test]
async fn run_times_out_and_kills_a_hanging_process() {
    let options = RunOptions {
        timeout: SHORT_TIMEOUT,
        ..RunOptions::default()
    };
    let dir = TempDir::new().unwrap();
    let marker = dir.path().join("vivo.txt");
    let started = Instant::now();
    let error = powershell_runner()
        .run(&powershell_args(&marker_script(&marker)), options)
        .await
        .unwrap_err();
    assert_eq!(error.kind, SvnErrorKind::TimedOut);
    assert!(started.elapsed() < KILL_DEADLINE);
    assert_process_was_killed(&marker).await;
}

#[tokio::test]
async fn run_cancels_when_notified_before_the_timeout() {
    let cancel = Arc::new(Notify::new());
    let options = RunOptions {
        cancel: Some(cancel.clone()),
        ..RunOptions::default()
    };
    tokio::spawn(async move {
        tokio::time::sleep(CANCEL_DELAY).await;
        cancel.notify_one();
    });
    let dir = TempDir::new().unwrap();
    let marker = dir.path().join("vivo.txt");
    let started = Instant::now();
    let error = powershell_runner()
        .run(&powershell_args(&marker_script(&marker)), options)
        .await
        .unwrap_err();
    assert_eq!(error.kind, SvnErrorKind::Cancelled);
    assert!(started.elapsed() < KILL_DEADLINE);
    assert_process_was_killed(&marker).await;
}

#[tokio::test]
async fn run_surfaces_real_svn_error_codes_for_a_missing_repository() {
    let svn = locate(None).expect("se necesita Subversion >= 1.10");
    let error = SvnRunner::new(svn.path)
        .run(
            &os_args(&["info", "file:///C:/no/existe/repo"]),
            RunOptions::default(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.codes, codes(&["E170013", "E180001"]));
    assert_eq!(error.exit_code, Some(1));
    assert!(error.command.ends_with("--non-interactive"));
}

#[tokio::test]
async fn run_sends_the_password_through_stdin_not_argv() {
    let options = RunOptions {
        password: Some("s3cret".into()),
        ..RunOptions::default()
    };
    let output = powershell_runner()
        .run(&powershell_args(ECHO_STDIN_SCRIPT), options)
        .await
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "s3cret");
}

#[tokio::test]
async fn run_appends_non_interactive_as_the_last_argument() {
    let output = SvnRunner::new(PathBuf::from("cmd.exe"))
        .run(&os_args(&["/C", "echo", "hola"]), RunOptions::default())
        .await
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "hola --non-interactive"
    );
}

#[test]
fn parse_version_rejects_empty_and_non_numeric_text() {
    assert_eq!(parse_version(""), None);
    assert_eq!(parse_version("abc"), None);
}

#[test]
fn parse_version_rejects_incomplete_or_overlong_versions() {
    assert_eq!(parse_version("1.14"), None);
    assert_eq!(parse_version("1.14.2.1"), None);
    assert_eq!(parse_version("1.14."), None);
}

#[test]
fn parse_version_ignores_vendor_suffix_and_whitespace() {
    let expected = SvnVersion {
        major: 1,
        minor: 14,
        patch: 2,
    };
    assert_eq!(parse_version("  1.14.2-SlikSvn\r\n"), Some(expected));
}

#[test]
fn version_order_is_numeric_not_textual() {
    let nine = parse_version("1.9.7").unwrap();
    let ten = parse_version("1.10.0").unwrap();
    assert!(nine < MIN_VERSION);
    assert!(ten >= MIN_VERSION);
}

#[test]
fn locate_in_reports_not_found_for_empty_or_svnless_directories() {
    let empty = TempDir::new().unwrap();
    assert_eq!(locate_in(None, &[]), Err(LocatorError::NotFound));
    assert_eq!(
        locate_in(None, &[empty.path().to_path_buf()]),
        Err(LocatorError::NotFound)
    );
}

#[test]
fn locate_in_reports_invalid_for_a_missing_manual_path() {
    let missing = PathBuf::from(r"C:\no\existe\svn.exe");
    assert_eq!(
        locate_in(Some(&missing), &[]),
        Err(LocatorError::Invalid(missing.clone()))
    );
}

#[test]
fn locate_in_reports_invalid_when_manual_binary_prints_garbage() {
    let dir = TempDir::new().unwrap();
    let fake = batch_file(&dir, "echo no soy svn");
    assert_eq!(
        locate_in(Some(&fake), &[]),
        Err(LocatorError::Invalid(fake.clone()))
    );
}

#[test]
fn locate_in_rejects_a_client_older_than_1_10() {
    let dir = TempDir::new().unwrap();
    let fake = batch_file(&dir, "echo 1.9.7");
    let found = SvnVersion {
        major: 1,
        minor: 9,
        patch: 7,
    };
    assert_eq!(
        locate_in(Some(&fake), &[]),
        Err(LocatorError::TooOld {
            path: fake.clone(),
            found,
            required: MIN_VERSION
        })
    );
}

#[test]
fn locate_in_accepts_a_manual_client_at_exactly_the_minimum_version() {
    let dir = TempDir::new().unwrap();
    let fake = batch_file(&dir, "echo 1.10.0");
    let binary = locate_in(Some(&fake), &[]).unwrap();
    assert_eq!(binary.version, MIN_VERSION);
}

#[test]
fn locate_in_skips_unusable_directories_and_finds_the_real_client() {
    let empty = TempDir::new().unwrap();
    let real = locate(None).expect("se necesita Subversion >= 1.10");
    let real_dir = real.path.parent().unwrap().to_path_buf();
    let found = locate_in(None, &[empty.path().to_path_buf(), real_dir]).unwrap();
    assert_eq!(found.path, real.path);
    assert!(found.version >= MIN_VERSION);
}

#[test]
fn locate_in_gives_up_on_a_manual_client_that_hangs() {
    let dir = TempDir::new().unwrap();
    let fake = batch_file(&dir, "ping -n 60 127.0.0.1 >nul");
    let started = Instant::now();
    assert_eq!(
        locate_in(Some(&fake), &[]),
        Err(LocatorError::Invalid(fake.clone()))
    );
    assert!(started.elapsed() < PROBE_DEADLINE);
}

#[tokio::test]
async fn run_adds_password_from_stdin_flag_only_when_a_password_is_given() {
    let options = RunOptions {
        password: Some("s3cret".into()),
        ..RunOptions::default()
    };
    let runner = SvnRunner::new(PathBuf::from("cmd.exe"));
    let with = runner
        .run(&os_args(&["/C", "echo", "hola"]), options)
        .await
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&with.stdout).trim(),
        "hola --password-from-stdin --non-interactive"
    );
}

#[test]
fn run_options_debug_never_prints_the_password() {
    let options = RunOptions {
        password: Some("s3cret".into()),
        ..RunOptions::default()
    };
    assert!(!format!("{options:?}").contains("s3cret"));
}

#[test]
fn svn_error_keeps_stdout_exit_code_and_a_fresh_timestamp() {
    let before = SystemTime::now();
    let captured = Captured {
        stdout: "salida".into(),
        stderr: "svn: E170001: x".into(),
        exit_code: Some(1),
    };
    let error = SvnError::from_process(&os_args(&["update"]), captured);
    assert_eq!(error.stdout, "salida");
    assert_eq!(error.exit_code, Some(1));
    assert!(error.timestamp >= before && error.timestamp <= SystemTime::now());
}

#[test]
fn locate_in_reports_too_old_when_the_only_candidate_is_old() {
    let old = TempDir::new().unwrap();
    let old_exe = FakeSvn::with_version("1.9.7").build(old.path());
    let found = SvnVersion {
        major: 1,
        minor: 9,
        patch: 7,
    };
    assert_eq!(
        locate_in(None, &[old.path().to_path_buf()]),
        Err(LocatorError::TooOld {
            path: old_exe,
            found,
            required: MIN_VERSION
        })
    );
}

#[test]
fn locate_in_ignores_an_old_client_when_a_usable_one_follows() {
    let (old, current) = (TempDir::new().unwrap(), TempDir::new().unwrap());
    FakeSvn::with_version("1.9.7").build(old.path());
    let current_exe = FakeSvn::with_version("1.14.2").build(current.path());
    let dirs = [old.path().to_path_buf(), current.path().to_path_buf()];
    assert_eq!(locate_in(None, &dirs).unwrap().path, current_exe);
}

#[test]
fn locate_in_returns_the_first_usable_candidate_in_list_order() {
    let (first, second) = (TempDir::new().unwrap(), TempDir::new().unwrap());
    let first_exe = FakeSvn::with_version("1.12.0").build(first.path());
    FakeSvn::with_version("1.14.2").build(second.path());
    let dirs = [first.path().to_path_buf(), second.path().to_path_buf()];
    assert_eq!(locate_in(None, &dirs).unwrap().path, first_exe);
}

#[test]
fn locate_in_prefers_the_manual_path_over_every_search_directory() {
    let (manual_dir, listed) = (TempDir::new().unwrap(), TempDir::new().unwrap());
    let manual = FakeSvn::with_version("1.11.0").build(manual_dir.path());
    FakeSvn::with_version("1.14.2").build(listed.path());
    let found = locate_in(Some(&manual), &[listed.path().to_path_buf()]).unwrap();
    assert_eq!(found.path, manual);
}

#[test]
fn search_dirs_lists_path_first_then_tortoise_slik_and_apache() {
    let path = std::env::join_paths([r"C:\a", r"C:\b"]).unwrap();
    let dirs = search_dirs(Some(&path), Some(Path::new(r"C:\PF")));
    let expected = [
        r"C:\a",
        r"C:\b",
        r"C:\PF\TortoiseSVN\bin",
        r"C:\PF\SlikSvn\bin",
        r"C:\PF\Apache Subversion\bin",
    ];
    assert_eq!(dirs, expected.map(PathBuf::from));
}

#[test]
fn search_dirs_is_empty_without_path_and_program_files() {
    assert!(search_dirs(None, None).is_empty());
}

#[test]
fn default_search_dirs_are_built_from_the_path_and_program_files_variables() {
    let path = std::env::var_os("PATH");
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let dirs = default_search_dirs();
    assert!(!dirs.is_empty());
    assert_eq!(dirs, search_dirs(path.as_deref(), program_files.as_deref()));
}

#[tokio::test]
async fn run_forces_english_output_so_progress_and_errors_can_be_parsed() {
    let output = SvnRunner::new(PathBuf::from("cmd.exe"))
        .run(
            &os_args(&["/C", "echo", "%LANGUAGE%"]),
            RunOptions::default(),
        )
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("en "));
}

#[test]
fn every_error_kind_has_its_own_readable_message() {
    let kinds = [
        SvnErrorKind::AuthRequired,
        SvnErrorKind::UntrustedCertificate,
        SvnErrorKind::WorkingCopyTooOld,
        SvnErrorKind::WorkingCopyLocked,
        SvnErrorKind::Cancelled,
        SvnErrorKind::TimedOut,
        SvnErrorKind::Other,
    ];
    let messages: std::collections::HashSet<String> =
        kinds.iter().map(|kind| kind.to_string()).collect();
    assert_eq!(messages.len(), kinds.len());
    assert!(messages.iter().all(|message| !message.is_empty()));
}

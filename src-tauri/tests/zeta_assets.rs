#![cfg(windows)]

use std::fs;

use dakedaduck_svn_lib::app::zeta_assets::{CHUNK_BYTES, ZetaAssets, is_listed};
use dakedaduck_svn_lib::commands::zeta_protocol::handle;
use tauri::http::header::{self, HeaderMap};
use tauri::http::{Method, Request, Response, StatusCode};
use tempfile::TempDir;

const HOST: &str = "http://zeta-assets.localhost";
const DISK_NAMES: [&str; 5] = [
    "soffice.js",
    "soffice.wasm",
    "soffice.data",
    "soffice.data.js.metadata",
    "zeta.js",
];
const EMBEDDED_NAMES: [&str; 3] = ["host.html", "host.js", "office_thread.js"];
const BIG_LEN: u64 = CHUNK_BYTES * 2 + 10;
const PATTERN_PERIOD: u64 = 251;
const PAGE_CONFIG: &str = include_str!("../tauri.conf.json");

struct Fixture {
    _guard: TempDir,
    assets: ZetaAssets,
}

fn pattern(len: u64) -> Vec<u8> {
    (0..len).map(|n| (n % PATTERN_PERIOD) as u8).collect()
}

fn salted(name: &str) -> Vec<u8> {
    let salt = name.bytes().map(u64::from).sum::<u64>();
    (0..100u64)
        .map(|n| ((n + salt) % PATTERN_PERIOD) as u8)
        .collect()
}

fn fixture() -> Fixture {
    let guard = tempfile::tempdir().unwrap();
    for name in DISK_NAMES {
        let bytes = if name == "soffice.wasm" {
            pattern(BIG_LEN)
        } else {
            salted(name)
        };
        fs::write(guard.path().join(name), bytes).unwrap();
    }
    let assets = ZetaAssets::new(guard.path().to_path_buf());
    Fixture {
        _guard: guard,
        assets,
    }
}

fn request(method: Method, path: &str, range: Option<&str>) -> Request<Vec<u8>> {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("{HOST}{path}"));
    if let Some(range) = range {
        builder = builder.header(header::RANGE, range);
    }
    builder.body(Vec::new()).unwrap()
}

fn get(fx: &Fixture, path: &str, range: Option<&str>) -> Response<Vec<u8>> {
    handle(Some(&fx.assets), &request(Method::GET, path, range))
}

fn text(headers: &HeaderMap, name: header::HeaderName) -> String {
    headers
        .get(name)
        .map(|value| value.to_str().unwrap().to_owned())
        .unwrap_or_default()
}

fn assert_hardened(response: &Response<Vec<u8>>) {
    let headers = response.headers();
    assert_eq!(
        text(headers, "cross-origin-resource-policy".parse().unwrap()),
        "cross-origin"
    );
    assert_eq!(
        text(headers, "cross-origin-embedder-policy".parse().unwrap()),
        "require-corp"
    );
    assert_eq!(text(headers, header::X_CONTENT_TYPE_OPTIONS), "nosniff");
    assert_eq!(text(headers, header::CACHE_CONTROL), "no-store");
    let policy = text(headers, header::CONTENT_SECURITY_POLICY);
    assert!(policy.contains("'unsafe-eval'") && policy.contains("'wasm-unsafe-eval'"));
    assert!(policy.contains("frame-src 'none'") && policy.contains("connect-src 'self'"));
}

#[test]
fn only_the_eight_listed_names_exist() {
    for name in DISK_NAMES.iter().chain(&EMBEDDED_NAMES) {
        assert!(is_listed(name), "{name}");
    }
    let hostile = [
        "",
        "/",
        "..",
        "../host.js",
        "..\\host.js",
        "%2e%2e/host.js",
        "host.js/",
        "sub/host.js",
        "HOST.JS",
        "Soffice.Wasm",
        "soffice.data.br",
        "soffice.wasm.br",
        "host.htm",
        "host.js ",
        "host.js\0",
        "C:/Windows/win.ini",
    ];
    for name in hostile {
        assert!(!is_listed(name), "{name:?}");
    }
}

#[test]
fn unlisted_and_hostile_paths_are_404_with_the_hardening_headers() {
    let fx = fixture();
    for path in [
        "/",
        "/..%2fCargo.toml",
        "/%2e%2e/host.js",
        "/sub/host.js",
        "/soffice.wasm.br",
        "/HOST.JS",
        "/Cargo.toml",
    ] {
        let response = get(&fx, path, None);
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert!(response.body().is_empty(), "{path}");
        assert_hardened(&response);
    }
}

#[test]
fn only_get_and_head_are_allowed() {
    let fx = fixture();
    for method in [
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::OPTIONS,
        Method::PATCH,
    ] {
        let response = handle(Some(&fx.assets), &request(method.clone(), "/host.js", None));
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
        assert_eq!(text(response.headers(), header::ALLOW), "GET, HEAD");
        assert_hardened(&response);
    }
}

#[test]
fn a_missing_resource_folder_gives_404_for_disk_files_but_the_host_still_loads() {
    let response = handle(None, &request(Method::GET, "/host.html", None));
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let empty = ZetaAssets::new(std::path::PathBuf::from(r"C:\no\existe\jamas"));
    let wasm = handle(
        Some(&empty),
        &request(Method::GET, "/soffice.wasm", Some("bytes=0-9")),
    );
    assert_eq!(wasm.status(), StatusCode::NOT_FOUND);
    let host = handle(Some(&empty), &request(Method::GET, "/host.html", None));
    assert_eq!(host.status(), StatusCode::OK);
}

#[test]
fn a_big_file_without_range_is_refused_instead_of_loaded_whole() {
    let fx = fixture();
    let response = get(&fx, "/soffice.wasm", None);
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(response.body().is_empty());
    assert_hardened(&response);
}

#[test]
fn ranges_come_in_chunks_of_at_most_eight_mebibytes() {
    let fx = fixture();
    let bytes = pattern(BIG_LEN);
    let first = get(&fx, "/soffice.wasm", Some("bytes=0-99999999"));
    assert_eq!(first.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(first.body().len() as u64, CHUNK_BYTES);
    assert_eq!(first.body().as_slice(), &bytes[..CHUNK_BYTES as usize]);
    let content_range = text(first.headers(), header::CONTENT_RANGE);
    assert_eq!(
        content_range,
        format!("bytes 0-{}/{BIG_LEN}", CHUNK_BYTES - 1)
    );
    assert_hardened(&first);
}

#[test]
fn the_last_chunk_is_shorter_and_chunks_rebuild_the_file() {
    let fx = fixture();
    let mut rebuilt: Vec<u8> = Vec::new();
    while (rebuilt.len() as u64) < BIG_LEN {
        let from = rebuilt.len();
        let response = get(&fx, "/soffice.wasm", Some(&format!("bytes={from}-")));
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        rebuilt.extend_from_slice(response.body());
    }
    assert_eq!(rebuilt, pattern(BIG_LEN));
}

#[test]
fn invalid_and_unsatisfiable_ranges_are_rejected() {
    let fx = fixture();
    let bad = ["bytes=abc", "bytes=5-2", "bytes=-"];
    for range in bad {
        assert_eq!(
            get(&fx, "/soffice.wasm", Some(range)).status(),
            StatusCode::BAD_REQUEST,
            "{range}"
        );
    }
    for range in ["bytes=0-1,5-6", "items=0-1"] {
        let status = get(&fx, "/soffice.wasm", Some(range)).status();
        assert_eq!(status, StatusCode::RANGE_NOT_SATISFIABLE, "{range}");
    }
    let past = get(&fx, "/soffice.wasm", Some(&format!("bytes={BIG_LEN}-")));
    assert_eq!(past.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(
        text(past.headers(), header::CONTENT_RANGE),
        format!("bytes */{BIG_LEN}")
    );
}

#[test]
fn small_files_are_served_whole_with_the_right_mime() {
    let fx = fixture();
    let cases = [
        ("/host.html", "text/html; charset=utf-8"),
        ("/host.js", "text/javascript; charset=utf-8"),
        ("/office_thread.js", "text/javascript; charset=utf-8"),
        ("/soffice.js", "text/javascript; charset=utf-8"),
        ("/zeta.js", "text/javascript; charset=utf-8"),
        ("/soffice.data.js.metadata", "application/json"),
    ];
    for (path, mime) in cases {
        let response = get(&fx, path, None);
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            text(response.headers(), header::CONTENT_TYPE),
            mime,
            "{path}"
        );
        let name = path.trim_start_matches('/');
        if DISK_NAMES.contains(&name) {
            assert_eq!(response.body(), &salted(name), "{path}");
        } else {
            assert!(!response.body().is_empty(), "{path}");
        }
        assert_hardened(&response);
    }
    let wasm = get(&fx, "/soffice.wasm", Some("bytes=0-3"));
    assert_eq!(
        text(wasm.headers(), header::CONTENT_TYPE),
        "application/wasm"
    );
    let data = get(&fx, "/soffice.data", Some("bytes=0-3"));
    assert_eq!(
        text(data.headers(), header::CONTENT_TYPE),
        "application/octet-stream"
    );
}

#[test]
fn the_embedded_pages_match_the_files_in_the_repository() {
    let fx = fixture();
    for name in EMBEDDED_NAMES {
        let served = get(&fx, &format!("/{name}"), None);
        let source = fs::read(format!("assets/zeta/{name}")).unwrap();
        assert_eq!(served.body(), &source, "{name}");
    }
}

#[test]
fn head_returns_the_headers_without_a_body() {
    let fx = fixture();
    let response = handle(Some(&fx.assets), &request(Method::HEAD, "/host.html", None));
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.body().is_empty());
    assert_hardened(&response);
}

#[test]
fn the_page_policy_never_grants_eval_or_the_zeta_origin_to_scripts() {
    let config: serde_json::Value = serde_json::from_str(PAGE_CONFIG).unwrap();
    let security = &config["app"]["security"];
    for key in ["csp", "devCsp"] {
        let policy = security[key].as_str().unwrap();
        assert!(!policy.contains("unsafe-eval"), "{key}");
        for directive in policy.split(';').map(str::trim) {
            let (name, _) = directive.split_once(' ').unwrap_or((directive, ""));
            let mentions_zeta = directive.contains("zeta-assets");
            assert_eq!(mentions_zeta, name == "frame-src", "{key}: {directive}");
        }
        assert!(
            policy.contains("frame-src http://zeta-assets.localhost"),
            "{key}"
        );
    }
}

#[test]
fn the_resources_are_declared_as_a_directory_map() {
    let config: serde_json::Value = serde_json::from_str(PAGE_CONFIG).unwrap();
    let resources = &config["bundle"]["resources"];
    assert_eq!(resources["resources/zetaoffice"], "zetaoffice");
}

const TEST_HOOK_NAMES: [&str; 2] = ["office_test.js", "office_test_thread.js"];

#[test]
fn the_test_hooks_exist_only_in_debug_and_e2e_builds() {
    let fx = fixture();
    let expected = cfg!(any(debug_assertions, feature = "e2e-config-dir"));
    for name in TEST_HOOK_NAMES {
        assert_eq!(is_listed(name), expected, "{name}");
        let response = get(&fx, &format!("/{name}"), None);
        let status = if expected {
            StatusCode::OK
        } else {
            StatusCode::NOT_FOUND
        };
        assert_eq!(response.status(), status, "{name}");
        assert_hardened(&response);
        if expected {
            let source = fs::read(format!("assets/zeta/{name}")).unwrap();
            assert_eq!(response.body(), &source, "{name}");
        }
    }
}

#[test]
fn the_chunk_size_is_the_one_the_host_script_asks_for() {
    let host = fs::read_to_string("assets/zeta/host.js").unwrap();
    let megabytes = CHUNK_BYTES / (1024 * 1024);
    assert!(host.contains(&format!("const CHUNK_BYTES = {megabytes} * 1024 * 1024;")));
}

#[test]
fn an_io_error_other_than_missing_answers_500() {
    let fx = fixture();
    let path = fx._guard.path().join("soffice.js");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let response = get(&fx, "/soffice.js", None);
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_hardened(&response);
}

#[test]
fn every_response_says_it_accepts_ranges() {
    let fx = fixture();
    let responses = [
        get(&fx, "/soffice.js", None),
        get(&fx, "/soffice.wasm", Some("bytes=0-9")),
        get(&fx, "/nada.js", None),
        handle(
            Some(&fx.assets),
            &request(Method::POST, "/soffice.js", None),
        ),
    ];
    for response in responses {
        assert_eq!(text(response.headers(), header::ACCEPT_RANGES), "bytes");
    }
}

#[test]
fn the_document_policy_closes_plugins_and_the_base_url() {
    let fx = fixture();
    let policy = text(
        get(&fx, "/host.html", None).headers(),
        header::CONTENT_SECURITY_POLICY,
    );
    let directives: Vec<&str> = policy.split(';').map(str::trim).collect();
    for expected in ["default-src 'self'", "object-src 'none'", "base-uri 'none'"] {
        assert!(directives.contains(&expected), "{expected}: {policy}");
    }
}

#[test]
fn an_invalid_range_is_refused_before_looking_for_the_file() {
    let fx = fixture();
    let response = get(&fx, "/no-existe.js", Some("bytes=a-b"));
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn the_page_scripts_come_only_from_the_app_itself() {
    let config: serde_json::Value = serde_json::from_str(PAGE_CONFIG).unwrap();
    let security = &config["app"]["security"];
    for key in ["csp", "devCsp"] {
        let policy = security[key].as_str().unwrap();
        let scripts: Vec<&str> = policy
            .split(';')
            .map(str::trim)
            .filter(|directive| directive.starts_with("script-src"))
            .collect();
        assert_eq!(scripts, ["script-src 'self'"], "{key}");
    }
}

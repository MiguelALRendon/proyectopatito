#![cfg(windows)]

use std::fs::{self, File};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

use dakedaduck_svn_lib::app::files::FileService;
use dakedaduck_svn_lib::app::range::MAX_RESPONSE_BYTES;
use dakedaduck_svn_lib::app::workspace::Workspace;
use dakedaduck_svn_lib::commands::protocol::handle;
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use tauri::http::header::{self, HeaderMap};
use tauri::http::{Method, Request, Response, StatusCode};
use tempfile::TempDir;

const HOST: &str = "http://workspace-file.localhost";
const APP_ORIGIN: &str = "http://tauri.localhost";
const DEV_ORIGIN: &str = "http://localhost:1420";
const STRANGER_ORIGIN: &str = "http://evil.example";
const PNG_HEADER: [u8; 33] = [
    0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89,
];
const DIGITS: &[u8] = b"0123456789";
const SPECIAL_NAME: &str = "a#b%c d ñ.txt";
const SECRET: &[u8] = b"fuera del workspace";

struct Fixture {
    _guard: TempDir,
    root: PathBuf,
    service: FileService,
}

fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

fn fixture() -> Fixture {
    let guard = tempfile::tempdir().unwrap();
    let parent = plain_path(fs::canonicalize(guard.path()).unwrap());
    let root = parent.join("svn");
    fs::create_dir(&root).unwrap();
    fs::write(parent.join("secret.txt"), SECRET).unwrap();
    fs::write(root.join("digits.txt"), DIGITS).unwrap();
    fs::write(root.join("pixel.png"), PNG_HEADER).unwrap();
    fs::write(root.join(SPECIAL_NAME), "nombre especial").unwrap();
    fs::create_dir_all(root.join("sub")).unwrap();
    fs::write(root.join("sub").join("inner.txt"), "dentro").unwrap();
    for admin in [".svn", "_svn"] {
        fs::create_dir(root.join(admin)).unwrap();
        fs::write(root.join(admin).join("wc.db"), "secreto").unwrap();
    }
    let service = FileService::new(Workspace::new(&root).unwrap(), Arc::default());
    Fixture {
        _guard: guard,
        root,
        service,
    }
}

fn request(method: Method, path: &str, headers: &[(&str, &str)]) -> Request<Vec<u8>> {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("{HOST}{path}"));
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    builder.body(Vec::new()).unwrap()
}

impl Fixture {
    fn send(&self, method: Method, path: &str, headers: &[(&str, &str)]) -> Response<Vec<u8>> {
        handle(Some(&self.service), &request(method, path, headers))
    }

    fn get(&self, path: &str) -> Response<Vec<u8>> {
        self.send(Method::GET, path, &[])
    }

    fn ranged(&self, path: &str, range: &str) -> Response<Vec<u8>> {
        self.send(Method::GET, path, &[("range", range)])
    }
}

fn header_of<'a>(response: &'a Response<Vec<u8>>, name: &str) -> Option<&'a str> {
    response
        .headers()
        .get(name)
        .map(|value| value.to_str().unwrap())
}

fn run_cmd(args: &[&str]) -> bool {
    Command::new("cmd")
        .arg("/C")
        .args(args)
        .output()
        .unwrap()
        .status
        .success()
}

fn encode_segment(name: &str) -> String {
    utf8_percent_encode(name, NON_ALPHANUMERIC).to_string()
}

fn headers_without_cors(headers: &HeaderMap) -> bool {
    !headers.contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN)
}

#[test]
fn paths_that_climb_out_of_the_root_are_forbidden() {
    let fx = fixture();
    for path in [
        "/..",
        "/../secret.txt",
        "/%2e%2e",
        "/%2E%2E",
        "/%2e%2e/secret.txt",
        "/%2e%2e%2fsecret.txt",
        "/%2E%2E%5C",
        "/%2E%2E%5Csecret.txt",
        "/..%5Csecret.txt",
        "/sub/..%2F..%2Fsecret.txt",
        "/sub%5C..%5C..%5Csecret.txt",
    ] {
        assert_eq!(fx.get(path).status(), StatusCode::FORBIDDEN, "{path}");
    }
}

#[test]
fn backslashes_absolute_paths_and_drives_are_forbidden() {
    let fx = fixture();
    let outside = encode_segment(
        &fx.root
            .parent()
            .unwrap()
            .join("secret.txt")
            .to_string_lossy(),
    );
    let absolute = format!("/{outside}");
    let rooted_here = encode_segment(&fx.root.join("digits.txt").to_string_lossy());
    for path in [
        "/%5Csecret.txt",
        "/%5C%5Cserver%5Cshare%5Cx",
        "/C:/Windows/win.ini",
        "//C:/Windows/win.ini",
        "/C%3A%5CWindows%5Cwin.ini",
        "/c%3Awin.ini",
        absolute.as_str(),
        &format!("/{rooted_here}"),
    ] {
        assert_eq!(fx.get(path).status(), StatusCode::FORBIDDEN, "{path}");
    }
}

#[test]
fn alternate_data_streams_and_device_names_are_forbidden() {
    let fx = fixture();
    for path in [
        "/digits.txt%3Astream",
        "/digits.txt:stream",
        "/digits.txt%3A%3A%24DATA",
        "/NUL",
        "/sub/COM1.txt",
        "/trailing.",
        "/trailing%20",
    ] {
        assert_eq!(fx.get(path).status(), StatusCode::FORBIDDEN, "{path}");
    }
}

#[test]
fn subversion_admin_areas_are_forbidden_in_any_case_and_depth() {
    let fx = fixture();
    for path in [
        "/.svn",
        "/.svn/wc.db",
        "/.SVN/wc.db",
        "/.Svn/wc.db",
        "/_svn/wc.db",
        "/_SVN/wc.db",
        "/%2esvn/wc.db",
        "/sub/.svn/wc.db",
    ] {
        assert_eq!(fx.get(path).status(), StatusCode::FORBIDDEN, "{path}");
    }
}

#[test]
fn a_junction_that_leads_outside_the_root_is_forbidden() {
    let fx = fixture();
    let outside = fx.root.parent().unwrap().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("loot.txt"), SECRET).unwrap();
    let link = fx.root.join("escape");
    assert!(run_cmd(&[
        "mklink",
        "/J",
        &link.to_string_lossy(),
        &outside.to_string_lossy()
    ]));
    assert_eq!(fx.get("/escape/loot.txt").status(), StatusCode::FORBIDDEN);
}

#[test]
fn a_cloud_only_file_is_refused_without_reading_it() {
    let fx = fixture();
    let path = fx.root.join("nube.txt");
    fs::write(&path, "en la nube").unwrap();
    assert!(run_cmd(&["attrib", "+O", &path.to_string_lossy()]));
    let response = fx.get("/nube.txt");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(response.body().is_empty());
}

#[test]
fn missing_files_directories_and_unrepresentable_names_are_not_found() {
    let fx = fixture();
    for path in [
        "/missing.txt",
        "/sub/missing.txt",
        "/digits.txt/child",
        "/sub",
        "/",
        "/a%3Fb.txt",
        "/a%2Ab.txt",
        "/a%22b.txt",
        "/a%3Cb.txt",
    ] {
        assert_eq!(fx.get(path).status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[test]
fn undecodable_paths_are_a_bad_request() {
    let fx = fixture();
    assert_eq!(fx.get("/%FF%FE.txt").status(), StatusCode::BAD_REQUEST);
}

#[test]
fn a_nul_byte_in_the_path_never_reaches_the_disk() {
    let fx = fixture();
    assert_eq!(fx.get("/digits.txt%00.png").status(), StatusCode::NOT_FOUND);
}

#[test]
fn methods_other_than_get_head_and_options_are_not_allowed() {
    let fx = fixture();
    for method in [Method::POST, Method::PUT, Method::DELETE, Method::PATCH] {
        let response = fx.send(method.clone(), "/digits.txt", &[]);
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
        assert_eq!(header_of(&response, "allow"), Some("GET, HEAD, OPTIONS"));
    }
}

#[test]
fn a_missing_workspace_answers_not_found() {
    let response = handle(None, &request(Method::GET, "/digits.txt", &[]));
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[test]
fn ranges_out_of_the_file_answer_416_with_the_total() {
    let fx = fixture();
    for range in ["bytes=10-", "bytes=10-20", "bytes=-0", "bytes=99-"] {
        let response = fx.ranged("/digits.txt", range);
        assert_eq!(
            response.status(),
            StatusCode::RANGE_NOT_SATISFIABLE,
            "{range}"
        );
        assert_eq!(header_of(&response, "content-range"), Some("bytes */10"));
    }
}

#[test]
fn several_ranges_are_refused_and_malformed_ones_are_a_bad_request() {
    let fx = fixture();
    let several = fx.ranged("/digits.txt", "bytes=0-1,4-5");
    assert_eq!(several.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    for range in ["bytes=a-b", "bytes=5-2", "nonsense", "bytes=-"] {
        let response = fx.ranged("/digits.txt", range);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{range}");
    }
}

#[test]
fn a_range_cannot_unlock_a_forbidden_path() {
    let fx = fixture();
    let response = fx.ranged("/.svn/wc.db", "bytes=0-3");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(response.body().is_empty());
}

#[test]
fn a_whole_file_over_the_cap_is_413_and_a_range_over_the_cap_is_truncated() {
    let fx = fixture();
    let big = File::create(fx.root.join("big.bin")).unwrap();
    big.set_len(MAX_RESPONSE_BYTES + 1).unwrap();
    let whole = fx.get("/big.bin");
    assert_eq!(whole.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(whole.body().is_empty());
    let partial = fx.ranged("/big.bin", "bytes=0-");
    assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(partial.body().len() as u64, MAX_RESPONSE_BYTES);
    let last = MAX_RESPONSE_BYTES - 1;
    let expected = format!("bytes 0-{last}/{}", MAX_RESPONSE_BYTES + 1);
    assert_eq!(
        header_of(&partial, "content-range"),
        Some(expected.as_str())
    );
}

#[test]
fn a_file_exactly_at_the_cap_is_served_whole() {
    let fx = fixture();
    let exact = File::create(fx.root.join("exact.bin")).unwrap();
    exact.set_len(MAX_RESPONSE_BYTES).unwrap();
    let response = fx.get("/exact.bin");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body().len() as u64, MAX_RESPONSE_BYTES);
}

#[test]
fn an_origin_outside_the_list_never_gets_cors_headers() {
    let fx = fixture();
    for origin in [
        STRANGER_ORIGIN,
        "null",
        "https://tauri.localhost",
        "*",
        "http://tauri.localhost.evil.example",
    ] {
        let response = fx.send(Method::GET, "/digits.txt", &[("origin", origin)]);
        assert_eq!(response.status(), StatusCode::OK, "{origin}");
        assert!(headers_without_cors(response.headers()), "{origin}");
        assert!(
            !response
                .headers()
                .contains_key(header::ACCESS_CONTROL_EXPOSE_HEADERS)
        );
    }
}

#[test]
fn error_responses_to_an_unlisted_origin_have_no_cors_headers_either() {
    let fx = fixture();
    let response = fx.send(Method::GET, "/.svn/wc.db", &[("origin", STRANGER_ORIGIN)]);
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(headers_without_cors(response.headers()));
}

#[test]
fn the_dev_origin_is_listed_only_with_debug_assertions() {
    let fx = fixture();
    let response = fx.send(Method::GET, "/digits.txt", &[("origin", DEV_ORIGIN)]);
    let reflected = header_of(&response, "access-control-allow-origin");
    assert_eq!(reflected.is_some(), cfg!(debug_assertions));
    assert!(reflected.is_none_or(|value| value == DEV_ORIGIN));
}

#[test]
fn the_preflight_answers_204_without_touching_the_disk() {
    let fx = fixture();
    let headers = [
        ("origin", APP_ORIGIN),
        ("access-control-request-method", "GET"),
        ("access-control-request-headers", "range"),
    ];
    let response = fx.send(Method::OPTIONS, "/does/not/exist", &headers);
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        header_of(&response, "access-control-allow-origin"),
        Some(APP_ORIGIN)
    );
    assert_eq!(
        header_of(&response, "access-control-allow-headers"),
        Some("Range")
    );
    assert_eq!(
        header_of(&response, "access-control-allow-methods"),
        Some("GET, HEAD, OPTIONS")
    );
    assert!(response.body().is_empty());
}

#[test]
fn the_preflight_from_an_unlisted_origin_grants_nothing() {
    let fx = fixture();
    let response = fx.send(
        Method::OPTIONS,
        "/digits.txt",
        &[("origin", STRANGER_ORIGIN)],
    );
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(headers_without_cors(response.headers()));
}

#[test]
fn every_response_carries_the_hardening_headers() {
    let fx = fixture();
    let paths = ["/digits.txt", "/missing.txt", "/.svn/wc.db", "/%2e%2e"];
    for path in paths {
        let response = fx.get(path);
        assert_eq!(
            header_of(&response, "accept-ranges"),
            Some("bytes"),
            "{path}"
        );
        assert_eq!(
            header_of(&response, "x-content-type-options"),
            Some("nosniff")
        );
        assert_eq!(header_of(&response, "cache-control"), Some("no-store"));
        assert_eq!(
            header_of(&response, "cross-origin-resource-policy"),
            Some("cross-origin")
        );
        assert_eq!(
            header_of(&response, "content-security-policy"),
            Some("default-src 'none'; sandbox")
        );
        assert_eq!(header_of(&response, "vary"), Some("Origin"));
    }
}

#[test]
fn the_cross_origin_resource_policy_is_on_every_status_and_to_every_origin() {
    let fx = fixture();
    let big = File::create(fx.root.join("big.bin")).unwrap();
    big.set_len(MAX_RESPONSE_BYTES + 1).unwrap();
    let origins = [None, Some(APP_ORIGIN), Some(STRANGER_ORIGIN)];
    let cases: [(Method, &str, Option<&str>, StatusCode); 12] = [
        (Method::GET, "/digits.txt", None, StatusCode::OK),
        (
            Method::GET,
            "/digits.txt",
            Some("bytes=0-3"),
            StatusCode::PARTIAL_CONTENT,
        ),
        (
            Method::GET,
            "/digits.txt",
            Some("bytes=99-"),
            StatusCode::RANGE_NOT_SATISFIABLE,
        ),
        (
            Method::GET,
            "/digits.txt",
            Some("nonsense"),
            StatusCode::BAD_REQUEST,
        ),
        (Method::GET, "/missing.txt", None, StatusCode::NOT_FOUND),
        (Method::GET, "/.svn/wc.db", None, StatusCode::FORBIDDEN),
        (Method::GET, "/big.bin", None, StatusCode::PAYLOAD_TOO_LARGE),
        (Method::HEAD, "/digits.txt", None, StatusCode::OK),
        (Method::OPTIONS, "/digits.txt", None, StatusCode::NO_CONTENT),
        (
            Method::POST,
            "/digits.txt",
            None,
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        (
            Method::DELETE,
            "/digits.txt",
            None,
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        (Method::GET, "/%2e%2e", None, StatusCode::FORBIDDEN),
    ];
    for (method, path, range, status) in cases {
        for origin in origins {
            let mut headers = Vec::new();
            headers.extend(range.map(|value| ("range", value)));
            headers.extend(origin.map(|value| ("origin", value)));
            let response = fx.send(method.clone(), path, &headers);
            let label = format!("{method} {path} {range:?} {origin:?}");
            assert_eq!(response.status(), status, "{label}");
            assert_eq!(
                header_of(&response, "cross-origin-resource-policy"),
                Some("cross-origin"),
                "{label}"
            );
        }
    }
}

#[test]
fn a_missing_workspace_still_carries_the_cross_origin_resource_policy() {
    let response = handle(None, &request(Method::GET, "/digits.txt", &[]));
    assert_eq!(
        header_of(&response, "cross-origin-resource-policy"),
        Some("cross-origin")
    );
}

#[test]
fn head_returns_the_headers_of_get_without_a_body() {
    let fx = fixture();
    let response = fx.send(Method::HEAD, "/digits.txt", &[]);
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header_of(&response, "content-length"), Some("10"));
    assert!(response.body().is_empty());
}

#[test]
fn a_ranged_head_reports_the_partial_headers() {
    let fx = fixture();
    let response = fx.send(Method::HEAD, "/digits.txt", &[("range", "bytes=2-4")]);
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(header_of(&response, "content-range"), Some("bytes 2-4/10"));
    assert!(response.body().is_empty());
}

#[test]
fn a_whole_file_is_served_with_its_sniffed_mime() {
    let fx = fixture();
    let text = fx.get("/digits.txt");
    assert_eq!(text.status(), StatusCode::OK);
    assert_eq!(text.body(), DIGITS);
    assert_eq!(header_of(&text, "content-type"), Some("text/plain"));
    assert_eq!(header_of(&text, "content-length"), Some("10"));
    assert!(!text.headers().contains_key(header::CONTENT_RANGE));
    let image = fx.get("/pixel.png");
    assert_eq!(header_of(&image, "content-type"), Some("image/png"));
    assert_eq!(image.body(), &PNG_HEADER);
}

#[test]
fn the_three_range_forms_return_the_right_slice_as_206() {
    let fx = fixture();
    let cases: [(&str, &[u8], &str); 4] = [
        ("bytes=0-", DIGITS, "bytes 0-9/10"),
        ("bytes=2-4", b"234", "bytes 2-4/10"),
        ("bytes=-3", b"789", "bytes 7-9/10"),
        ("bytes=8-100", b"89", "bytes 8-9/10"),
    ];
    for (range, expected, content_range) in cases {
        let response = fx.ranged("/digits.txt", range);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT, "{range}");
        assert_eq!(response.body().as_slice(), expected, "{range}");
        assert_eq!(header_of(&response, "content-range"), Some(content_range));
        assert_eq!(
            header_of(&response, "content-length"),
            Some(expected.len().to_string().as_str())
        );
    }
}

#[test]
fn a_listed_origin_is_reflected_and_exposes_the_range_headers() {
    let fx = fixture();
    let response = fx.send(Method::GET, "/digits.txt", &[("origin", APP_ORIGIN)]);
    assert_eq!(
        header_of(&response, "access-control-allow-origin"),
        Some(APP_ORIGIN)
    );
    assert_eq!(
        header_of(&response, "access-control-expose-headers"),
        Some("Content-Range, Accept-Ranges, Content-Length")
    );
}

#[test]
fn names_with_special_characters_are_served_from_their_encoded_url() {
    let fx = fixture();
    let encoded = encode_segment(SPECIAL_NAME);
    let response = fx.get(&format!("/{encoded}"));
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body().as_slice(), "nombre especial".as_bytes());
}

#[test]
fn a_nested_relative_path_is_served_without_its_leading_slash() {
    let fx = fixture();
    let response = fx.get("/sub/inner.txt");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body().as_slice(), "dentro".as_bytes());
}

#[test]
fn a_range_header_that_is_not_text_answers_400() {
    let fx = fixture();
    let mut request = request(Method::GET, "/digits.txt", &[]);
    let unreadable = tauri::http::HeaderValue::from_bytes(&[0xFF, 0xFE]).unwrap();
    request.headers_mut().insert(header::RANGE, unreadable);
    let response = handle(Some(&fx.service), &request);
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn an_invalid_range_is_refused_before_looking_for_the_file() {
    let fx = fixture();
    let response = fx.ranged("/no-existe.bin", "bytes=a-b");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

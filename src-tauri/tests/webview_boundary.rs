use dakedaduck_svn_lib::commands::webview::is_own_origin;
use tauri::Url;

const PROD_HOST: &str = "http://tauri.localhost";
const DEV_URL: &str = "http://localhost:1420/";

fn url(text: &str) -> Url {
    Url::parse(text).unwrap()
}

fn allowed(text: &str, dev: bool) -> bool {
    is_own_origin(&url(text), dev)
}

#[test]
fn hostile_and_foreign_urls_are_never_own_origin() {
    let hostile = [
        "https://tauri.localhost/",
        "http://tauri.localhost.evil.com/",
        "http://evil.com/tauri.localhost",
        "http://tauri.localhost@evil.com/",
        "http://user:pass@tauri.localhost/",
        "http://user@tauri.localhost/",
        "http://tauri.localhost:8080/",
        "http://evil.com/",
        "https://example.com/",
        "file:///C:/Windows/win.ini",
        "ftp://tauri.localhost/",
        "data:text/html,hola",
        "about:blank",
        "javascript:alert(1)",
        "blob:http://tauri.localhost/1234",
        "http://zeta-assets.localhost/host.html",
        "http://workspace-file.localhost/a.txt",
        "http://ipc.localhost/",
        "http://localhost:1421/",
        "http://localhost/",
        "http://127.0.0.1:1420/",
        "ws://localhost:1420/",
    ];
    for text in hostile {
        assert!(!allowed(text, false), "{text}");
        assert!(!allowed(text, true) || text == DEV_URL, "{text}");
    }
}

#[test]
fn the_app_origin_is_allowed_with_any_path_query_or_fragment() {
    for path in ["/", "/index.html", "/?a=1", "/#/ruta", "/assets/app.js"] {
        assert!(allowed(&format!("{PROD_HOST}{path}"), false), "{path}");
    }
}

#[test]
fn the_dev_server_is_allowed_only_when_asked() {
    assert!(allowed(DEV_URL, true));
    assert!(!allowed(DEV_URL, false));
    assert!(allowed("http://localhost:1420/src/main.ts", true));
}

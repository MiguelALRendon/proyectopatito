use tauri::webview::NewWindowResponse;
use tauri::{App, Runtime, Url, WebviewWindowBuilder};

const APP_HOST: &str = "tauri.localhost";
const DEV_HOST: &str = "localhost";
const DEV_PORT: u16 = 1420;
const WINDOW_INDEX: usize = 0;

pub fn is_own_origin(url: &Url, allow_dev_server: bool) -> bool {
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let host = url.host_str();
    let is_app = host == Some(APP_HOST) && url.port().is_none();
    let is_dev = allow_dev_server && host == Some(DEV_HOST) && url.port() == Some(DEV_PORT);
    is_app || is_dev
}

pub fn create_main_window<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let config = &app.config().app.windows[WINDOW_INDEX];
    WebviewWindowBuilder::from_config(app.handle(), config)?
        .on_navigation(|url| is_own_origin(url, cfg!(debug_assertions)))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .build()?;
    Ok(())
}

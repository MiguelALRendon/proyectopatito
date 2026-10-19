use serde::Serialize;

const LICENSES: &str = include_str!("../../../THIRD_PARTY_LICENSES.md");

#[derive(Debug, Clone, Serialize)]
pub struct AppAbout {
    pub version: &'static str,
    pub licenses: &'static str,
}

#[tauri::command]
pub fn app_about() -> AppAbout {
    AppAbout {
        version: env!("CARGO_PKG_VERSION"),
        licenses: LICENSES,
    }
}

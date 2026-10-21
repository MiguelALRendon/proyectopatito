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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_about_answer_carries_the_crate_version_and_the_whole_licenses_file() {
        let about = app_about();
        assert_eq!(about.version, env!("CARGO_PKG_VERSION"));
        let on_disk = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../THIRD_PARTY_LICENSES.md"
        ))
        .unwrap();
        assert_eq!(about.licenses, on_disk);
        assert!(about.licenses.contains("Licencias de terceros"));
    }
}

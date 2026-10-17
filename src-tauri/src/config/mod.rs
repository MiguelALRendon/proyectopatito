mod ui;

use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub use ui::{
    Favorite, FolderView, SortDirection, SortKey, Tab, TabKind, UI_STATE_VERSION, UiState,
    ViewColumn, ViewMode,
};

pub const CONFIG_FILE_NAME: &str = "config.json";
pub const CONFIG_DIR_ENV: &str = "DAKEDADUCK_CONFIG_DIR";
pub const IS_CONFIG_DIR_OVERRIDE_ALLOWED: bool =
    cfg!(any(debug_assertions, feature = "e2e-config-dir"));
const CORRUPT_EXTENSION: &str = "json.bad";
const TEMP_EXTENSION: &str = "json.tmp";

pub fn resolve_config_dir(
    override_dir: Option<OsString>,
    default_dir: PathBuf,
    is_override_allowed: bool,
) -> PathBuf {
    let candidate = override_dir
        .filter(|_| is_override_allowed)
        .map(PathBuf::from);
    match candidate {
        Some(dir) if dir.is_absolute() => dir,
        _ => default_dir,
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default, deserialize_with = "lenient")]
    pub workspace_root: Option<PathBuf>,
    #[serde(default, deserialize_with = "lenient")]
    pub svn_path: Option<PathBuf>,
    #[serde(default, deserialize_with = "ui::lenient_ui_state")]
    pub ui: UiState,
}

fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned + Default,
{
    Ok(serde_json::from_value(Value::deserialize(deserializer)?).unwrap_or_default())
}

#[derive(Debug, Clone)]
pub struct ConfigStore {
    pub path: PathBuf,
}

impl ConfigStore {
    pub fn load(&self) -> io::Result<AppConfig> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(AppConfig::default());
            }
            Err(error) => return Err(error),
        };
        match serde_json::from_slice(&bytes) {
            Ok(config) => Ok(config),
            Err(_) => {
                self.quarantine_corrupt()?;
                Ok(AppConfig::default())
            }
        }
    }

    pub fn save(&self, config: &AppConfig) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temp = self.path.with_extension(TEMP_EXTENSION);
        let written = write_durably(&temp, &serde_json::to_vec_pretty(config)?)
            .and_then(|()| std::fs::rename(&temp, &self.path));
        if written.is_err() {
            std::fs::remove_file(&temp).ok();
        }
        written
    }

    fn quarantine_corrupt(&self) -> io::Result<()> {
        std::fs::rename(&self.path, self.free_quarantine_path())
    }

    fn free_quarantine_path(&self) -> PathBuf {
        let mut candidate = self.path.with_extension(CORRUPT_EXTENSION);
        let mut attempt = 0_u32;
        while candidate.exists() {
            attempt += 1;
            candidate = self
                .path
                .with_extension(format!("{CORRUPT_EXTENSION}.{attempt}"));
        }
        candidate
    }
}

fn write_durably(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

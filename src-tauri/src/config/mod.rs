use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const CONFIG_FILE_NAME: &str = "config.json";
const CORRUPT_EXTENSION: &str = "json.bad";
const TEMP_EXTENSION: &str = "json.tmp";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub workspace_root: Option<PathBuf>,
    #[serde(default)]
    pub svn_path: Option<PathBuf>,
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
        Ok(serde_json::from_slice(&bytes).unwrap_or_else(|_| {
            self.quarantine_corrupt();
            AppConfig::default()
        }))
    }

    pub fn save(&self, config: &AppConfig) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temp = self.path.with_extension(TEMP_EXTENSION);
        std::fs::write(&temp, serde_json::to_vec_pretty(config)?)?;
        std::fs::rename(&temp, &self.path)
    }

    fn quarantine_corrupt(&self) {
        std::fs::rename(&self.path, self.path.with_extension(CORRUPT_EXTENSION)).ok();
    }
}

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub const UI_STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UiState {
    pub version: u32,
    #[serde(default)]
    pub favorites: Vec<Favorite>,
    #[serde(default)]
    pub tabs: Vec<Tab>,
    pub active_tab: Option<String>,
    #[serde(default)]
    pub views: BTreeMap<String, FolderView>,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            version: UI_STATE_VERSION,
            favorites: Vec::new(),
            tabs: Vec::new(),
            active_tab: None,
            views: BTreeMap::new(),
        }
    }
}

impl UiState {
    fn from_value(raw: Value) -> Self {
        let version = raw.get("version").and_then(Value::as_u64);
        if version != Some(u64::from(UI_STATE_VERSION)) {
            return Self::default();
        }
        serde_json::from_value(raw).unwrap_or_default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Favorite {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TabKind {
    Folder,
    Document,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub kind: TabKind,
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewMode {
    Grid,
    List,
    Details,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewColumn {
    Type,
    Size,
    Modified,
    Svn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    Name,
    Type,
    Size,
    Modified,
    Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderView {
    pub mode: ViewMode,
    pub columns: Vec<ViewColumn>,
    pub sort: SortKey,
    pub sort_direction: SortDirection,
    pub updated_ms: u64,
}

pub fn lenient_ui_state<'de, D: Deserializer<'de>>(deserializer: D) -> Result<UiState, D::Error> {
    Ok(UiState::from_value(Value::deserialize(deserializer)?))
}

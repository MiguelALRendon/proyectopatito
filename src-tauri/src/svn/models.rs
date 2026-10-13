use serde::{Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    File,
    Dir,
    None,
    Unknown,
}

impl From<&str> for NodeKind {
    fn from(value: &str) -> Self {
        match value {
            "file" => Self::File,
            "dir" => Self::Dir,
            "none" => Self::None,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusItem {
    None,
    Normal,
    Unversioned,
    Added,
    Modified,
    Deleted,
    Missing,
    Replaced,
    Conflicted,
    Ignored,
    Incomplete,
    External,
    Obstructed,
    Merged,
    Unknown(String),
}

impl StatusItem {
    pub fn as_str(&self) -> &str {
        match self {
            Self::None => "none",
            Self::Normal => "normal",
            Self::Unversioned => "unversioned",
            Self::Added => "added",
            Self::Modified => "modified",
            Self::Deleted => "deleted",
            Self::Missing => "missing",
            Self::Replaced => "replaced",
            Self::Conflicted => "conflicted",
            Self::Ignored => "ignored",
            Self::Incomplete => "incomplete",
            Self::External => "external",
            Self::Obstructed => "obstructed",
            Self::Merged => "merged",
            Self::Unknown(other) => other,
        }
    }
}

impl Serialize for StatusItem {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl From<&str> for StatusItem {
    fn from(value: &str) -> Self {
        match value {
            "none" => Self::None,
            "normal" => Self::Normal,
            "unversioned" => Self::Unversioned,
            "added" => Self::Added,
            "modified" => Self::Modified,
            "deleted" => Self::Deleted,
            "missing" => Self::Missing,
            "replaced" => Self::Replaced,
            "conflicted" => Self::Conflicted,
            "ignored" => Self::Ignored,
            "incomplete" => Self::Incomplete,
            "external" => Self::External,
            "obstructed" => Self::Obstructed,
            "merged" => Self::Merged,
            other => Self::Unknown(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InfoEntry {
    pub path: String,
    pub kind: NodeKind,
    pub revision: u64,
    pub url: String,
    pub relative_url: Option<String>,
    pub repository_root: String,
    pub repository_uuid: String,
    pub working_copy_root: Option<String>,
    pub last_changed_revision: Option<u64>,
    pub last_changed_author: Option<String>,
    pub last_changed_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub item: StatusItem,
    pub props: StatusItem,
    pub revision: Option<u64>,
    pub remote_item: Option<StatusItem>,
    pub remote_props: Option<StatusItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct StatusReport {
    pub entries: Vec<StatusEntry>,
    pub against_revision: Option<u64>,
}

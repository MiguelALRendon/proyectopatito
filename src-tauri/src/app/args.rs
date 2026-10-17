use serde::Deserialize;

use crate::app::files::TextUpdate;
use crate::svn::commands::Depth;

#[derive(Deserialize)]
pub struct CheckoutArgs {
    pub url: String,
    pub dest: String,
    pub revision: Option<u64>,
    pub depth: Depth,
    #[serde(default)]
    pub ignore_externals: bool,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateArgs {
    pub path: String,
    pub revision: Option<u64>,
    #[serde(default)]
    pub ignore_externals: bool,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct CommitArgs {
    pub path: String,
    pub message: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct StatusMapArgs {
    pub wc_root: String,
    #[serde(default)]
    pub remote: bool,
    #[serde(default)]
    pub refresh: bool,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CleanupArgs {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteTextArgs {
    pub path: String,
    #[serde(flatten)]
    pub update: TextUpdate,
}

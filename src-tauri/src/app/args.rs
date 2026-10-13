use serde::Deserialize;

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

#[derive(Debug, Deserialize)]
pub struct CleanupArgs {
    pub path: String,
}

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Deserialize;

const INFO_SUBCOMMAND: &str = "info";
const STATUS_SUBCOMMAND: &str = "status";
const CHECKOUT_SUBCOMMAND: &str = "checkout";
const UPDATE_SUBCOMMAND: &str = "update";
const COMMIT_SUBCOMMAND: &str = "commit";
const CLEANUP_SUBCOMMAND: &str = "cleanup";
const XML_FLAG: &str = "--xml";
const SHOW_UPDATES_FLAG: &str = "--show-updates";
const NO_IGNORE_FLAG: &str = "--no-ignore";
const REVISION_FLAG: &str = "-r";
const DEPTH_FLAG: &str = "--depth";
const IGNORE_EXTERNALS_FLAG: &str = "--ignore-externals";
const USERNAME_FLAG: &str = "--username";
const MESSAGE_FILE_FLAG: &str = "-F";
const ENCODING_FLAG: &str = "--encoding";
const MESSAGE_ENCODING: &str = "UTF-8";
const ALLOWED_URL_SCHEMES: [&str; 5] = ["http", "https", "svn", "svn+ssh", "file"];
const AUTHORITY_END: [char; 3] = ['/', '?', '#'];
const PEG_TERMINATOR: &str = "@";

#[derive(Debug, Clone)]
pub struct InfoRequest {
    pub target: PathBuf,
}

impl InfoRequest {
    pub fn args(&self) -> Vec<OsString> {
        vec![
            INFO_SUBCOMMAND.into(),
            XML_FLAG.into(),
            peg_safe(&self.target),
        ]
    }
}

#[derive(Debug, Clone)]
pub struct StatusRequest {
    pub target: PathBuf,
    pub remote: bool,
    pub ignored: bool,
    pub username: Option<String>,
}

impl StatusRequest {
    pub fn args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = vec![STATUS_SUBCOMMAND.into(), XML_FLAG.into()];
        if self.remote {
            args.push(SHOW_UPDATES_FLAG.into());
        }
        if self.ignored {
            args.push(NO_IGNORE_FLAG.into());
        }
        push_username(&mut args, self.username.as_deref());
        args.push(peg_safe(&self.target));
        args
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Depth {
    Empty,
    Files,
    Immediates,
    Infinity,
}

impl Depth {
    fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Files => "files",
            Self::Immediates => "immediates",
            Self::Infinity => "infinity",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CheckoutRequest {
    pub url: String,
    pub dest: PathBuf,
    pub revision: Option<u64>,
    pub depth: Depth,
    pub ignore_externals: bool,
    pub username: Option<String>,
}

impl CheckoutRequest {
    pub fn args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = vec![CHECKOUT_SUBCOMMAND.into()];
        push_revision(&mut args, self.revision);
        args.extend([DEPTH_FLAG.into(), self.depth.as_str().into()]);
        push_ignore_externals(&mut args, self.ignore_externals);
        push_username(&mut args, self.username.as_deref());
        args.push(peg_safe(Path::new(&self.url)));
        args.push(self.dest.clone().into_os_string());
        args
    }
}

#[derive(Debug, Clone)]
pub struct UpdateRequest {
    pub target: PathBuf,
    pub revision: Option<u64>,
    pub ignore_externals: bool,
    pub username: Option<String>,
}

impl UpdateRequest {
    pub fn args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = vec![UPDATE_SUBCOMMAND.into()];
        push_revision(&mut args, self.revision);
        push_ignore_externals(&mut args, self.ignore_externals);
        push_username(&mut args, self.username.as_deref());
        args.push(peg_safe(&self.target));
        args
    }
}

#[derive(Debug, Clone)]
pub struct CommitRequest {
    pub target: PathBuf,
    pub message: String,
    pub username: Option<String>,
}

impl CommitRequest {
    pub fn args(&self, message_file: &Path) -> Vec<OsString> {
        let mut args: Vec<OsString> = vec![COMMIT_SUBCOMMAND.into()];
        args.extend([
            MESSAGE_FILE_FLAG.into(),
            message_file.as_os_str().to_os_string(),
        ]);
        args.extend([ENCODING_FLAG.into(), MESSAGE_ENCODING.into()]);
        push_username(&mut args, self.username.as_deref());
        args.push(peg_safe(&self.target));
        args
    }
}

#[derive(Debug, Clone)]
pub struct CleanupRequest {
    pub target: PathBuf,
}

impl CleanupRequest {
    pub fn args(&self) -> Vec<OsString> {
        vec![CLEANUP_SUBCOMMAND.into(), peg_safe(&self.target)]
    }
}

fn push_revision(args: &mut Vec<OsString>, revision: Option<u64>) {
    if let Some(revision) = revision {
        args.extend([REVISION_FLAG.into(), revision.to_string().into()]);
    }
}

fn push_ignore_externals(args: &mut Vec<OsString>, ignore_externals: bool) {
    if ignore_externals {
        args.push(IGNORE_EXTERNALS_FLAG.into());
    }
}

fn push_username(args: &mut Vec<OsString>, username: Option<&str>) {
    if let Some(username) = username {
        args.extend([USERNAME_FLAG.into(), username.into()]);
    }
}

pub fn peg_safe(target: &Path) -> OsString {
    let mut text = target.as_os_str().to_os_string();
    text.push(PEG_TERMINATOR);
    text
}

pub fn is_safe_checkout_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else {
        return false;
    };
    if !ALLOWED_URL_SCHEMES.contains(&scheme.to_ascii_lowercase().as_str()) {
        return false;
    }
    let authority = rest.split(AUTHORITY_END).next().unwrap_or_default();
    authority
        .rsplit_once('@')
        .is_none_or(|(userinfo, _)| !userinfo.contains(':'))
}

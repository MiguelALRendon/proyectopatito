use quick_xml::de::from_reader;
use serde::Deserialize;
use thiserror::Error;

use crate::svn::models::{InfoEntry, StatusEntry, StatusItem, StatusReport};

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("la salida XML de svn no es valida: {0}")]
    Xml(#[from] quick_xml::DeError),
    #[error("la salida de svn info no contiene ninguna entrada")]
    MissingEntry,
}

#[derive(Deserialize)]
struct RawInfo {
    #[serde(default)]
    entry: Vec<RawInfoEntry>,
}

#[derive(Deserialize)]
struct RawInfoEntry {
    #[serde(rename = "@kind")]
    kind: String,
    #[serde(rename = "@path")]
    path: String,
    #[serde(rename = "@revision")]
    revision: u64,
    url: String,
    #[serde(rename = "relative-url")]
    relative_url: Option<String>,
    repository: RawRepository,
    #[serde(rename = "wc-info")]
    wc_info: Option<RawWcInfo>,
    commit: Option<RawCommit>,
}

#[derive(Deserialize)]
struct RawRepository {
    root: String,
    uuid: String,
}

#[derive(Deserialize)]
struct RawWcInfo {
    #[serde(rename = "wcroot-abspath")]
    wcroot_abspath: Option<String>,
}

#[derive(Deserialize)]
struct RawCommit {
    #[serde(rename = "@revision")]
    revision: Option<u64>,
    author: Option<String>,
    date: Option<String>,
}

#[derive(Deserialize)]
struct RawStatus {
    #[serde(default)]
    target: Vec<RawTarget>,
}

#[derive(Deserialize)]
struct RawTarget {
    #[serde(default)]
    entry: Vec<RawStatusEntry>,
    against: Option<RawAgainst>,
}

#[derive(Deserialize)]
struct RawAgainst {
    #[serde(rename = "@revision")]
    revision: i64,
}

#[derive(Deserialize)]
struct RawStatusEntry {
    #[serde(rename = "@path")]
    path: String,
    #[serde(rename = "wc-status")]
    wc_status: RawWcStatus,
    #[serde(rename = "repos-status")]
    repos_status: Option<RawReposStatus>,
}

#[derive(Deserialize)]
struct RawWcStatus {
    #[serde(rename = "@item")]
    item: String,
    #[serde(rename = "@props")]
    props: String,
    #[serde(rename = "@revision")]
    revision: Option<i64>,
}

#[derive(Deserialize)]
struct RawReposStatus {
    #[serde(rename = "@item")]
    item: String,
    #[serde(rename = "@props")]
    props: String,
}

pub fn parse_info(xml: &[u8]) -> Result<InfoEntry, ParseError> {
    let raw: RawInfo = from_reader(xml)?;
    raw.entry
        .into_iter()
        .next()
        .map(InfoEntry::from)
        .ok_or(ParseError::MissingEntry)
}

pub fn parse_status(xml: &[u8]) -> Result<StatusReport, ParseError> {
    let raw: RawStatus = from_reader(xml)?;
    Ok(raw.into_report())
}

fn revision_of(raw: i64) -> Option<u64> {
    u64::try_from(raw).ok()
}

impl From<RawInfoEntry> for InfoEntry {
    fn from(raw: RawInfoEntry) -> Self {
        let commit = raw.commit;
        Self {
            path: raw.path,
            kind: raw.kind.as_str().into(),
            revision: raw.revision,
            url: raw.url,
            relative_url: raw.relative_url,
            repository_root: raw.repository.root,
            repository_uuid: raw.repository.uuid,
            working_copy_root: raw.wc_info.and_then(|info| info.wcroot_abspath),
            last_changed_revision: commit.as_ref().and_then(|c| c.revision),
            last_changed_author: commit.as_ref().and_then(|c| c.author.clone()),
            last_changed_date: commit.and_then(|c| c.date),
        }
    }
}

impl RawStatus {
    fn into_report(self) -> StatusReport {
        let mut report = StatusReport::default();
        for target in self.target {
            report.against_revision = target
                .against
                .and_then(|against| revision_of(against.revision))
                .or(report.against_revision);
            report
                .entries
                .extend(target.entry.into_iter().map(StatusEntry::from));
        }
        report
    }
}

impl From<RawStatusEntry> for StatusEntry {
    fn from(raw: RawStatusEntry) -> Self {
        let remote = raw.repos_status;
        Self {
            path: raw.path,
            item: raw.wc_status.item.as_str().into(),
            props: raw.wc_status.props.as_str().into(),
            revision: raw.wc_status.revision.and_then(revision_of),
            remote_item: remote.as_ref().map(|r| StatusItem::from(r.item.as_str())),
            remote_props: remote.map(|r| StatusItem::from(r.props.as_str())),
        }
    }
}

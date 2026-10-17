use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

use crate::app::operations::{are_nested, locked, working_copy_key};
use crate::app::workspace::{ScopedPath, Workspace};
use crate::svn::client::{SvnClient, SvnClientError};
use crate::svn::commands::StatusRequest;
use crate::svn::models::{StatusEntry, StatusItem, StatusReport};
use crate::svn::runner::{DEFAULT_TIMEOUT, Password, RunOptions};

pub const MAX_STATUS_ENTRIES: usize = 20_000;

const PRIORITY_CRITICAL: u8 = 0;
const PRIORITY_CHANGE: u8 = 1;
const PRIORITY_IGNORED: u8 = 2;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct WcStatusMap {
    pub entries: Vec<StatusEntry>,
    pub changed_folders: Vec<String>,
    pub truncated: bool,
    pub against_revision: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
pub struct StatusKey<'a> {
    pub wc: &'a Path,
    pub remote: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    wc: String,
    remote: bool,
}

#[derive(Default)]
struct CacheState {
    generation: u64,
    maps: HashMap<CacheKey, WcStatusMap>,
}

pub enum Lookup {
    Hit(WcStatusMap),
    Miss { generation: u64 },
}

#[derive(Default)]
pub struct StatusCache {
    state: Mutex<CacheState>,
}

impl StatusCache {
    pub fn lookup(&self, key: StatusKey) -> Lookup {
        let state = locked(&self.state);
        match state.maps.get(&CacheKey::of(key)) {
            Some(map) => Lookup::Hit(map.clone()),
            None => Lookup::Miss {
                generation: state.generation,
            },
        }
    }

    pub fn generation(&self) -> u64 {
        locked(&self.state).generation
    }

    pub fn store(&self, key: StatusKey, generation: u64, map: &WcStatusMap) {
        let mut state = locked(&self.state);
        if state.generation == generation {
            state.maps.insert(CacheKey::of(key), map.clone());
        }
    }

    pub fn invalidate(&self, wc: &Path) {
        let reference = working_copy_key(wc);
        let mut state = locked(&self.state);
        state.generation += 1;
        state.maps.retain(|key, _| !are_nested(&key.wc, &reference));
    }
}

impl CacheKey {
    fn of(key: StatusKey) -> Self {
        Self {
            wc: working_copy_key(key.wc),
            remote: key.remote,
        }
    }
}

pub struct StatusQuery {
    pub wc: ScopedPath,
    pub remote: bool,
    pub refresh: bool,
    pub username: Option<String>,
    pub password: Option<Password>,
}

impl StatusQuery {
    fn skips_cache(&self) -> bool {
        self.remote || self.refresh
    }
}

pub struct WcStatusReader {
    workspace: Workspace,
    client: SvnClient,
    cache: Arc<StatusCache>,
    timeout: Duration,
    max_entries: usize,
}

impl WcStatusReader {
    pub fn new(workspace: Workspace, client: SvnClient, cache: Arc<StatusCache>) -> Self {
        Self {
            workspace,
            client,
            cache,
            timeout: DEFAULT_TIMEOUT,
            max_entries: MAX_STATUS_ENTRIES,
        }
    }

    pub fn with_timeout(self, timeout: Duration) -> Self {
        Self { timeout, ..self }
    }

    pub fn with_max_entries(self, max_entries: usize) -> Self {
        Self {
            max_entries,
            ..self
        }
    }

    pub async fn read(&self, query: StatusQuery) -> Result<WcStatusMap, SvnClientError> {
        let wc = query.wc.as_path();
        let key = StatusKey {
            wc,
            remote: query.remote,
        };
        let generation = match self.lookup(&query, key) {
            Lookup::Hit(map) => return Ok(map),
            Lookup::Miss { generation } => generation,
        };
        let options = RunOptions {
            timeout: self.timeout,
            password: query.password.clone(),
            ..RunOptions::default()
        };
        let report = self.client.status(&request_of(&query), options).await?;
        let map = self.map_of(report, wc);
        self.cache.store(key, generation, &map);
        Ok(map)
    }

    fn lookup(&self, query: &StatusQuery, key: StatusKey) -> Lookup {
        if query.skips_cache() {
            return Lookup::Miss {
                generation: self.cache.generation(),
            };
        }
        self.cache.lookup(key)
    }

    fn map_of(&self, report: StatusReport, wc: &Path) -> WcStatusMap {
        let mut entries: Vec<StatusEntry> = report
            .entries
            .into_iter()
            .filter(|entry| !is_normal(entry))
            .map(|entry| self.relative(entry))
            .collect();
        let changed_folders = changed_folders(&entries, &self.workspace.relative_path(wc));
        entries.sort_by_key(priority_of);
        let truncated = entries.len() > self.max_entries;
        entries.truncate(self.max_entries);
        WcStatusMap {
            entries,
            changed_folders,
            truncated,
            against_revision: report.against_revision,
        }
    }

    fn relative(&self, entry: StatusEntry) -> StatusEntry {
        let relative = self.workspace.relative_path(Path::new(&entry.path));
        StatusEntry {
            path: relative.to_string_lossy().into_owned(),
            ..entry
        }
    }
}

fn request_of(query: &StatusQuery) -> StatusRequest {
    StatusRequest {
        target: query.wc.as_path().to_path_buf(),
        remote: query.remote,
        ignored: true,
        username: query.username.clone(),
    }
}

fn priority_of(entry: &StatusEntry) -> u8 {
    if entry.item == StatusItem::Ignored {
        return PRIORITY_IGNORED;
    }
    if needs_attention(entry) {
        return PRIORITY_CRITICAL;
    }
    PRIORITY_CHANGE
}

fn needs_attention(entry: &StatusEntry) -> bool {
    let broken_item = matches!(
        entry.item,
        StatusItem::Conflicted | StatusItem::Missing | StatusItem::Obstructed
    );
    broken_item || entry.props == StatusItem::Conflicted || entry.tree_conflicted || entry.wc_locked
}

fn has_remote_change(entry: &StatusEntry) -> bool {
    let remote_item = entry
        .remote_item
        .as_ref()
        .is_some_and(|item| !is_plain(item));
    let remote_props = entry
        .remote_props
        .as_ref()
        .is_some_and(|item| !is_plain(item));
    remote_item || remote_props
}

fn has_local_marker(entry: &StatusEntry) -> bool {
    entry.wc_locked
        || entry.tree_conflicted
        || entry.copied
        || entry.switched
        || entry.lock.is_some()
}

fn is_plain(item: &StatusItem) -> bool {
    matches!(item, StatusItem::Normal | StatusItem::None)
}

fn is_normal(entry: &StatusEntry) -> bool {
    let plain_locally = is_plain(&entry.item) && is_plain(&entry.props);
    plain_locally && !has_remote_change(entry) && !has_local_marker(entry)
}

fn changed_folders(entries: &[StatusEntry], wc: &Path) -> Vec<String> {
    let folders: BTreeSet<String> = entries
        .iter()
        .filter(|entry| entry.item != StatusItem::Ignored)
        .flat_map(|entry| Path::new(&entry.path).ancestors().skip(1))
        .filter(|folder| folder.starts_with(wc))
        .map(|folder| folder.to_string_lossy().into_owned())
        .collect();
    folders.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::svn::models::StatusLock;

    fn plain() -> StatusEntry {
        StatusEntry {
            path: "a.txt".into(),
            item: StatusItem::Normal,
            props: StatusItem::Normal,
            revision: None,
            remote_item: None,
            remote_props: None,
            wc_locked: false,
            tree_conflicted: false,
            copied: false,
            switched: false,
            lock: None,
        }
    }

    fn with_item(item: StatusItem) -> StatusEntry {
        StatusEntry { item, ..plain() }
    }

    #[test]
    fn the_generation_advances_with_every_invalidation() {
        let cache = StatusCache::default();
        let start = cache.generation();
        cache.invalidate(Path::new("C:/wc"));
        assert_eq!(cache.generation(), start + 1);
        cache.invalidate(Path::new("C:/wc"));
        assert_eq!(cache.generation(), start + 2);
    }

    #[test]
    fn each_attention_signal_alone_needs_attention_and_a_plain_entry_does_not() {
        assert!(!needs_attention(&plain()));
        let alone = [
            with_item(StatusItem::Conflicted),
            with_item(StatusItem::Missing),
            with_item(StatusItem::Obstructed),
            StatusEntry {
                props: StatusItem::Conflicted,
                ..plain()
            },
            StatusEntry {
                tree_conflicted: true,
                ..plain()
            },
            StatusEntry {
                wc_locked: true,
                ..plain()
            },
        ];
        for (index, entry) in alone.iter().enumerate() {
            assert!(needs_attention(entry), "senal {index}");
        }
        assert!(!needs_attention(&with_item(StatusItem::Modified)));
    }

    #[test]
    fn a_remote_change_is_seen_in_the_item_or_in_the_props_but_not_when_both_are_plain() {
        assert!(!has_remote_change(&plain()));
        for remote in [StatusItem::Normal, StatusItem::None] {
            let entry = StatusEntry {
                remote_item: Some(remote.clone()),
                remote_props: Some(remote),
                ..plain()
            };
            assert!(!has_remote_change(&entry));
        }
        let item = StatusEntry {
            remote_item: Some(StatusItem::Modified),
            ..plain()
        };
        let props = StatusEntry {
            remote_props: Some(StatusItem::Modified),
            ..plain()
        };
        assert!(has_remote_change(&item));
        assert!(has_remote_change(&props));
    }

    #[test]
    fn each_local_marker_alone_is_detected_and_a_plain_entry_has_none() {
        assert!(!has_local_marker(&plain()));
        let lock = StatusLock {
            owner: "yo".into(),
            comment: None,
        };
        let alone = [
            StatusEntry {
                wc_locked: true,
                ..plain()
            },
            StatusEntry {
                tree_conflicted: true,
                ..plain()
            },
            StatusEntry {
                copied: true,
                ..plain()
            },
            StatusEntry {
                switched: true,
                ..plain()
            },
            StatusEntry {
                lock: Some(lock),
                ..plain()
            },
        ];
        for (index, entry) in alone.iter().enumerate() {
            assert!(has_local_marker(entry), "marca {index}");
        }
    }

    #[test]
    fn only_normal_and_none_are_plain() {
        assert!(is_plain(&StatusItem::Normal));
        assert!(is_plain(&StatusItem::None));
        assert!(!is_plain(&StatusItem::Modified));
        assert!(!is_plain(&StatusItem::Unknown("x".into())));
    }

    #[test]
    fn an_entry_is_normal_only_when_nothing_local_or_remote_stands_out() {
        assert!(is_normal(&plain()));
        assert!(!is_normal(&with_item(StatusItem::Modified)));
        assert!(!is_normal(&StatusEntry {
            props: StatusItem::Modified,
            ..plain()
        }));
        assert!(!is_normal(&StatusEntry {
            remote_item: Some(StatusItem::Added),
            ..plain()
        }));
        assert!(!is_normal(&StatusEntry {
            copied: true,
            ..plain()
        }));
    }
}

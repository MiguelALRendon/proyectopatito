use std::cmp::Reverse;
use std::collections::{BTreeMap, HashSet};
use std::hash::Hash;
use std::io::ErrorKind;
use std::path::{Component, Path};

use serde::Serialize;
use thiserror::Error;

use crate::app::files::is_forbidden_name;
use crate::app::workspace::{ScopedPath, Workspace, WorkspaceError, component_keys};
use crate::config::{Favorite, FolderView, Tab, TabKind, UI_STATE_VERSION, UiState};

pub const MAX_FAVORITES: usize = 200;
pub const MAX_TABS: usize = 64;
pub const MAX_VIEWS: usize = 500;
pub const MAX_LABEL_CHARS: usize = 256;
pub const MAX_ID_CHARS: usize = 64;
const PATH_SEPARATOR: &str = "\\";
const CURRENT_DIR: &str = ".";

#[derive(Debug, Error)]
pub enum UiStateError {
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error("la ruta apunta a datos internos de Subversion (.svn, _svn)")]
    ForbiddenPath,
    #[error("la versión {0} del estado de interfaz no se conoce")]
    UnknownVersion(u32),
    #[error("hay más {what} de los permitidos (máximo {max})")]
    TooMany { what: &'static str, max: usize },
    #[error(
        "el identificador de pestaña está vacío o supera {} caracteres",
        MAX_ID_CHARS
    )]
    InvalidTabId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Located<T> {
    #[serde(flatten)]
    pub item: T,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UiStateView {
    pub version: u32,
    pub favorites: Vec<Located<Favorite>>,
    pub tabs: Vec<Located<Tab>>,
    pub active_tab: Option<String>,
    pub views: BTreeMap<String, Located<FolderView>>,
}

pub fn normalize(state: UiState, workspace: &Workspace) -> Result<UiState, UiStateError> {
    if state.version != UI_STATE_VERSION {
        return Err(UiStateError::UnknownVersion(state.version));
    }
    let tabs = normalize_tabs(state.tabs, workspace)?;
    Ok(UiState {
        version: UI_STATE_VERSION,
        favorites: normalize_favorites(state.favorites, workspace)?,
        active_tab: state
            .active_tab
            .filter(|id| tabs.iter().any(|tab| &tab.id == id)),
        tabs,
        views: normalize_views(state.views, workspace)?,
    })
}

pub fn describe(state: UiState, workspace: Option<&Workspace>) -> UiStateView {
    let probe = Probe(workspace);
    UiStateView {
        version: state.version,
        favorites: locate_favorites(state.favorites, &probe),
        tabs: locate_tabs(state.tabs, &probe),
        active_tab: state.active_tab,
        views: locate_views(state.views, &probe),
    }
}

struct Probe<'a>(Option<&'a Workspace>);

impl Probe<'_> {
    fn exists(&self, path: &str, want_dir: bool) -> bool {
        self.0
            .is_some_and(|workspace| is_available(path, want_dir, workspace))
    }
}

fn locate_favorites(items: Vec<Favorite>, probe: &Probe) -> Vec<Located<Favorite>> {
    let locate = |item: Favorite| Located {
        exists: probe.exists(&item.path, true),
        item,
    };
    items.into_iter().map(locate).collect()
}

fn locate_tabs(items: Vec<Tab>, probe: &Probe) -> Vec<Located<Tab>> {
    let locate = |item: Tab| Located {
        exists: probe.exists(&item.path, item.kind == TabKind::Folder),
        item,
    };
    items.into_iter().map(locate).collect()
}

fn locate_views(
    views: BTreeMap<String, FolderView>,
    probe: &Probe,
) -> BTreeMap<String, Located<FolderView>> {
    let locate = |(key, item): (String, FolderView)| {
        let exists = probe.exists(&key, true);
        (key, Located { item, exists })
    };
    views.into_iter().map(locate).collect()
}

fn normalize_favorites(
    items: Vec<Favorite>,
    workspace: &Workspace,
) -> Result<Vec<Favorite>, UiStateError> {
    ensure_within(items.len(), MAX_FAVORITES, "favoritos")?;
    let checked = items
        .into_iter()
        .map(|item| {
            Ok(Favorite {
                path: checked_path(&item.path, workspace)?,
                name: clip_label(item.name),
            })
        })
        .collect::<Result<Vec<_>, UiStateError>>()?;
    Ok(first_per_key(checked, |favorite| {
        favorite.path.to_lowercase()
    }))
}

fn normalize_tabs(items: Vec<Tab>, workspace: &Workspace) -> Result<Vec<Tab>, UiStateError> {
    ensure_within(items.len(), MAX_TABS, "pestañas")?;
    let checked = items
        .into_iter()
        .map(|tab| checked_tab(tab, workspace))
        .collect::<Result<Vec<_>, UiStateError>>()?;
    Ok(first_per_key(checked, |tab| tab.id.clone()))
}

fn checked_tab(tab: Tab, workspace: &Workspace) -> Result<Tab, UiStateError> {
    if tab.id.is_empty() || tab.id.chars().count() > MAX_ID_CHARS {
        return Err(UiStateError::InvalidTabId);
    }
    Ok(Tab {
        path: checked_path(&tab.path, workspace)?,
        title: clip_label(tab.title),
        ..tab
    })
}

fn normalize_views(
    views: BTreeMap<String, FolderView>,
    workspace: &Workspace,
) -> Result<BTreeMap<String, FolderView>, UiStateError> {
    let mut newest = BTreeMap::new();
    for (path, view) in views {
        let key = checked_path(&path, workspace)?.to_lowercase();
        let columns = first_per_key(view.columns, |column| *column);
        keep_newest(&mut newest, key, FolderView { columns, ..view });
    }
    Ok(drop_oldest(newest))
}

fn keep_newest(views: &mut BTreeMap<String, FolderView>, key: String, view: FolderView) {
    let is_newer = views
        .get(&key)
        .is_none_or(|current| view.updated_ms > current.updated_ms);
    if is_newer {
        views.insert(key, view);
    }
}

fn drop_oldest(views: BTreeMap<String, FolderView>) -> BTreeMap<String, FolderView> {
    if views.len() <= MAX_VIEWS {
        return views;
    }
    let mut ranked: Vec<_> = views.into_iter().collect();
    ranked.sort_by_key(|(key, view)| (Reverse(view.updated_ms), key.clone()));
    ranked.truncate(MAX_VIEWS);
    ranked.into_iter().collect()
}

fn ensure_within(count: usize, max: usize, what: &'static str) -> Result<(), UiStateError> {
    if count > max {
        return Err(UiStateError::TooMany { what, max });
    }
    Ok(())
}

fn first_per_key<T, K: Hash + Eq>(items: Vec<T>, key: impl Fn(&T) -> K) -> Vec<T> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(key(item)))
        .collect()
}

fn clip_label(label: String) -> String {
    label.chars().take(MAX_LABEL_CHARS).collect()
}

fn checked_path(raw: &str, workspace: &Workspace) -> Result<String, UiStateError> {
    let cleaned = clean_path(raw)?;
    match scoped(&cleaned, workspace) {
        Err(UiStateError::Workspace(WorkspaceError::Io(ref error)))
            if error.kind() == ErrorKind::NotADirectory =>
        {
            Ok(cleaned)
        }
        other => other.map(|_| cleaned),
    }
}

fn clean_path(raw: &str) -> Result<String, UiStateError> {
    if is_rooted(raw) {
        return Err(WorkspaceError::OutsideWorkspace.into());
    }
    let parts: Vec<&str> = raw
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != CURRENT_DIR)
        .collect();
    reject_forbidden(parts.iter().copied())?;
    Ok(parts.join(PATH_SEPARATOR))
}

fn is_rooted(raw: &str) -> bool {
    matches!(
        Path::new(raw).components().next(),
        Some(Component::Prefix(_) | Component::RootDir)
    )
}

fn scoped(cleaned: &str, workspace: &Workspace) -> Result<ScopedPath, UiStateError> {
    let scoped = workspace.resolve(Path::new(cleaned), true)?;
    let keys = component_keys(&workspace.relative_path(scoped.as_path()));
    reject_forbidden(keys.iter().map(String::as_str))?;
    Ok(scoped)
}

fn reject_forbidden<'a>(names: impl IntoIterator<Item = &'a str>) -> Result<(), UiStateError> {
    if names.into_iter().any(is_forbidden_name) {
        return Err(UiStateError::ForbiddenPath);
    }
    Ok(())
}

fn is_available(path: &str, want_dir: bool, workspace: &Workspace) -> bool {
    clean_path(path)
        .and_then(|cleaned| scoped(&cleaned, workspace))
        .ok()
        .and_then(|scoped| std::fs::metadata(scoped.as_path()).ok())
        .is_some_and(|metadata| metadata.is_dir() == want_dir)
}

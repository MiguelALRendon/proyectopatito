#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use dakedaduck_svn_lib::app::error::{CommandError, CommandErrorKind};
use dakedaduck_svn_lib::app::state::AppState;
use dakedaduck_svn_lib::app::ui_state::{
    MAX_FAVORITES, MAX_ID_CHARS, MAX_LABEL_CHARS, MAX_TABS, MAX_VIEWS, UiStateView,
};
use dakedaduck_svn_lib::config::{
    AppConfig, CONFIG_FILE_NAME, ConfigStore, Favorite, FolderView, SortDirection, SortKey, Tab,
    TabKind, UI_STATE_VERSION, UiState, ViewColumn, ViewMode,
};
use tempfile::TempDir;

struct Sandbox {
    _dir: TempDir,
    parent: PathBuf,
    root: PathBuf,
    store: ConfigStore,
}

fn sandbox() -> Sandbox {
    let dir = TempDir::new().unwrap();
    let parent = fs::canonicalize(dir.path()).unwrap();
    let parent = PathBuf::from(parent.to_string_lossy().trim_start_matches(r"\\?\"));
    let root = parent.join("raiz");
    fs::create_dir(&root).unwrap();
    let store = ConfigStore {
        path: parent.join("cfg").join(CONFIG_FILE_NAME),
    };
    Sandbox {
        _dir: dir,
        parent,
        root,
        store,
    }
}

impl Sandbox {
    fn state(&self) -> AppState {
        let state = AppState::new(self.store.clone());
        state.workspace_set(&self.root).unwrap();
        state
    }

    fn mkdir(&self, relative: &str) {
        fs::create_dir_all(self.root.join(relative)).unwrap();
    }

    fn write_config(&self, json: &str) {
        fs::create_dir_all(self.store.path.parent().unwrap()).unwrap();
        fs::write(&self.store.path, json).unwrap();
    }

    fn persisted_ui(&self) -> UiState {
        self.store.load().unwrap().ui
    }

    fn assert_nothing_persisted(&self) {
        assert_eq!(self.persisted_ui(), UiState::default());
    }
}

fn favorite(path: &str) -> Favorite {
    Favorite {
        path: path.into(),
        name: format!("fav {path}"),
    }
}

fn tab(id: &str, kind: TabKind, path: &str) -> Tab {
    Tab {
        id: id.into(),
        kind,
        path: path.into(),
        title: format!("tab {path}"),
    }
}

fn view(updated_ms: u64) -> FolderView {
    FolderView {
        mode: ViewMode::Details,
        columns: vec![ViewColumn::Size, ViewColumn::Svn],
        sort: SortKey::Modified,
        sort_direction: SortDirection::Desc,
        updated_ms,
    }
}

fn with_favorites(paths: &[&str]) -> UiState {
    UiState {
        favorites: paths.iter().map(|path| favorite(path)).collect(),
        ..UiState::default()
    }
}

fn with_tab(path: &str) -> UiState {
    UiState {
        tabs: vec![tab("t1", TabKind::Folder, path)],
        ..UiState::default()
    }
}

fn with_view(path: &str) -> UiState {
    UiState {
        views: [(path.to_string(), view(1))].into(),
        ..UiState::default()
    }
}

fn error_kind<T: std::fmt::Debug>(result: Result<T, CommandError>) -> CommandErrorKind {
    result.unwrap_err().kind
}

fn make_junction(link: &Path, target: &Path) {
    let created = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .unwrap()
        .status
        .success();
    assert!(created, "no se pudo crear la junction de prueba");
}

fn favorite_flags(view: &UiStateView) -> Vec<(String, bool)> {
    view.favorites
        .iter()
        .map(|located| (located.item.path.clone(), located.exists))
        .collect()
}

const SECOND_ROOT_FILE_AS_FOLDER: &str = "a";

#[test]
fn a_corrupt_config_file_is_quarantined_and_loads_the_default_ui_state() {
    let sandbox = sandbox();
    sandbox.write_config(r#"{"ui": {"version": 1, "favorites": [ "#);
    let config = sandbox.store.load().unwrap();
    assert_eq!(config, AppConfig::default());
    let quarantined = sandbox.store.path.with_extension("json.bad");
    assert!(quarantined.exists());
    assert!(!sandbox.store.path.exists());
}

#[test]
fn a_future_ui_version_loads_as_the_default_without_touching_the_rest_of_the_config() {
    let sandbox = sandbox();
    sandbox.write_config(
        r#"{"workspace_root":"C:\\raiz","svn_path":"C:\\svn.exe","ui":{"version":99,"favorites":[{"path":"a","name":"a"}]}}"#,
    );
    let config = sandbox.store.load().unwrap();
    assert_eq!(config.ui, UiState::default());
    assert_eq!(config.workspace_root, Some(PathBuf::from(r"C:\raiz")));
    assert_eq!(config.svn_path, Some(PathBuf::from(r"C:\svn.exe")));
    assert!(sandbox.store.path.exists());
}

#[test]
fn an_invalid_ui_section_keeps_workspace_root_and_svn_path_and_never_quarantines() {
    let invalid_sections = [
        r#""texto""#,
        "null",
        "[]",
        "[1,2]",
        "42",
        "true",
        "{}",
        r#"{"version":"1"}"#,
        r#"{"version":1,"favorites":"x"}"#,
        r#"{"version":1,"favorites":[{"path":1,"name":"a"}]}"#,
        r#"{"version":1,"favorites":[{"path":"a"}]}"#,
        r#"{"version":1,"tabs":[{"id":"t","kind":"nope","path":"","title":""}]}"#,
        r#"{"version":1,"views":{"a":{"mode":"cubes"}}}"#,
        r#"{"version":1,"views":[]}"#,
        r#"{"version":1,"active_tab":7}"#,
    ];
    for section in invalid_sections {
        let sandbox = sandbox();
        sandbox.write_config(&format!(
            r#"{{"workspace_root":"C:\\raiz","svn_path":"C:\\svn.exe","ui":{section}}}"#
        ));
        let config = sandbox.store.load().unwrap();
        assert_eq!(config.ui, UiState::default(), "{section}");
        assert_eq!(
            config.workspace_root,
            Some(PathBuf::from(r"C:\raiz")),
            "{section}"
        );
        assert_eq!(
            config.svn_path,
            Some(PathBuf::from(r"C:\svn.exe")),
            "{section}"
        );
        assert!(sandbox.store.path.exists(), "{section}");
        assert!(
            !sandbox.store.path.with_extension("json.bad").exists(),
            "{section}"
        );
    }
}

#[test]
fn a_config_written_before_the_ui_section_existed_loads_with_the_default() {
    let sandbox = sandbox();
    sandbox.write_config(r#"{"workspace_root":"C:\\raiz"}"#);
    let config = sandbox.store.load().unwrap();
    assert_eq!(config.ui, UiState::default());
    assert_eq!(config.workspace_root, Some(PathBuf::from(r"C:\raiz")));
}

#[tokio::test]
async fn paths_that_leave_the_root_are_rejected_in_favorites_tabs_and_views() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let outside = sandbox.parent.to_string_lossy().into_owned();
    let escapes = [
        outside.as_str(),
        r"C:\Windows",
        r"\\servidor\recurso\x",
        r"\sin\unidad",
        "/barra/inicial",
        "C:relativa",
    ];
    for path in escapes {
        for ui in [with_favorites(&[path]), with_tab(path), with_view(path)] {
            let result = state.ui_state_set(ui).await;
            assert_eq!(
                error_kind(result),
                CommandErrorKind::OutsideWorkspace,
                "{path}"
            );
        }
    }
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn paths_with_parent_components_are_rejected_wherever_the_dots_appear() {
    let sandbox = sandbox();
    sandbox.mkdir("a/b");
    let state = sandbox.state();
    for path in ["..", r"..\hermana", r"a\..\a", "a/../..", r"a\b\.."] {
        for ui in [with_favorites(&[path]), with_tab(path), with_view(path)] {
            let result = state.ui_state_set(ui).await;
            assert_eq!(error_kind(result), CommandErrorKind::InvalidPath, "{path}");
        }
    }
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn paths_inside_svn_admin_folders_are_rejected_in_any_case() {
    let sandbox = sandbox();
    sandbox.mkdir("wc/.svn/pristine");
    let state = sandbox.state();
    for path in [
        ".svn",
        "_svn",
        r"wc\.svn",
        r"wc\.SVN\pristine",
        "wc/_SVN/x",
        r"WC\.Svn",
    ] {
        for ui in [with_favorites(&[path]), with_tab(path), with_view(path)] {
            let result = state.ui_state_set(ui).await;
            assert_eq!(
                error_kind(result),
                CommandErrorKind::ForbiddenPath,
                "{path}"
            );
        }
    }
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn names_with_streams_trailing_dots_or_device_names_are_rejected() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let expected = [
        ("a:flujo", CommandErrorKind::OutsideWorkspace),
        ("nota.txt:flujo", CommandErrorKind::InvalidPath),
        (r"a\.svn.", CommandErrorKind::InvalidPath),
        ("con", CommandErrorKind::InvalidPath),
        (r"a\NUL.txt", CommandErrorKind::InvalidPath),
        ("b ", CommandErrorKind::InvalidPath),
    ];
    for (path, kind) in expected {
        let result = state.ui_state_set(with_favorites(&[path])).await;
        assert_eq!(error_kind(result), kind, "{path}");
    }
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn a_junction_that_leaves_the_root_is_rejected() {
    let sandbox = sandbox();
    let outside = sandbox.parent.join("fuera");
    fs::create_dir(&outside).unwrap();
    make_junction(&sandbox.root.join("salida"), &outside);
    let state = sandbox.state();
    for path in ["salida", r"salida\dentro"] {
        let result = state.ui_state_set(with_favorites(&[path])).await;
        assert_eq!(
            error_kind(result),
            CommandErrorKind::OutsideWorkspace,
            "{path}"
        );
    }
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn a_dangling_junction_is_rejected_instead_of_persisted() {
    let sandbox = sandbox();
    let target = sandbox.parent.join("efimero");
    fs::create_dir(&target).unwrap();
    make_junction(&sandbox.root.join("colgado"), &target);
    fs::remove_dir(&target).unwrap();
    let state = sandbox.state();
    for path in ["colgado", r"colgado\dentro"] {
        for ui in [with_favorites(&[path]), with_tab(path), with_view(path)] {
            let result = state.ui_state_set(ui).await;
            assert_eq!(error_kind(result), CommandErrorKind::Io, "{path}");
        }
    }
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn a_set_prepared_for_a_previous_root_is_not_persisted_after_the_root_changes() {
    let sandbox = sandbox();
    let other_root = sandbox.parent.join("otra");
    fs::create_dir(&other_root).unwrap();
    let state = sandbox.state();
    let pending = state.ui_state_set(with_favorites(&["a"]));
    tokio::pin!(pending);
    tokio::select! {
        biased;
        _ = &mut pending => panic!("terminó antes del cambio de raíz"),
        () = std::future::ready(()) => {}
    }
    state.workspace_set(&other_root).unwrap();
    assert_eq!(error_kind(pending.await), CommandErrorKind::Io);
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn an_unknown_version_in_a_set_is_rejected_and_nothing_is_persisted() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let future = UiState {
        version: UI_STATE_VERSION + 1,
        ..with_favorites(&["a"])
    };
    assert_eq!(
        error_kind(state.ui_state_set(future).await),
        CommandErrorKind::InvalidPath
    );
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn more_favorites_or_tabs_than_the_limit_are_rejected_not_truncated() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let names: Vec<String> = (0..=MAX_FAVORITES)
        .map(|index| format!("f{index}"))
        .collect();
    let paths: Vec<&str> = names.iter().map(String::as_str).collect();
    let too_many_favorites = with_favorites(&paths);
    assert_eq!(
        error_kind(state.ui_state_set(too_many_favorites).await),
        CommandErrorKind::InvalidPath
    );
    let too_many_tabs = UiState {
        tabs: (0..=MAX_TABS)
            .map(|index| tab(&format!("t{index}"), TabKind::Folder, ""))
            .collect(),
        ..UiState::default()
    };
    assert_eq!(
        error_kind(state.ui_state_set(too_many_tabs).await),
        CommandErrorKind::InvalidPath
    );
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn exactly_the_limit_of_favorites_and_tabs_is_accepted() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let names: Vec<String> = (0..MAX_FAVORITES)
        .map(|index| format!("f{index}"))
        .collect();
    let paths: Vec<&str> = names.iter().map(String::as_str).collect();
    let saved = state.ui_state_set(with_favorites(&paths)).await.unwrap();
    assert_eq!(saved.favorites.len(), MAX_FAVORITES);
    let tabs = UiState {
        tabs: (0..MAX_TABS)
            .map(|index| tab(&format!("t{index}"), TabKind::Folder, ""))
            .collect(),
        ..UiState::default()
    };
    assert_eq!(state.ui_state_set(tabs).await.unwrap().tabs.len(), MAX_TABS);
}

#[tokio::test]
async fn views_over_the_limit_discard_the_oldest_and_keep_the_newest() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let extra = 3;
    let ui = UiState {
        views: (0..MAX_VIEWS + extra)
            .map(|index| (format!("v{index}"), view(index as u64 + 1)))
            .collect(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(saved.views.len(), MAX_VIEWS);
    for index in 0..extra {
        assert!(!saved.views.contains_key(&format!("v{index}")), "v{index}");
    }
    assert!(
        saved
            .views
            .contains_key(&format!("v{}", MAX_VIEWS + extra - 1))
    );
    assert_eq!(sandbox.persisted_ui().views.len(), MAX_VIEWS);
}

#[tokio::test]
async fn views_with_equal_age_over_the_limit_drop_deterministically() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let ui = UiState {
        views: (0..=MAX_VIEWS)
            .map(|index| (format!("v{index:04}"), view(5)))
            .collect(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(saved.views.len(), MAX_VIEWS);
    assert!(!saved.views.contains_key(&format!("v{MAX_VIEWS:04}")));
}

#[tokio::test]
async fn a_favorite_whose_folder_does_not_exist_is_unavailable_but_kept() {
    let sandbox = sandbox();
    sandbox.mkdir("presente");
    let state = sandbox.state();
    let saved = state
        .ui_state_set(with_favorites(&["presente", "ausente"]))
        .await
        .unwrap();
    assert_eq!(
        favorite_flags(&saved),
        [
            ("presente".to_string(), true),
            ("ausente".to_string(), false)
        ]
    );
    assert_eq!(sandbox.persisted_ui().favorites.len(), 2);
    sandbox.mkdir("ausente");
    let again = state.ui_state_get().await.unwrap();
    assert!(again.favorites.iter().all(|located| located.exists));
}

#[tokio::test]
async fn a_favorite_that_points_at_a_file_or_a_folder_tab_at_a_file_is_unavailable() {
    let sandbox = sandbox();
    fs::write(sandbox.root.join("nota.txt"), "x").unwrap();
    sandbox.mkdir("carpeta");
    let state = sandbox.state();
    let ui = UiState {
        favorites: vec![favorite("nota.txt"), favorite("carpeta")],
        tabs: vec![
            tab("t1", TabKind::Folder, "nota.txt"),
            tab("t2", TabKind::Document, "nota.txt"),
            tab("t3", TabKind::Document, "carpeta"),
        ],
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(
        favorite_flags(&saved),
        [
            ("nota.txt".to_string(), false),
            ("carpeta".to_string(), true)
        ]
    );
    let flags: Vec<bool> = saved.tabs.iter().map(|located| located.exists).collect();
    assert_eq!(flags, [false, true, false]);
}

#[tokio::test]
async fn changing_the_workspace_root_revalidates_without_deleting_anything() {
    let sandbox = sandbox();
    sandbox.mkdir("a/b");
    let other_root = sandbox.parent.join("otra");
    fs::create_dir_all(other_root.join("a")).unwrap();
    let state = sandbox.state();
    let ui = UiState {
        favorites: vec![favorite(r"a\b")],
        tabs: vec![tab("t1", TabKind::Folder, r"a\b")],
        views: [(r"a\b".to_string(), view(1))].into(),
        ..UiState::default()
    };
    state.ui_state_set(ui).await.unwrap();
    state.workspace_set(&other_root).unwrap();
    let moved = state.ui_state_get().await.unwrap();
    assert!(!moved.favorites[0].exists && !moved.tabs[0].exists);
    assert!(!moved.views[r"a\b"].exists);
    assert_eq!(sandbox.persisted_ui().favorites.len(), 1);
    state.workspace_set(&sandbox.root).unwrap();
    let back = state.ui_state_get().await.unwrap();
    assert!(back.favorites[0].exists && back.tabs[0].exists && back.views[r"a\b"].exists);
}

#[tokio::test]
async fn echoing_unavailable_entries_back_after_a_root_change_is_accepted() {
    let sandbox = sandbox();
    sandbox.mkdir("a/b");
    let new_root = sandbox.parent.join("nueva");
    fs::create_dir(&new_root).unwrap();
    fs::write(new_root.join(SECOND_ROOT_FILE_AS_FOLDER), "soy un archivo").unwrap();
    let state = sandbox.state();
    state.ui_state_set(with_favorites(&[r"a\b"])).await.unwrap();
    state.workspace_set(&new_root).unwrap();
    let current = state.ui_state_get().await.unwrap();
    assert!(!current.favorites[0].exists);
    let echoed = UiState {
        favorites: current.favorites.iter().map(|l| l.item.clone()).collect(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(echoed).await.unwrap();
    assert_eq!(favorite_flags(&saved), [(r"a\b".to_string(), false)]);
    assert_eq!(sandbox.persisted_ui().favorites.len(), 1);
}

#[tokio::test]
async fn keys_that_differ_only_in_case_collapse_to_one() {
    let sandbox = sandbox();
    sandbox.mkdir("Docs");
    let state = sandbox.state();
    let ui = UiState {
        favorites: vec![favorite("Docs"), favorite("docs"), favorite("DOCS")],
        views: [
            ("Docs".to_string(), view(1)),
            ("DOCS".to_string(), view(9)),
            ("docs".to_string(), view(4)),
        ]
        .into(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(saved.favorites.len(), 1);
    assert_eq!(saved.favorites[0].item.path, "Docs");
    assert_eq!(saved.views.len(), 1);
    assert_eq!(saved.views["docs"].item.updated_ms, 9);
}

#[tokio::test]
async fn tabs_collapse_by_id_but_may_share_a_path_with_different_case() {
    let sandbox = sandbox();
    sandbox.mkdir("Docs");
    let state = sandbox.state();
    let ui = UiState {
        tabs: vec![
            tab("t1", TabKind::Folder, "Docs"),
            tab("t2", TabKind::Folder, "docs"),
            tab("t1", TabKind::Folder, "otra"),
        ],
        active_tab: Some("t2".into()),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    let ids: Vec<&str> = saved.tabs.iter().map(|l| l.item.id.as_str()).collect();
    assert_eq!(ids, ["t1", "t2"]);
    assert_eq!(saved.tabs[0].item.path, "Docs");
    assert_eq!(saved.active_tab.as_deref(), Some("t2"));
}

#[tokio::test]
async fn an_active_tab_that_is_not_among_the_tabs_is_cleared() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let ui = UiState {
        active_tab: Some("fantasma".into()),
        ..with_tab("")
    };
    assert_eq!(state.ui_state_set(ui).await.unwrap().active_tab, None);
}

#[tokio::test]
async fn tab_ids_must_be_present_and_bounded() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let long_id = "x".repeat(MAX_ID_CHARS + 1);
    for id in ["", long_id.as_str()] {
        let ui = UiState {
            tabs: vec![tab(id, TabKind::Folder, "")],
            ..UiState::default()
        };
        assert_eq!(
            error_kind(state.ui_state_set(ui).await),
            CommandErrorKind::InvalidPath
        );
    }
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn a_tab_id_of_exactly_the_maximum_length_is_accepted() {
    let sandbox = sandbox();
    let state = sandbox.state();
    for length in [MAX_ID_CHARS - 1, MAX_ID_CHARS] {
        let id = "x".repeat(length);
        let ui = UiState {
            tabs: vec![tab(&id, TabKind::Folder, "")],
            ..UiState::default()
        };
        let saved = state.ui_state_set(ui).await.unwrap();
        assert_eq!(saved.tabs[0].item.id, id);
    }
}

#[tokio::test]
async fn tab_titles_are_clipped_but_kept_below_the_limit() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let long = "ñ".repeat(MAX_LABEL_CHARS + 50);
    let ui = UiState {
        tabs: vec![
            Tab {
                title: long,
                ..tab("t1", TabKind::Folder, "")
            },
            tab("t2", TabKind::Folder, ""),
        ],
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(saved.tabs[0].item.title.chars().count(), MAX_LABEL_CHARS);
    assert_eq!(saved.tabs[1].item.title, "tab ");
}

#[tokio::test]
async fn colliding_views_keep_the_strictly_newest_and_the_first_on_a_tie() {
    let sandbox = sandbox();
    sandbox.mkdir("Docs");
    sandbox.mkdir("Otra");
    let state = sandbox.state();
    let marked = |mode, updated_ms| FolderView {
        mode,
        ..view(updated_ms)
    };
    let ui = UiState {
        views: [
            ("DOCS".to_string(), marked(ViewMode::Grid, 1)),
            ("Docs".to_string(), marked(ViewMode::List, 9)),
            ("OTRA".to_string(), marked(ViewMode::Grid, 5)),
            ("Otra".to_string(), marked(ViewMode::List, 5)),
        ]
        .into(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(saved.views["docs"].item.mode, ViewMode::List);
    assert_eq!(saved.views["otra"].item.mode, ViewMode::Grid);
}

#[tokio::test]
async fn labels_are_clipped_and_column_lists_deduplicated() {
    let sandbox = sandbox();
    let state = sandbox.state();
    let ui = UiState {
        favorites: vec![Favorite {
            path: String::new(),
            name: "ñ".repeat(MAX_LABEL_CHARS + 50),
        }],
        views: [(
            String::new(),
            FolderView {
                columns: vec![ViewColumn::Svn, ViewColumn::Size, ViewColumn::Svn],
                ..view(1)
            },
        )]
        .into(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(
        saved.favorites[0].item.name.chars().count(),
        MAX_LABEL_CHARS
    );
    assert_eq!(
        saved.views[""].item.columns,
        [ViewColumn::Svn, ViewColumn::Size]
    );
}

#[tokio::test]
async fn separators_dots_and_empty_segments_are_normalized_to_one_relative_form() {
    let sandbox = sandbox();
    sandbox.mkdir("a/b");
    let state = sandbox.state();
    let ui = UiState {
        favorites: vec![favorite("a/b/"), favorite(r".\a\\.\b")],
        views: [("A/B/".to_string(), view(1))].into(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui).await.unwrap();
    assert_eq!(favorite_flags(&saved), [(r"a\b".to_string(), true)]);
    assert!(saved.views.contains_key(r"a\b"));
}

#[tokio::test]
async fn a_set_without_a_workspace_root_is_refused() {
    let sandbox = sandbox();
    let state = AppState::new(sandbox.store.clone());
    let result = state.ui_state_set(with_favorites(&["a"])).await;
    assert_eq!(error_kind(result), CommandErrorKind::NoWorkspace);
    sandbox.assert_nothing_persisted();
}

#[tokio::test]
async fn a_get_without_a_workspace_root_returns_everything_as_unavailable() {
    let sandbox = sandbox();
    sandbox.mkdir("a");
    sandbox
        .state()
        .ui_state_set(with_favorites(&["a"]))
        .await
        .unwrap();
    let mut config = sandbox.store.load().unwrap();
    config.workspace_root = None;
    sandbox.store.save(&config).unwrap();
    let view = AppState::new(sandbox.store.clone())
        .ui_state_get()
        .await
        .unwrap();
    assert_eq!(favorite_flags(&view), [("a".to_string(), false)]);
}

#[tokio::test]
async fn hand_edited_entries_that_escape_the_root_are_returned_unavailable() {
    let sandbox = sandbox();
    let root = sandbox.root.to_string_lossy().replace('\\', r"\\");
    sandbox.write_config(&format!(
        r#"{{"workspace_root":"{root}","ui":{{"version":1,"favorites":[
            {{"path":"..\\fuera","name":"a"}},
            {{"path":"C:\\Windows","name":"b"}},
            {{"path":"x\\.svn","name":"c"}}]}}}}"#
    ));
    let view = AppState::new(sandbox.store.clone())
        .ui_state_get()
        .await
        .unwrap();
    assert_eq!(view.favorites.len(), 3);
    assert!(view.favorites.iter().all(|located| !located.exists));
}

#[tokio::test]
async fn a_set_keeps_the_workspace_root_and_svn_path_already_saved() {
    let sandbox = sandbox();
    let root = sandbox.root.to_string_lossy().replace('\\', r"\\");
    sandbox.write_config(&format!(
        r#"{{"workspace_root":"{root}","svn_path":"C:\\svn.exe"}}"#
    ));
    let state = AppState::new(sandbox.store.clone());
    state.ui_state_set(with_favorites(&["a"])).await.unwrap();
    let saved = sandbox.store.load().unwrap();
    assert_eq!(saved.workspace_root, Some(sandbox.root.clone()));
    assert_eq!(saved.svn_path, Some(PathBuf::from(r"C:\svn.exe")));
    assert_eq!(saved.ui.favorites.len(), 1);
}

#[tokio::test]
async fn the_saved_state_survives_a_restart_with_a_new_store_on_the_same_file() {
    let sandbox = sandbox();
    sandbox.mkdir("proyecto/src");
    fs::write(sandbox.root.join("proyecto/leeme.md"), "x").unwrap();
    let ui = UiState {
        favorites: vec![favorite("proyecto"), favorite(r"proyecto\src")],
        tabs: vec![
            tab("t1", TabKind::Folder, "proyecto"),
            tab("t2", TabKind::Document, r"proyecto\leeme.md"),
        ],
        active_tab: Some("t2".into()),
        views: [("proyecto".to_string(), view(7))].into(),
        ..UiState::default()
    };
    let before = sandbox.state().ui_state_set(ui).await.unwrap();
    let restarted = AppState::new(ConfigStore {
        path: sandbox.store.path.clone(),
    });
    assert_eq!(restarted.ui_state_get().await.unwrap(), before);
}

#[tokio::test]
async fn the_ui_state_set_by_the_user_is_returned_by_get_with_every_path_available() {
    let sandbox = sandbox();
    sandbox.mkdir("proyecto");
    let state = sandbox.state();
    let ui = UiState {
        favorites: vec![favorite("proyecto")],
        tabs: vec![tab("t1", TabKind::Folder, "proyecto")],
        active_tab: Some("t1".into()),
        views: [("proyecto".to_string(), view(3))].into(),
        ..UiState::default()
    };
    let saved = state.ui_state_set(ui.clone()).await.unwrap();
    let fetched = state.ui_state_get().await.unwrap();
    assert_eq!(saved, fetched);
    assert_eq!(fetched.version, UI_STATE_VERSION);
    assert!(fetched.favorites[0].exists && fetched.tabs[0].exists);
    assert!(fetched.views["proyecto"].exists);
    assert_eq!(fetched.views["proyecto"].item, ui.views["proyecto"]);
}

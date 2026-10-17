#![cfg(windows)]

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use common::{TestRepo, TestServer, install_stalling_hook, wait_for_file};
use dakedaduck_svn_lib::app::args::{
    CheckoutArgs, CleanupArgs, CommitArgs, StatusMapArgs, UpdateArgs,
};
use dakedaduck_svn_lib::app::error::{CommandError, CommandErrorKind};
use dakedaduck_svn_lib::app::files::{FileService, TextUpdate};
use dakedaduck_svn_lib::app::operations::OperationId;
use dakedaduck_svn_lib::app::state::{AppState, OperationResult, Sinks};
use dakedaduck_svn_lib::app::wc_status::{
    Lookup, MAX_STATUS_ENTRIES, StatusCache, StatusKey, StatusQuery, WcStatusMap, WcStatusReader,
};
use dakedaduck_svn_lib::app::workspace::{ScopedPath, Workspace};
use dakedaduck_svn_lib::config::{CONFIG_FILE_NAME, ConfigStore};
use dakedaduck_svn_lib::svn::client::{SvnClient, SvnClientError};
use dakedaduck_svn_lib::svn::commands::{Depth, StatusRequest};
use dakedaduck_svn_lib::svn::error::SvnErrorKind;
use dakedaduck_svn_lib::svn::models::{StatusEntry, StatusItem};
use dakedaduck_svn_lib::svn::runner::{RunOptions, SvnRunner};
use tempfile::TempDir;
use tokio::sync::mpsc::unbounded_channel;

const WC: &str = "wc";
const PEER: &str = "peer";
const SERVER_USER: &str = "alice";
const SERVER_PASSWORD: &str = "s3cret-real";
const WRONG_PASSWORD: &str = "clave-equivocada";
const DONE_TIMEOUT: Duration = Duration::from_secs(60);
const SERVER_SCHEME: &str = "svn://";
const SVN_AUTH_CACHE: &str = r"Subversion\auth\svn.simple";
const BASE_LINES: &str = "uno\ndos\ntres\n";

struct Env {
    _tmp: TempDir,
    repo: TestRepo,
    url: String,
    workspace: Workspace,
    cache: Arc<StatusCache>,
    auth: Vec<String>,
}

impl Env {
    fn new() -> Self {
        let repo = TestRepo::create();
        let url = repo.url.clone();
        Self::open(repo, &url, &[])
    }

    fn open(repo: TestRepo, url: &str, auth: &[&str]) -> Self {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("raiz");
        fs::create_dir(&root).unwrap();
        let env = Self {
            workspace: Workspace::new(&root).unwrap(),
            _tmp: tmp,
            repo,
            url: url.to_string(),
            cache: Arc::default(),
            auth: auth.iter().map(ToString::to_string).collect(),
        };
        env.run(env.root(), &["checkout", url, WC], true);
        env
    }

    fn root(&self) -> &Path {
        self.workspace.root().as_path()
    }

    fn dir(&self, name: &str) -> PathBuf {
        self.root().join(name)
    }

    fn run(&self, cwd: &Path, args: &[&str], authed: bool) -> String {
        let mut command = Command::new(&self.repo.svn.path);
        command.args(args).arg("--non-interactive").current_dir(cwd);
        if authed {
            command.args(&self.auth);
        }
        let output = command.output().expect("no se pudo lanzar svn");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "svn {args:?} fallo: {stderr}");
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn svn(&self, args: &[&str]) -> String {
        self.run(&self.dir(WC), args, false)
    }

    fn svn_as(&self, args: &[&str]) -> String {
        self.run(&self.dir(WC), args, true)
    }

    fn write(&self, rel: &str, text: &str) {
        let path = self.dir(WC).join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn seed(&self, files: &[(&str, &str)]) {
        for (rel, text) in files {
            self.write(rel, text);
        }
        self.svn(&["add", "--force", "."]);
        self.svn_as(&["commit", "-m", "base"]);
    }

    fn make_peer(&self) -> PathBuf {
        self.run(self.root(), &["checkout", &self.url, PEER], true);
        self.dir(PEER)
    }

    fn peer_commit(&self, rel: &str, text: &str) {
        let peer = self.dir(PEER);
        fs::write(peer.join(rel), text).unwrap();
        self.run(&peer, &["commit", "-m", "par"], true);
    }

    fn reader(&self) -> WcStatusReader {
        let client = SvnClient::new(SvnRunner::new(self.repo.svn.path.clone()));
        WcStatusReader::new(self.workspace.clone(), client, self.cache.clone())
    }

    fn query(&self, remote: bool) -> StatusQuery {
        StatusQuery {
            wc: self.workspace.resolve(Path::new(WC), true).unwrap(),
            remote,
            refresh: false,
            username: None,
            password: None,
        }
    }

    async fn map(&self) -> WcStatusMap {
        self.reader().read(self.query(false)).await.unwrap()
    }

    async fn remote_map(&self) -> WcStatusMap {
        self.reader().read(self.query(true)).await.unwrap()
    }

    fn state(&self) -> AppState {
        let store = ConfigStore {
            path: self.root().parent().unwrap().join(CONFIG_FILE_NAME),
        };
        let state = AppState::new(store);
        state.workspace_set(self.root()).unwrap();
        state
    }
}

fn private_env() -> (Env, TestServer) {
    let repo = TestRepo::create();
    let server = TestServer::start(&repo, SERVER_USER, SERVER_PASSWORD);
    let url = server.url.clone();
    let auth = [
        "--username",
        SERVER_USER,
        "--password",
        SERVER_PASSWORD,
        "--no-auth-cache",
    ];
    (Env::open(repo, &url, &auth), server)
}

fn key(wc: &Path, remote: bool) -> StatusKey<'_> {
    StatusKey { wc, remote }
}

fn wc_path(rel: &str) -> String {
    format!(r"{WC}\{rel}")
}

fn find<'a>(map: &'a WcStatusMap, rel: &str) -> Option<&'a StatusEntry> {
    let wanted = wc_path(rel);
    map.entries.iter().find(|entry| entry.path == wanted)
}

fn entry<'a>(map: &'a WcStatusMap, rel: &str) -> &'a StatusEntry {
    find(map, rel).unwrap_or_else(|| panic!("no hay entrada para {rel}: {:?}", map.entries))
}

fn item(map: &WcStatusMap, rel: &str) -> StatusItem {
    entry(map, rel).item.clone()
}

fn args(wc_root: &str, remote: bool, credentials: Option<(&str, &str)>) -> StatusMapArgs {
    StatusMapArgs {
        wc_root: wc_root.into(),
        remote,
        refresh: false,
        username: credentials.map(|(user, _)| user.into()),
        password: credentials.map(|(_, password)| password.into()),
    }
}

async fn run_op(start: impl FnOnce(Sinks) -> Result<OperationId, CommandError>) -> OperationResult {
    let (sender, mut receiver) = unbounded_channel();
    let sinks = Sinks {
        progress: Arc::new(|_, _| {}),
        done: Arc::new(move |id, result| {
            sender.send((id, result)).ok();
        }),
    };
    start(sinks).unwrap();
    let finished = tokio::time::timeout(DONE_TIMEOUT, receiver.recv()).await;
    finished.expect("la operacion no termino").unwrap().1
}

fn forget_cached_credentials(server: &TestServer) {
    let authority = server.url.trim_start_matches(SERVER_SCHEME);
    let authority = authority.split('/').next().unwrap_or_default();
    let appdata = std::env::var_os("APPDATA").expect("falta APPDATA");
    let cache = PathBuf::from(appdata).join(SVN_AUTH_CACHE);
    for cached in fs::read_dir(cache).unwrap().flatten() {
        let text = fs::read_to_string(cached.path()).unwrap_or_default();
        if text.contains(authority) {
            fs::remove_file(cached.path()).unwrap();
        }
    }
}

fn refreshed(request: StatusMapArgs) -> StatusMapArgs {
    StatusMapArgs {
        refresh: true,
        ..request
    }
}

fn saved_text(service: &FileService, file: &ScopedPath) -> TextUpdate {
    let document = service.read_text(file).unwrap();
    TextUpdate {
        content: "dos".into(),
        encoding: document.encoding,
        has_bom: document.has_bom,
        eol: document.eol,
        expected_version: document.version,
    }
}

fn update_args(revision: Option<u64>) -> UpdateArgs {
    UpdateArgs {
        path: WC.into(),
        revision,
        ignore_externals: false,
        username: None,
        password: None,
    }
}

fn commit_args() -> CommitArgs {
    CommitArgs {
        path: WC.into(),
        message: "cambio".into(),
        username: None,
        password: None,
    }
}

fn kind_of<T: std::fmt::Debug>(result: Result<T, CommandError>) -> CommandErrorKind {
    result.unwrap_err().kind
}

#[tokio::test]
async fn a_folder_that_is_not_a_working_copy_reads_as_having_no_changes() {
    let env = Env::new();
    fs::create_dir(env.dir("plana")).unwrap();
    fs::write(env.dir("plana").join("n.txt"), "x").unwrap();
    let query = StatusQuery {
        wc: env.workspace.resolve(Path::new("plana"), true).unwrap(),
        ..env.query(false)
    };
    let map = env.reader().read(query).await.unwrap();
    assert!(map.entries.is_empty() && map.changed_folders.is_empty());
}

#[tokio::test]
async fn a_slow_svn_returns_the_typed_timed_out_error() {
    let env = Env::new();
    let reader = env.reader().with_timeout(Duration::from_millis(1));
    let error = reader.read(env.query(false)).await.unwrap_err();
    let SvnClientError::Svn(svn_error) = &error else {
        panic!("se esperaba un error de svn");
    };
    assert_eq!(svn_error.kind, SvnErrorKind::TimedOut);
    assert_eq!(CommandError::from(error).kind, CommandErrorKind::TimedOut);
}

#[tokio::test]
async fn a_timed_out_read_is_not_cached() {
    let env = Env::new();
    let slow = env.reader().with_timeout(Duration::from_millis(1));
    assert!(slow.read(env.query(false)).await.is_err());
    env.seed(&[("a.txt", "uno")]);
    assert!(env.map().await.entries.is_empty());
}

#[tokio::test]
async fn a_path_outside_the_workspace_is_rejected_before_svn_runs() {
    let env = Env::new();
    let state = env.state();
    let parent = state.wc_status_map(args(r"..\fuera", false, None)).await;
    assert_eq!(kind_of(parent), CommandErrorKind::InvalidPath);
    let outside = env.root().parent().unwrap().to_string_lossy().into_owned();
    let absolute = state.wc_status_map(args(&outside, false, None)).await;
    assert_eq!(kind_of(absolute), CommandErrorKind::OutsideWorkspace);
}

#[tokio::test]
async fn a_status_without_a_workspace_reports_no_workspace() {
    let tmp = TempDir::new().unwrap();
    let state = AppState::new(ConfigStore {
        path: tmp.path().join(CONFIG_FILE_NAME),
    });
    let result = state.wc_status_map(args(WC, false, None)).await;
    assert_eq!(kind_of(result), CommandErrorKind::NoWorkspace);
}

#[tokio::test]
async fn a_password_without_a_username_is_rejected_before_svn_runs() {
    let env = Env::new();
    let mut request = args(WC, false, Some(("", "clave")));
    request.username = None;
    let result = env.state().wc_status_map(request).await;
    assert_eq!(kind_of(result), CommandErrorKind::InvalidPath);
}

#[tokio::test]
async fn a_private_server_without_credentials_reports_auth_required_for_the_remote_status() {
    let (env, _server) = private_env();
    env.seed(&[("a.txt", "uno")]);
    let result = env.state().wc_status_map(args(WC, true, None)).await;
    assert_eq!(kind_of(result), CommandErrorKind::AuthRequired);
}

#[tokio::test]
async fn a_wrong_password_reports_auth_required_without_leaking_it() {
    let (env, _server) = private_env();
    env.seed(&[("a.txt", "uno")]);
    let wrong = Some((SERVER_USER, WRONG_PASSWORD));
    let error = env
        .state()
        .wc_status_map(args(WC, true, wrong))
        .await
        .unwrap_err();
    assert_eq!(error.kind, CommandErrorKind::AuthRequired);
    assert!(
        !serde_json::to_string(&error)
            .unwrap()
            .contains(WRONG_PASSWORD)
    );
}

#[tokio::test]
async fn the_local_status_of_a_private_working_copy_needs_no_credentials() {
    let (env, _server) = private_env();
    env.seed(&[("a.txt", "uno")]);
    env.write("a.txt", "dos");
    let map = env
        .state()
        .wc_status_map(args(WC, false, None))
        .await
        .unwrap();
    assert_eq!(item(&map, "a.txt"), StatusItem::Modified);
}

#[tokio::test]
async fn username_and_password_through_stdin_let_the_remote_status_through() {
    let (env, _server) = private_env();
    env.seed(&[("a.txt", "uno")]);
    env.make_peer();
    env.peer_commit("a.txt", "remoto");
    let right = Some((SERVER_USER, SERVER_PASSWORD));
    let map = env
        .state()
        .wc_status_map(args(WC, true, right))
        .await
        .unwrap();
    assert_eq!(entry(&map, "a.txt").remote_item, Some(StatusItem::Modified));
}

#[test]
fn a_store_made_after_an_invalidation_started_before_it_is_dropped() {
    let cache = StatusCache::default();
    let wc = Path::new(r"C:\ws\wc");
    let Lookup::Miss { generation } = cache.lookup(key(wc, false)) else {
        panic!("la cache empieza vacia");
    };
    cache.invalidate(wc);
    cache.store(key(wc, false), generation, &WcStatusMap::default());
    assert!(matches!(cache.lookup(key(wc, false)), Lookup::Miss { .. }));
}

#[test]
fn a_store_with_the_current_generation_is_served_back() {
    let cache = StatusCache::default();
    let wc = Path::new(r"C:\ws\wc");
    let Lookup::Miss { generation } = cache.lookup(key(wc, false)) else {
        panic!("la cache empieza vacia");
    };
    cache.store(key(wc, false), generation, &WcStatusMap::default());
    assert!(matches!(cache.lookup(key(wc, false)), Lookup::Hit(_)));
    assert!(matches!(cache.lookup(key(wc, true)), Lookup::Miss { .. }));
}

#[test]
fn invalidating_a_working_copy_leaves_a_sibling_cached() {
    let cache = StatusCache::default();
    let (mine, other) = (Path::new(r"C:\ws\mia"), Path::new(r"C:\ws\otra"));
    for wc in [mine, other] {
        cache.store(key(wc, false), 0, &WcStatusMap::default());
    }
    cache.invalidate(mine);
    assert!(matches!(
        cache.lookup(key(mine, false)),
        Lookup::Miss { .. }
    ));
    assert!(matches!(cache.lookup(key(other, false)), Lookup::Hit(_)));
}

#[test]
fn invalidating_a_nested_or_enclosing_path_drops_the_cached_working_copy() {
    let cache = StatusCache::default();
    let wc = Path::new(r"C:\ws\wc");
    cache.store(key(wc, true), 0, &WcStatusMap::default());
    cache.invalidate(Path::new(r"C:\ws\wc\sub"));
    assert!(matches!(cache.lookup(key(wc, true)), Lookup::Miss { .. }));
    cache.store(key(wc, true), 1, &WcStatusMap::default());
    cache.invalidate(Path::new(r"C:\ws"));
    assert!(matches!(cache.lookup(key(wc, true)), Lookup::Miss { .. }));
}

#[test]
fn the_cache_ignores_the_case_of_the_working_copy_path() {
    let cache = StatusCache::default();
    cache.store(
        key(Path::new(r"C:\WS\Wc"), false),
        0,
        &WcStatusMap::default(),
    );
    assert!(matches!(
        cache.lookup(key(Path::new(r"c:\ws\wc"), false)),
        Lookup::Hit(_)
    ));
}

#[tokio::test]
async fn a_second_read_is_served_from_the_cache_until_it_is_invalidated() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("a.txt", "dos");
    assert_eq!(item(&env.map().await, "a.txt"), StatusItem::Modified);
    env.svn(&["revert", "a.txt"]);
    assert_eq!(item(&env.map().await, "a.txt"), StatusItem::Modified);
    env.cache.invalidate(&env.dir(WC));
    assert!(env.map().await.entries.is_empty());
}

#[tokio::test]
async fn local_and_remote_reads_of_the_same_copy_are_cached_apart() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.make_peer();
    env.peer_commit("a.txt", "remoto");
    assert!(env.map().await.entries.is_empty());
    let remote = env.remote_map().await;
    assert_eq!(
        entry(&remote, "a.txt").remote_item,
        Some(StatusItem::Modified)
    );
    assert!(env.map().await.entries.is_empty());
}

#[tokio::test]
async fn the_same_copy_asked_with_another_path_case_hits_the_same_cache_entry() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("a.txt", "dos");
    env.map().await;
    env.svn(&["revert", "a.txt"]);
    let upper = StatusQuery {
        wc: env.workspace.resolve(Path::new("WC"), true).unwrap(),
        ..env.query(false)
    };
    let map = env.reader().read(upper).await.unwrap();
    assert_eq!(item(&map, "a.txt"), StatusItem::Modified);
}

#[tokio::test]
async fn two_working_copies_do_not_share_cached_state() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.make_peer();
    fs::write(env.dir(PEER).join("a.txt"), "peer").unwrap();
    let peer_query = StatusQuery {
        wc: env.workspace.resolve(Path::new(PEER), true).unwrap(),
        ..env.query(false)
    };
    let peer_map = env.reader().read(peer_query).await.unwrap();
    assert_eq!(peer_map.entries[0].path, format!(r"{PEER}\a.txt"));
    assert!(env.map().await.entries.is_empty());
}

#[tokio::test]
async fn a_commit_invalidates_the_cached_status_of_its_copy() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("a.txt", "dos");
    let state = env.state();
    let before = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert_eq!(item(&before, "a.txt"), StatusItem::Modified);
    let done = run_op(|sinks| state.start_commit(commit_args(), sinks)).await;
    assert!(matches!(done, OperationResult::Ok { .. }), "{done:?}");
    let after = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert!(after.entries.is_empty());
}

#[tokio::test]
async fn an_update_invalidates_the_cached_status_of_its_copy() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno"), ("b.txt", "uno")]);
    env.write("a.txt", "dos");
    let state = env.state();
    state.wc_status_map(args(WC, false, None)).await.unwrap();
    env.write("b.txt", "dos");
    let stale = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert!(find(&stale, "b.txt").is_none());
    let done = run_op(|sinks| state.start_update(update_args(None), sinks)).await;
    assert!(matches!(done, OperationResult::Ok { .. }), "{done:?}");
    let fresh = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert_eq!(item(&fresh, "b.txt"), StatusItem::Modified);
}

#[tokio::test]
async fn a_failed_operation_also_invalidates_the_cached_status() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    let state = env.state();
    state.wc_status_map(args(WC, false, None)).await.unwrap();
    env.write("a.txt", "dos");
    let done = run_op(|sinks| state.start_update(update_args(Some(9999)), sinks)).await;
    assert!(matches!(done, OperationResult::Err(_)), "{done:?}");
    let fresh = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert_eq!(item(&fresh, "a.txt"), StatusItem::Modified);
}

#[tokio::test]
async fn a_checkout_inside_the_copy_invalidates_its_cached_status() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    let state = env.state();
    state.wc_status_map(args(WC, false, None)).await.unwrap();
    env.write("a.txt", "dos");
    let checkout = CheckoutArgs {
        url: env.url.clone(),
        dest: format!(r"{WC}\anidada"),
        revision: None,
        depth: Depth::Infinity,
        ignore_externals: false,
        username: None,
        password: None,
    };
    let done = run_op(|sinks| state.start_checkout(checkout, sinks)).await;
    assert!(matches!(done, OperationResult::Ok { .. }), "{done:?}");
    let fresh = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert_eq!(item(&fresh, "a.txt"), StatusItem::Modified);
}

async fn lock_working_copy(env: &Env) {
    let flag = install_stalling_hook(&env.repo);
    env.write("a.txt", "dos");
    let mut commit = Command::new(&env.repo.svn.path)
        .args(["commit", "-m", "x", "--non-interactive"])
        .current_dir(env.dir(WC))
        .spawn()
        .unwrap();
    wait_for_file(&flag).await;
    commit.kill().unwrap();
    commit.wait().unwrap();
}

#[tokio::test]
async fn an_interrupted_commit_leaves_the_copy_locked_and_cleanup_clears_it() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    lock_working_copy(&env).await;
    let state = env.state();
    let locked = state.wc_status_map(args(WC, false, None)).await.unwrap();
    let root = locked.entries.iter().find(|entry| entry.path == WC);
    assert!(root.is_some_and(|entry| entry.wc_locked), "{locked:?}");
    let cleanup = CleanupArgs { path: WC.into() };
    let done = run_op(|sinks| state.start_cleanup(cleanup, sinks)).await;
    assert!(matches!(done, OperationResult::Ok { .. }), "{done:?}");
    let fresh = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert!(fresh.entries.iter().all(|entry| !entry.wc_locked));
}

#[tokio::test]
async fn a_saved_file_invalidates_the_cached_status() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    let state = env.state();
    let before = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert!(before.entries.is_empty());
    let service = state.file_service().unwrap();
    let file = service.scope(Path::new(&wc_path("a.txt"))).unwrap();
    service
        .write_text(&file, &saved_text(&service, &file))
        .unwrap();
    let after = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert_eq!(item(&after, "a.txt"), StatusItem::Modified);
}

#[tokio::test]
async fn a_refresh_skips_the_cached_status_and_stores_the_fresh_one() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("a.txt", "dos");
    let state = env.state();
    state.wc_status_map(args(WC, false, None)).await.unwrap();
    env.svn(&["revert", "a.txt"]);
    let fresh = state.wc_status_map(refreshed(args(WC, false, None)));
    assert!(fresh.await.unwrap().entries.is_empty());
    let cached = state.wc_status_map(args(WC, false, None)).await.unwrap();
    assert!(cached.entries.is_empty());
}

#[tokio::test]
async fn a_remote_read_always_asks_the_server_again() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.make_peer();
    let state = env.state();
    let before = state.wc_status_map(args(WC, true, None)).await.unwrap();
    assert!(before.entries.is_empty());
    env.peer_commit("a.txt", "remoto");
    let after = state.wc_status_map(args(WC, true, None)).await.unwrap();
    assert_eq!(
        entry(&after, "a.txt").remote_item,
        Some(StatusItem::Modified)
    );
}

#[tokio::test]
async fn a_remote_read_without_credentials_is_not_served_from_an_authenticated_one() {
    let (env, server) = private_env();
    env.seed(&[("a.txt", "uno")]);
    let state = env.state();
    let right = Some((SERVER_USER, SERVER_PASSWORD));
    state.wc_status_map(args(WC, true, right)).await.unwrap();
    forget_cached_credentials(&server);
    let anonymous = state.wc_status_map(args(WC, true, None)).await;
    assert_eq!(kind_of(anonymous), CommandErrorKind::AuthRequired);
}

#[tokio::test]
async fn the_entry_cap_keeps_conflicts_and_missing_files_before_plain_changes() {
    let env = Env::new();
    env.seed(&[("c.txt", BASE_LINES), ("falta.txt", "x")]);
    env.make_peer();
    env.peer_commit(
        "c.txt",
        "uno
par
tres
",
    );
    env.write(
        "c.txt",
        "uno
local
tres
",
    );
    env.svn_as(&["update", "--accept", "postpone"]);
    fs::remove_file(env.dir(WC).join("falta.txt")).unwrap();
    for name in ["a1.txt", "a2.txt", "a3.txt"] {
        env.write(name, "x");
    }
    let capped = env.reader().with_max_entries(2);
    let map = capped.read(env.query(false)).await.unwrap();
    assert!(map.truncated);
    assert_eq!(item(&map, "c.txt"), StatusItem::Conflicted);
    assert_eq!(item(&map, "falta.txt"), StatusItem::Missing);
}

#[tokio::test]
async fn the_entry_cap_keeps_real_changes_before_ignored_files_and_flags_the_truncation() {
    let env = Env::new();
    env.seed(&[("ign/leeme.txt", "x")]);
    env.svn(&["propset", "svn:ignore", "*.tmp", "ign"]);
    env.svn_as(&["commit", "-m", "ignore"]);
    for name in ["ign/a.tmp", "ign/b.tmp", "u1.txt", "u2.txt", "u3.txt"] {
        env.write(name, "x");
    }
    let capped = env
        .reader()
        .with_max_entries(3)
        .read(env.query(false))
        .await;
    let map = capped.unwrap();
    assert!(map.truncated);
    assert_eq!(map.entries.len(), 3);
    assert!(
        map.entries
            .iter()
            .all(|e| e.item == StatusItem::Unversioned)
    );
}

#[tokio::test]
async fn the_entry_cap_does_not_flag_truncation_when_the_count_fits_exactly() {
    let env = Env::new();
    env.seed(&[("a.txt", "x")]);
    for name in ["u1.txt", "u2.txt", "u3.txt"] {
        env.write(name, "x");
    }
    let exact = env
        .reader()
        .with_max_entries(3)
        .read(env.query(false))
        .await;
    let map = exact.unwrap();
    assert!(!map.truncated);
    assert_eq!(map.entries.len(), 3);
}

#[tokio::test]
async fn folders_of_the_entries_dropped_by_the_cap_are_still_marked() {
    let env = Env::new();
    env.seed(&[(r"hondo\profundo\x.txt", "uno")]);
    env.write(r"hondo\profundo\x.txt", "dos");
    env.write("a-suelto.txt", "x");
    let capped = env
        .reader()
        .with_max_entries(1)
        .read(env.query(false))
        .await;
    let map = capped.unwrap();
    assert!(map.truncated);
    assert!(find(&map, r"hondo\profundo\x.txt").is_none());
    assert!(map.changed_folders.contains(&wc_path(r"hondo\profundo")));
    assert!(map.changed_folders.contains(&wc_path("hondo")));
}

#[test]
fn the_default_entry_cap_is_large_enough_for_a_normal_copy_and_finite() {
    assert!((1_000..=100_000).contains(&MAX_STATUS_ENTRIES));
}

#[tokio::test]
async fn every_ancestor_up_to_the_copy_root_is_a_changed_folder() {
    let env = Env::new();
    env.seed(&[(r"a\b\c.txt", "uno"), (r"otra\d.txt", "uno")]);
    env.write(r"a\b\c.txt", "dos");
    let folders = env.map().await.changed_folders;
    assert_eq!(folders, [WC.to_string(), wc_path("a"), wc_path(r"a\b")]);
}

#[tokio::test]
async fn a_folder_holding_only_ignored_files_is_not_a_changed_folder() {
    let env = Env::new();
    env.seed(&[("ign/leeme.txt", "x")]);
    env.svn(&["propset", "svn:ignore", "*.tmp", "ign"]);
    env.svn_as(&["commit", "-m", "ignore"]);
    env.write("ign/x.tmp", "x");
    let map = env.map().await;
    assert_eq!(item(&map, r"ign\x.tmp"), StatusItem::Ignored);
    assert!(map.changed_folders.is_empty(), "{:?}", map.changed_folders);
}

#[tokio::test]
async fn a_copy_with_no_changes_reports_nothing_and_no_changed_folders() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    let map = env.map().await;
    assert!(map.entries.is_empty() && map.changed_folders.is_empty() && !map.truncated);
}

#[tokio::test]
async fn names_with_spaces_accents_xml_and_url_characters_come_back_intact() {
    let env = Env::new();
    env.seed(&[("a.txt", "x")]);
    let names = ["a#b%c d ñ@z.txt", "a&b ñ.txt", "con espacios.txt"];
    for name in names {
        env.write(name, "x");
    }
    let map = env.map().await;
    for name in names {
        assert_eq!(item(&map, name), StatusItem::Unversioned, "{name}");
    }
}

#[tokio::test]
async fn a_copy_at_the_workspace_root_reports_paths_without_prefix() {
    let tmp = TempDir::new().unwrap();
    let repo = TestRepo::create();
    let client = SvnClient::new(SvnRunner::new(repo.svn.path.clone()));
    let workspace = Workspace::new(tmp.path()).unwrap();
    let checkout = Command::new(&repo.svn.path)
        .args(["checkout", &repo.url, "."])
        .current_dir(workspace.root().as_path())
        .output()
        .unwrap();
    assert!(checkout.status.success());
    fs::write(workspace.root().as_path().join("n.txt"), "x").unwrap();
    let wc = workspace.resolve(Path::new(""), true).unwrap();
    let query = StatusQuery {
        wc,
        remote: false,
        refresh: false,
        username: None,
        password: None,
    };
    let reader = WcStatusReader::new(workspace, client, Arc::default());
    let map = reader.read(query).await.unwrap();
    assert_eq!(map.entries[0].path, "n.txt");
    assert_eq!(map.changed_folders, [String::new()]);
}

#[tokio::test]
async fn ignored_files_are_listed_only_when_the_request_asks_for_them() {
    let env = Env::new();
    env.seed(&[("ign/leeme.txt", "x")]);
    env.svn(&["propset", "svn:ignore", "*.tmp", "ign"]);
    env.svn_as(&["commit", "-m", "ignore"]);
    env.write("ign/x.tmp", "x");
    let client = SvnClient::new(SvnRunner::new(env.repo.svn.path.clone()));
    let request = |ignored| StatusRequest {
        target: env.dir(WC),
        remote: false,
        ignored,
        username: None,
    };
    let hidden = client.status(&request(false), RunOptions::default()).await;
    let shown = client.status(&request(true), RunOptions::default()).await;
    assert!(hidden.unwrap().entries.is_empty());
    assert_eq!(shown.unwrap().entries[0].item, StatusItem::Ignored);
}

#[tokio::test]
async fn a_modified_file_is_modified() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("a.txt", "dos");
    assert_eq!(item(&env.map().await, "a.txt"), StatusItem::Modified);
}

#[tokio::test]
async fn a_property_change_alone_makes_the_entry_notable() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.svn(&["propset", "svn:eol-style", "native", "a.txt"]);
    let map = env.map().await;
    assert_eq!(entry(&map, "a.txt").props, StatusItem::Modified);
}

#[tokio::test]
async fn an_added_file_is_added() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("nuevo.txt", "x");
    env.svn(&["add", "nuevo.txt"]);
    assert_eq!(item(&env.map().await, "nuevo.txt"), StatusItem::Added);
}

#[tokio::test]
async fn a_deleted_file_is_deleted() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.svn(&["rm", "a.txt"]);
    assert_eq!(item(&env.map().await, "a.txt"), StatusItem::Deleted);
}

#[tokio::test]
async fn a_file_deleted_and_added_again_is_replaced() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.svn(&["rm", "a.txt"]);
    env.write("a.txt", "otro");
    env.svn(&["add", "a.txt"]);
    assert_eq!(item(&env.map().await, "a.txt"), StatusItem::Replaced);
}

#[tokio::test]
async fn an_unversioned_file_is_unversioned() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("suelto.txt", "x");
    assert_eq!(
        item(&env.map().await, "suelto.txt"),
        StatusItem::Unversioned
    );
}

#[tokio::test]
async fn a_versioned_file_removed_from_disk_is_missing() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    fs::remove_file(env.dir(WC).join("a.txt")).unwrap();
    assert_eq!(item(&env.map().await, "a.txt"), StatusItem::Missing);
}

#[tokio::test]
async fn a_file_replaced_on_disk_by_a_folder_is_a_type_change() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    fs::remove_file(env.dir(WC).join("a.txt")).unwrap();
    fs::create_dir(env.dir(WC).join("a.txt")).unwrap();
    assert_eq!(item(&env.map().await, "a.txt"), StatusItem::Obstructed);
}

#[tokio::test]
async fn a_file_matching_svn_ignore_is_ignored() {
    let env = Env::new();
    env.seed(&[("ign/leeme.txt", "x")]);
    env.svn(&["propset", "svn:ignore", "*.tmp", "ign"]);
    env.svn_as(&["commit", "-m", "ignore"]);
    env.write("ign/x.tmp", "x");
    assert_eq!(item(&env.map().await, r"ign\x.tmp"), StatusItem::Ignored);
}

#[tokio::test]
async fn an_svn_external_is_external() {
    let env = Env::new();
    env.seed(&[("src/a.txt", "x"), ("ext/leeme.txt", "x")]);
    env.svn(&["propset", "svn:externals", "^/src fuente", "ext"]);
    env.svn_as(&["commit", "-m", "externo"]);
    env.svn_as(&["update"]);
    assert_eq!(item(&env.map().await, r"ext\fuente"), StatusItem::External);
}

#[tokio::test]
async fn two_copies_editing_the_same_line_end_in_a_text_conflict() {
    let env = Env::new();
    env.seed(&[("c.txt", BASE_LINES)]);
    env.make_peer();
    env.peer_commit("c.txt", "uno\npar\ntres\n");
    env.write("c.txt", "uno\nlocal\ntres\n");
    env.svn_as(&["update", "--accept", "postpone"]);
    let map = env.map().await;
    assert_eq!(item(&map, "c.txt"), StatusItem::Conflicted);
    assert!(!entry(&map, "c.txt").tree_conflicted);
}

#[tokio::test]
async fn a_local_edit_against_a_remote_delete_is_a_tree_conflict() {
    let env = Env::new();
    env.seed(&[("t.txt", BASE_LINES)]);
    let peer = env.make_peer();
    env.run(&peer, &["rm", "t.txt"], false);
    env.run(&peer, &["commit", "-m", "borra"], true);
    env.write("t.txt", "uno\nlocal\ntres\n");
    env.svn_as(&["update", "--accept", "postpone"]);
    assert!(entry(&env.map().await, "t.txt").tree_conflicted);
}

#[tokio::test]
async fn a_file_locked_with_svn_lock_carries_its_lock_owner_and_comment() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.svn_as(&["lock", "a.txt", "-m", "mi bloqueo"]);
    let map = env.map().await;
    let lock = entry(&map, "a.txt").lock.clone().expect("falta el bloqueo");
    assert_eq!(lock.comment.as_deref(), Some("mi bloqueo"));
    assert!(!lock.owner.is_empty());
    assert_eq!(item(&map, "a.txt"), StatusItem::Normal);
}

#[tokio::test]
async fn a_lock_held_by_another_copy_shows_with_the_remote_status() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    let peer = env.make_peer();
    env.run(&peer, &["lock", "a.txt", "-m", "ajeno"], true);
    assert!(env.map().await.entries.is_empty());
    let remote = env.remote_map().await;
    let lock = entry(&remote, "a.txt")
        .lock
        .clone()
        .expect("falta el bloqueo");
    assert_eq!(lock.comment.as_deref(), Some("ajeno"));
}

#[tokio::test]
async fn a_copied_folder_is_added_and_marked_copied() {
    let env = Env::new();
    env.seed(&[("src/a.txt", "x")]);
    env.svn(&["copy", "src", "src-copia"]);
    let map = env.map().await;
    assert_eq!(item(&map, "src-copia"), StatusItem::Added);
    assert!(entry(&map, "src-copia").copied);
}

#[tokio::test]
async fn a_folder_switched_to_another_branch_is_marked_switched() {
    let env = Env::new();
    env.seed(&[("swd/s.txt", "x")]);
    let (from, to) = (format!("{}/swd", env.url), format!("{}/swd2", env.url));
    env.svn_as(&["copy", &from, &to, "-m", "rama"]);
    env.svn_as(&["switch", &to, "swd"]);
    let map = env.map().await;
    assert!(entry(&map, "swd").switched);
    assert_eq!(item(&map, "swd"), StatusItem::Normal);
}

#[tokio::test]
async fn the_remote_status_reports_what_another_copy_committed() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.make_peer();
    env.peer_commit("a.txt", "remoto");
    let map = env.remote_map().await;
    assert_eq!(entry(&map, "a.txt").remote_item, Some(StatusItem::Modified));
    assert_eq!(item(&map, "a.txt"), StatusItem::Normal);
    assert_eq!(map.against_revision, Some(2));
}

#[tokio::test]
async fn the_containing_folder_of_a_remote_change_is_marked() {
    let env = Env::new();
    env.seed(&[(r"d\a.txt", "uno")]);
    let peer = env.make_peer();
    fs::write(peer.join(r"d\a.txt"), "remoto").unwrap();
    env.run(&peer, &["commit", "-m", "par"], true);
    let map = env.remote_map().await;
    assert!(map.changed_folders.contains(&wc_path("d")));
}

#[tokio::test]
async fn every_state_of_the_scenario_comes_back_in_one_read_with_its_containing_folder() {
    let env = Env::new();
    env.seed(&[(r"carpeta\mod.txt", "uno"), (r"carpeta\del.txt", "uno")]);
    env.write(r"carpeta\mod.txt", "dos");
    env.svn(&["rm", r"carpeta\del.txt"]);
    env.write(r"carpeta\nuevo.txt", "x");
    let map = env.map().await;
    assert_eq!(item(&map, r"carpeta\mod.txt"), StatusItem::Modified);
    assert_eq!(item(&map, r"carpeta\del.txt"), StatusItem::Deleted);
    assert_eq!(item(&map, r"carpeta\nuevo.txt"), StatusItem::Unversioned);
    assert_eq!(map.changed_folders, [WC.to_string(), wc_path("carpeta")]);
}

#[tokio::test]
async fn a_changed_file_comes_back_relative_to_the_workspace_with_its_folder() {
    let env = Env::new();
    env.seed(&[("a.txt", "uno")]);
    env.write("a.txt", "dos");
    let map = env.map().await;
    assert_eq!(map.entries.len(), 1);
    assert_eq!(map.entries[0].path, wc_path("a.txt"));
    assert_eq!(map.changed_folders, [WC.to_string()]);
    assert!(!map.truncated);
}

mod files;
pub mod protocol;
mod ui;
mod window;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::app::args::{CheckoutArgs, CleanupArgs, CommitArgs, StatusMapArgs, UpdateArgs};
use crate::app::error::CommandError;
use crate::app::operations::OperationId;
use crate::app::state::{AppState, OperationResult, Sinks, SvnDetection};
use crate::app::wc_status::WcStatusMap;
use crate::svn::models::{InfoEntry, StatusReport};
use crate::svn::progress::ProgressEvent;

pub use files::*;
pub use ui::*;
pub use window::*;

const PROGRESS_EVENT: &str = "svn://progress";
const DONE_EVENT: &str = "svn://done";

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub id: OperationId,
    pub event: ProgressEvent,
}

#[derive(Clone, Serialize)]
pub struct DonePayload {
    pub id: OperationId,
    pub result: OperationResult,
}

fn sinks(app: AppHandle) -> Sinks {
    let done_app = app.clone();
    Sinks {
        progress: Arc::new(move |id, event| {
            app.emit(PROGRESS_EVENT, ProgressPayload { id, event }).ok();
        }),
        done: Arc::new(move |id, result| {
            done_app.emit(DONE_EVENT, DonePayload { id, result }).ok();
        }),
    }
}

#[tauri::command]
pub fn workspace_get(state: State<'_, AppState>) -> Option<PathBuf> {
    state.workspace_get()
}

#[tauri::command]
pub fn workspace_set(path: String, state: State<'_, AppState>) -> Result<PathBuf, CommandError> {
    state.workspace_set(Path::new(&path))
}

#[tauri::command(async)]
pub fn svn_detect(state: State<'_, AppState>) -> SvnDetection {
    state.svn_detect()
}

#[tauri::command(async)]
pub fn svn_set_path(path: String, state: State<'_, AppState>) -> SvnDetection {
    state.svn_set_path(Path::new(&path))
}

#[tauri::command]
pub async fn wc_info(path: String, state: State<'_, AppState>) -> Result<InfoEntry, CommandError> {
    state.wc_info(&path).await
}

#[tauri::command]
pub async fn wc_status(
    path: String,
    remote: bool,
    state: State<'_, AppState>,
) -> Result<StatusReport, CommandError> {
    state.wc_status(&path, remote).await
}

#[tauri::command]
pub async fn wc_status_map(
    req: StatusMapArgs,
    state: State<'_, AppState>,
) -> Result<WcStatusMap, CommandError> {
    state.wc_status_map(req).await
}

#[tauri::command]
pub async fn svn_checkout(
    req: CheckoutArgs,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<OperationId, CommandError> {
    state.start_checkout(req, sinks(app))
}

#[tauri::command]
pub async fn wc_update(
    req: UpdateArgs,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<OperationId, CommandError> {
    state.start_update(req, sinks(app))
}

#[tauri::command]
pub async fn wc_commit(
    req: CommitArgs,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<OperationId, CommandError> {
    state.start_commit(req, sinks(app))
}

#[tauri::command]
pub async fn wc_cleanup(
    req: CleanupArgs,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<OperationId, CommandError> {
    state.start_cleanup(req, sinks(app))
}

#[tauri::command]
pub fn op_cancel(id: u64, state: State<'_, AppState>) -> bool {
    state.op_cancel(OperationId(id))
}

#[tauri::command]
pub fn wc_needs_cleanup(path: String, state: State<'_, AppState>) -> Result<bool, CommandError> {
    state.wc_needs_cleanup(&path)
}

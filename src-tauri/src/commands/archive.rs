use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::app::archive::extract::{ExtractReport, Progress, ProgressSink};
use crate::app::archive::listing::ArchiveListing;
use crate::app::archive::service::{ArchiveService, ExtractOptions};
use crate::app::archive::{ArchiveError, Cancel};
use crate::app::error::{CommandError, CommandErrorKind};
use crate::app::state::{AppState, blocking};

const ARCHIVE_PROGRESS_EVENT: &str = "archive://progress";

#[derive(Clone, Serialize)]
struct ProgressPayload {
    id: u64,
    #[serde(flatten)]
    progress: Progress,
}

async fn run_task<T, F>(state: &AppState, id: u64, job: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce(ArchiveService, Cancel) -> Result<T, ArchiveError> + Send + 'static,
{
    let service = state.archive_service()?;
    let tasks = state.archive_tasks();
    let Some(cancel) = tasks.begin(id) else {
        return Err(CommandError::new(
            CommandErrorKind::InvalidPath,
            "ya hay una tarea de comprimidos con ese identificador",
        ));
    };
    let outcome = blocking(move || job(service, cancel)).await;
    tasks.finish(id);
    Ok(outcome??)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn archive_list(
    path: String,
    task_id: u64,
    state: State<'_, AppState>,
) -> Result<ArchiveListing, CommandError> {
    run_task(&state, task_id, move |service, cancel| {
        service.list(&PathBuf::from(path), &cancel)
    })
    .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn archive_extract(
    path: String,
    task_id: u64,
    allow_suspicious: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExtractReport, CommandError> {
    run_task(&state, task_id, move |service, cancel| {
        let options = ExtractOptions { allow_suspicious };
        let report: ProgressSink = Arc::new(move |progress| {
            app.emit(
                ARCHIVE_PROGRESS_EVENT,
                ProgressPayload {
                    id: task_id,
                    progress,
                },
            )
            .ok();
        });
        service.extract(&PathBuf::from(path), options, &cancel, report)
    })
    .await
}

#[tauri::command(rename_all = "snake_case")]
pub fn archive_cancel(task_id: u64, state: State<'_, AppState>) -> bool {
    state.archive_tasks().cancel(task_id)
}

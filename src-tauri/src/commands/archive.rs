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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{CONFIG_FILE_NAME, ConfigStore};

    fn state_in(dir: &std::path::Path) -> AppState {
        let root = dir.join("raiz");
        std::fs::create_dir(&root).unwrap();
        let store = ConfigStore {
            path: dir.join("cfg").join(CONFIG_FILE_NAME),
        };
        let state = AppState::new(store);
        state.workspace_set(&root).unwrap();
        state
    }

    #[tokio::test]
    async fn a_task_id_already_running_is_refused_as_an_invalid_path() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        let _held = state.archive_tasks().begin(7).unwrap();
        let refused = run_task(&state, 7, |_, _| Ok(())).await.unwrap_err();
        assert!(matches!(refused.kind, CommandErrorKind::InvalidPath));
    }

    #[tokio::test]
    async fn a_failed_job_still_releases_its_task_id() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        let failed = run_task(&state, 8, |_, _| -> Result<(), ArchiveError> {
            Err(ArchiveError::Cancelled)
        })
        .await;
        assert!(failed.is_err());
        assert!(state.archive_tasks().begin(8).is_some());
    }

    #[test]
    fn progress_travels_as_archive_progress_with_the_task_id() {
        let payload = ProgressPayload {
            id: 5,
            progress: Progress {
                files: 1,
                bytes: 2,
                total_bytes: 3,
            },
        };
        let expected = serde_json::json!({"id": 5, "files": 1, "bytes": 2, "total_bytes": 3});
        assert_eq!(serde_json::to_value(&payload).unwrap(), expected);
        let api = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/services/archiveApi.ts"
        ))
        .unwrap();
        assert!(api.contains(&format!("'{ARCHIVE_PROGRESS_EVENT}'")));
    }
}

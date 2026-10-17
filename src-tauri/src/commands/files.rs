use std::path::Path;

use tauri::State;
use tauri::ipc::Response;

use crate::app::args::WriteTextArgs;
use crate::app::error::CommandError;
use crate::app::files::{DirListing, FileError, FileProbe, FileService, TextDocument, TextWritten};
use crate::app::state::{AppState, blocking};

async fn run_blocking<T, F>(state: &AppState, job: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce(FileService) -> Result<T, FileError> + Send + 'static,
{
    let service = state.file_service()?;
    Ok(blocking(move || job(service)).await??)
}

#[tauri::command]
pub async fn fs_list(path: String, state: State<'_, AppState>) -> Result<DirListing, CommandError> {
    run_blocking(&state, move |service| {
        let dir = service.scope(Path::new(&path))?;
        service.list(&dir)
    })
    .await
}

#[tauri::command]
pub async fn fs_read_text(
    path: String,
    state: State<'_, AppState>,
) -> Result<TextDocument, CommandError> {
    run_blocking(&state, move |service| {
        let file = service.scope(Path::new(&path))?;
        service.read_text(&file)
    })
    .await
}

#[tauri::command]
pub async fn fs_write_text(
    req: WriteTextArgs,
    state: State<'_, AppState>,
) -> Result<TextWritten, CommandError> {
    run_blocking(&state, move |service| {
        let file = service.scope(Path::new(&req.path))?;
        service.write_text(&file, &req.update)
    })
    .await
}

#[tauri::command]
pub async fn fs_read_chunk(
    path: String,
    offset: u64,
    len: usize,
    state: State<'_, AppState>,
) -> Result<Response, CommandError> {
    let chunk = run_blocking(&state, move |service| {
        let file = service.scope(Path::new(&path))?;
        service.read_chunk(&file, offset, len)
    })
    .await?;
    Ok(Response::new(chunk))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn fs_probe(
    path: String,
    allow_download: bool,
    state: State<'_, AppState>,
) -> Result<FileProbe, CommandError> {
    run_blocking(&state, move |service| {
        let file = service.scope(Path::new(&path))?;
        service.probe(&file, allow_download)
    })
    .await
}

#[tauri::command]
pub async fn fs_can_open_external(
    path: String,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    run_blocking(&state, move |service| {
        let file = service.scope(Path::new(&path))?;
        Ok(service.can_open_external(&file))
    })
    .await
}

#[tauri::command]
pub async fn fs_open_external(
    path: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let launcher = state.launcher();
    run_blocking(&state, move |service| {
        let file = service.scope(Path::new(&path))?;
        service.open_external(&file, launcher.as_ref())
    })
    .await
}

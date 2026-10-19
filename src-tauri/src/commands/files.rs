use std::path::Path;

use percent_encoding::percent_decode_str;
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::app::args::WriteTextArgs;
use crate::app::error::{CommandError, CommandErrorKind};
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

const PATH_HEADER: &str = "path";
const VERSION_HEADER: &str = "expected-version";

fn bad_request(message: &str) -> CommandError {
    CommandError::new(CommandErrorKind::InvalidPath, message)
}

fn header_text(request: &Request<'_>, name: &str) -> Result<String, CommandError> {
    let value = request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok());
    value
        .map(str::to_owned)
        .ok_or_else(|| bad_request(&format!("falta la cabecera {name}")))
}

fn decoded_path(request: &Request<'_>) -> Result<String, CommandError> {
    let encoded = header_text(request, PATH_HEADER)?;
    let decoded = percent_decode_str(&encoded).decode_utf8();
    decoded
        .map(|path| path.into_owned())
        .map_err(|_| bad_request("la ruta no es UTF-8 válido"))
}

#[tauri::command]
pub async fn fs_write_bytes(
    request: Request<'_>,
    state: State<'_, AppState>,
) -> Result<TextWritten, CommandError> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err(bad_request("el contenido debe viajar como bytes crudos"));
    };
    let path = decoded_path(&request)?;
    let expected_version = header_text(&request, VERSION_HEADER)?;
    let bytes = body.clone();
    run_blocking(&state, move |service| {
        let file = service.scope(Path::new(&path))?;
        service.write_bytes(&file, &expected_version, &bytes)
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

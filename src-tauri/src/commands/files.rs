use std::path::Path;

use percent_encoding::percent_decode_str;
use tauri::State;
use tauri::http::HeaderMap;
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

fn header_text(headers: &HeaderMap, name: &str) -> Result<String, CommandError> {
    let value = headers.get(name).and_then(|value| value.to_str().ok());
    value
        .map(str::to_owned)
        .ok_or_else(|| bad_request(&format!("falta la cabecera {name}")))
}

fn decoded_path(headers: &HeaderMap) -> Result<String, CommandError> {
    let encoded = header_text(headers, PATH_HEADER)?;
    let decoded = percent_decode_str(&encoded).decode_utf8();
    decoded
        .map(|path| path.into_owned())
        .map_err(|_| bad_request("la ruta no es UTF-8 válido"))
}

struct WriteBytesRequest<'a> {
    path: String,
    expected_version: String,
    bytes: &'a [u8],
}

fn write_bytes_request<'a>(
    body: &'a InvokeBody,
    headers: &HeaderMap,
) -> Result<WriteBytesRequest<'a>, CommandError> {
    let InvokeBody::Raw(bytes) = body else {
        return Err(bad_request("el contenido debe viajar como bytes crudos"));
    };
    Ok(WriteBytesRequest {
        path: decoded_path(headers)?,
        expected_version: header_text(headers, VERSION_HEADER)?,
        bytes,
    })
}

#[tauri::command]
pub async fn fs_write_bytes(
    request: Request<'_>,
    state: State<'_, AppState>,
) -> Result<TextWritten, CommandError> {
    let parsed = write_bytes_request(request.body(), request.headers())?;
    let (path, expected_version) = (parsed.path, parsed.expected_version);
    let bytes = parsed.bytes.to_vec();
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

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::HeaderValue;

    fn headers(path: Option<&str>, version: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(path) = path {
            headers.insert(PATH_HEADER, HeaderValue::from_str(path).unwrap());
        }
        if let Some(version) = version {
            headers.insert(VERSION_HEADER, HeaderValue::from_str(version).unwrap());
        }
        headers
    }

    fn raw() -> InvokeBody {
        InvokeBody::Raw(vec![1, 2, 3])
    }

    fn refused(body: &InvokeBody, headers: &HeaderMap) -> bool {
        matches!(
            write_bytes_request(body, headers),
            Err(error) if error.kind == CommandErrorKind::InvalidPath
        )
    }

    #[test]
    fn a_complete_request_carries_its_path_version_and_bytes() {
        let ok = headers(Some("a%20b%2Fc.docx"), Some("1-2-3"));
        let body = raw();
        let parsed = write_bytes_request(&body, &ok).unwrap();
        assert_eq!(parsed.path, "a b/c.docx");
        assert_eq!(parsed.expected_version, "1-2-3");
        assert_eq!(parsed.bytes, [1, 2, 3]);
    }

    #[test]
    fn a_json_body_is_refused_as_an_invalid_path() {
        let json = InvokeBody::Json(serde_json::json!({}));
        assert!(refused(&json, &headers(Some("a"), Some("v"))));
    }

    #[test]
    fn the_path_header_is_required() {
        assert!(refused(&raw(), &headers(None, Some("v"))));
    }

    #[test]
    fn the_path_must_be_valid_utf8_after_decoding() {
        assert!(refused(&raw(), &headers(Some("%FF"), Some("v"))));
    }

    #[test]
    fn the_expected_version_header_is_required() {
        assert!(refused(&raw(), &headers(Some("a"), None)));
    }
}

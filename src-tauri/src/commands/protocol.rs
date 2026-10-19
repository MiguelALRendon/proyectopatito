use std::io;
use std::path::{Component, Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::http::header::{self, HeaderMap, HeaderName, HeaderValue};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::app::files::{FileError, FileService, Served};
use crate::app::range::{self, Outcome, Range, RangeError};
use crate::app::state::AppState;
use crate::app::workspace::{ScopedPath, WorkspaceError};

pub const SCHEME: &str = "workspace-file";

const APP_ORIGIN: &str = "http://tauri.localhost";
const DEV_ORIGIN: &str = "http://localhost:1420";
const ALLOWED_METHODS: &str = "GET, HEAD, OPTIONS";
const ALLOWED_REQUEST_HEADERS: &str = "Range";
const EXPOSED_HEADERS: &str = "Content-Range, Accept-Ranges, Content-Length";
const UNSATISFIED_RANGE: &str = "bytes */";

const CROSS_ORIGIN_RESOURCE_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-resource-policy");

static FIXED_HEADERS: [(HeaderName, HeaderValue); 5] = [
    (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
    (
        CROSS_ORIGIN_RESOURCE_POLICY,
        HeaderValue::from_static("cross-origin"),
    ),
    (
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    ),
    (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
    (
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; sandbox"),
    ),
];

pub fn on_request<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let service = context
        .app_handle()
        .try_state::<AppState>()
        .and_then(|state| state.file_service().ok());
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(handle(service.as_ref(), &request));
    });
}

pub fn handle(service: Option<&FileService>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut response = route(service, request);
    let headers = response.headers_mut();
    for (name, value) in &FIXED_HEADERS {
        headers.insert(name.clone(), value.clone());
    }
    headers.append(header::VARY, HeaderValue::from_static("Origin"));
    add_cors(headers, request.headers());
    response
}

fn route(service: Option<&FileService>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    match *request.method() {
        Method::OPTIONS => preflight(),
        Method::GET => serve(service, request),
        Method::HEAD => without_body(serve(service, request)),
        _ => method_not_allowed(),
    }
}

fn preflight() -> Response<Vec<u8>> {
    let mut response = status_only(StatusCode::NO_CONTENT);
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(ALLOWED_METHODS),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(ALLOWED_REQUEST_HEADERS),
    );
    response
}

fn method_not_allowed() -> Response<Vec<u8>> {
    let mut response = status_only(StatusCode::METHOD_NOT_ALLOWED);
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static(ALLOWED_METHODS));
    response
}

pub(super) fn without_body(mut response: Response<Vec<u8>>) -> Response<Vec<u8>> {
    response.body_mut().clear();
    response
}

fn add_cors(headers: &mut HeaderMap, request_headers: &HeaderMap) {
    let Some(origin) = request_headers
        .get(header::ORIGIN)
        .filter(|origin| is_allowed_origin(origin))
    else {
        return;
    };
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static(EXPOSED_HEADERS),
    );
}

fn is_allowed_origin(origin: &HeaderValue) -> bool {
    origin
        .to_str()
        .is_ok_and(|text| text == APP_ORIGIN || (cfg!(debug_assertions) && text == DEV_ORIGIN))
}

fn serve(service: Option<&FileService>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(service) = service else {
        return status_only(StatusCode::NOT_FOUND);
    };
    match open(service, request) {
        Ok(served) => served_response(served),
        Err(status) => status_only(status),
    }
}

fn open(service: &FileService, request: &Request<Vec<u8>>) -> Result<Served, StatusCode> {
    let range = requested_range(request.headers())?;
    let file = locate(service, request.uri().path())?;
    service
        .open_for_serve(&file, range)
        .map_err(|error| status_of(&error))
}

pub(super) fn requested_range(headers: &HeaderMap) -> Result<Option<Range>, StatusCode> {
    let Some(value) = headers.get(header::RANGE) else {
        return Ok(None);
    };
    let text = value.to_str().map_err(|_| StatusCode::BAD_REQUEST)?;
    match range::parse(text) {
        Ok(parsed) => Ok(Some(parsed)),
        Err(RangeError::Invalid) => Err(StatusCode::BAD_REQUEST),
        Err(RangeError::Unsupported) => Err(StatusCode::RANGE_NOT_SATISFIABLE),
    }
}

fn locate(service: &FileService, uri_path: &str) -> Result<ScopedPath, StatusCode> {
    let relative = decode_relative(uri_path)?;
    service.scope(&relative).map_err(|error| status_of(&error))
}

fn decode_relative(uri_path: &str) -> Result<PathBuf, StatusCode> {
    let decoded = percent_decode_str(uri_path.trim_start_matches('/'))
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let path = PathBuf::from(decoded.as_ref());
    if !is_plain_relative(&path) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(path)
}

fn is_plain_relative(path: &Path) -> bool {
    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn status_of(error: &FileError) -> StatusCode {
    match error {
        FileError::Workspace(WorkspaceError::Io(cause)) | FileError::Io(cause) => io_status(cause),
        FileError::Workspace(WorkspaceError::RootInvalid | WorkspaceError::DestinationExists) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        FileError::Workspace(_) | FileError::ForbiddenPath | FileError::CloudOnly => {
            StatusCode::FORBIDDEN
        }
        FileError::NotAFile | FileError::NotADirectory => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn io_status(error: &io::Error) -> StatusCode {
    match error.kind() {
        io::ErrorKind::NotFound
        | io::ErrorKind::NotADirectory
        | io::ErrorKind::InvalidFilename
        | io::ErrorKind::InvalidInput => StatusCode::NOT_FOUND,
        io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub(super) fn served_response(served: Served) -> Response<Vec<u8>> {
    match served.outcome {
        Outcome::Full(_) => with_body(StatusCode::OK, served),
        Outcome::Partial(slice) => {
            let mut response = with_body(StatusCode::PARTIAL_CONTENT, served);
            response
                .headers_mut()
                .insert(header::CONTENT_RANGE, text_header(&slice.content_range()));
            response
        }
        Outcome::TooLarge => status_only(StatusCode::PAYLOAD_TOO_LARGE),
        Outcome::Unsatisfiable => {
            let mut response = status_only(StatusCode::RANGE_NOT_SATISFIABLE);
            let content_range = format!("{UNSATISFIED_RANGE}{}", served.total);
            response
                .headers_mut()
                .insert(header::CONTENT_RANGE, text_header(&content_range));
            response
        }
    }
}

fn with_body(status: StatusCode, served: Served) -> Response<Vec<u8>> {
    let length = HeaderValue::from(served.body.len());
    let mut response = Response::new(served.body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(served.mime));
    headers.insert(header::CONTENT_LENGTH, length);
    response
}

pub(super) fn status_only(status: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
    response
}

fn text_header(text: &str) -> HeaderValue {
    HeaderValue::from_str(text).unwrap_or_else(|_| HeaderValue::from_static(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_workspace_failures_and_unlisted_file_errors_are_a_500() {
        let internal = [
            FileError::Workspace(WorkspaceError::RootInvalid),
            FileError::Workspace(WorkspaceError::DestinationExists),
            FileError::FileChanged,
            FileError::TooLarge,
            FileError::NotText,
            FileError::ReadOnly,
            FileError::FileLocked,
            FileError::NotAllowed,
        ];
        for error in &internal {
            assert_eq!(status_of(error), StatusCode::INTERNAL_SERVER_ERROR);
        }
        let outside = FileError::Workspace(WorkspaceError::OutsideWorkspace);
        assert_eq!(status_of(&outside), StatusCode::FORBIDDEN);
    }

    #[test]
    fn io_failures_map_to_403_for_permissions_and_500_for_the_rest() {
        let denied = || io::Error::from(io::ErrorKind::PermissionDenied);
        let other = || io::Error::from(io::ErrorKind::Other);
        assert_eq!(status_of(&FileError::Io(denied())), StatusCode::FORBIDDEN);
        assert_eq!(
            status_of(&FileError::Io(other())),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            status_of(&FileError::Workspace(WorkspaceError::Io(other()))),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            status_of(&FileError::Workspace(WorkspaceError::Io(denied()))),
            StatusCode::FORBIDDEN
        );
    }
}

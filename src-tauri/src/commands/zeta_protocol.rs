use tauri::http::header::{self, HeaderName, HeaderValue};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use super::protocol::{
    add_cors, preflight, requested_range, served_response, status_only, without_body,
};
use crate::app::zeta_assets::{AssetError, ZetaAssets};

pub const SCHEME: &str = "zeta-assets";

const RESOURCE_FOLDER: &str = "zetaoffice";
const ALLOWED_METHODS: &str = "GET, HEAD, OPTIONS";
const DOCUMENT_POLICY: &str = "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'";

const CROSS_ORIGIN_RESOURCE_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-resource-policy");
const CROSS_ORIGIN_EMBEDDER_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-embedder-policy");

static FIXED_HEADERS: [(HeaderName, HeaderValue); 6] = [
    (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
    (
        CROSS_ORIGIN_RESOURCE_POLICY,
        HeaderValue::from_static("cross-origin"),
    ),
    (
        CROSS_ORIGIN_EMBEDDER_POLICY,
        HeaderValue::from_static("require-corp"),
    ),
    (
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    ),
    (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
    (
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(DOCUMENT_POLICY),
    ),
];

pub fn on_request<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let directory = context
        .app_handle()
        .path()
        .resource_dir()
        .map(|root| root.join(RESOURCE_FOLDER))
        .ok();
    tauri::async_runtime::spawn_blocking(move || {
        let assets = directory.map(ZetaAssets::new);
        responder.respond(handle(assets.as_ref(), &request));
    });
}

pub fn handle(assets: Option<&ZetaAssets>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut response = route(assets, request);
    let headers = response.headers_mut();
    for (name, value) in &FIXED_HEADERS {
        headers.insert(name.clone(), value.clone());
    }
    headers.append(header::VARY, HeaderValue::from_static("Origin"));
    add_cors(headers, request.headers());
    response
}

fn route(assets: Option<&ZetaAssets>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    match *request.method() {
        Method::OPTIONS => preflight(),
        Method::GET => serve(assets, request),
        Method::HEAD => without_body(serve(assets, request)),
        _ => not_allowed(),
    }
}

fn not_allowed() -> Response<Vec<u8>> {
    let mut response = status_only(StatusCode::METHOD_NOT_ALLOWED);
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static(ALLOWED_METHODS));
    response
}

fn serve(assets: Option<&ZetaAssets>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(assets) = assets else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let range = match requested_range(request.headers()) {
        Ok(range) => range,
        Err(status) => return status_only(status),
    };
    let name = request.uri().path().trim_start_matches('/');
    match assets.serve(name, range) {
        Ok(served) => served_response(served),
        Err(error) => status_only(status_of(&error)),
    }
}

fn status_of(error: &AssetError) -> StatusCode {
    match error {
        AssetError::NotListed | AssetError::Missing => StatusCode::NOT_FOUND,
        AssetError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

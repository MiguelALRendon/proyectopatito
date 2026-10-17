use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State, Window, WindowEvent};

use crate::app::closing::{CLOSE_TIMEOUT, CloseDecision, Closing};

const CLOSE_REQUESTED_EVENT: &str = "app://close-requested";
const MAIN_WINDOW_LABEL: &str = "main";

pub type ClosingState = Mutex<Closing>;

fn lock(state: &ClosingState) -> MutexGuard<'_, Closing> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

fn close_if_expired(window: &Window) -> Option<Duration> {
    let state = window.state::<ClosingState>();
    let left = lock(&state).remaining(Instant::now())?;
    if !left.is_zero() {
        return Some(left);
    }
    if lock(&state).expire(Instant::now()) {
        window.destroy().ok();
    }
    None
}

fn watch_deadline(window: Window) {
    std::thread::spawn(move || {
        while let Some(left) = close_if_expired(&window) {
            std::thread::sleep(left.min(CLOSE_TIMEOUT));
        }
    });
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    let decision = lock(&window.state::<ClosingState>()).request_close(Instant::now());
    if decision == CloseDecision::CloseNow {
        return;
    }
    api.prevent_close();
    if decision == CloseDecision::AskFrontend {
        window.emit(CLOSE_REQUESTED_EVENT, ()).ok();
        watch_deadline(window.clone());
    }
}

#[tauri::command]
pub fn app_frontend_ready(state: State<'_, ClosingState>) {
    lock(&state).mark_frontend_ready();
}

#[tauri::command]
pub fn app_hold_close(state: State<'_, ClosingState>) {
    lock(&state).hold(Instant::now());
}

#[tauri::command]
pub fn app_cancel_close(state: State<'_, ClosingState>) {
    lock(&state).cancel();
}

#[tauri::command]
pub fn app_confirm_close(app: AppHandle, state: State<'_, ClosingState>) {
    let may_close = lock(&state).confirm();
    if !may_close {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.destroy().ok();
    }
}

use tauri::State;

use crate::app::error::CommandError;
use crate::app::state::AppState;
use crate::app::ui_state::UiStateView;
use crate::config::UiState;

#[tauri::command]
pub async fn ui_state_get(state: State<'_, AppState>) -> Result<UiStateView, CommandError> {
    state.ui_state_get().await
}

#[tauri::command]
pub async fn ui_state_set(
    req: UiState,
    state: State<'_, AppState>,
) -> Result<UiStateView, CommandError> {
    state.ui_state_set(req).await
}

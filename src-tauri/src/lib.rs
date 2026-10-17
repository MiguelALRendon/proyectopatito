pub mod app;
pub mod commands;
pub mod config;
pub mod svn;

use tauri::Manager;

use crate::app::state::AppState;
use crate::commands::protocol;
use crate::config::{
    CONFIG_DIR_ENV, CONFIG_FILE_NAME, ConfigStore, IS_CONFIG_DIR_OVERRIDE_ALLOWED,
    resolve_config_dir,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, protocol::on_request)
        .manage(commands::ClosingState::default())
        .on_window_event(commands::on_window_event)
        .setup(|app| {
            let config_dir = resolve_config_dir(
                std::env::var_os(CONFIG_DIR_ENV),
                app.path().app_config_dir()?,
                IS_CONFIG_DIR_OVERRIDE_ALLOWED,
            );
            let path = config_dir.join(CONFIG_FILE_NAME);
            app.manage(AppState::new(ConfigStore { path }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace_get,
            commands::workspace_set,
            commands::svn_detect,
            commands::svn_set_path,
            commands::wc_info,
            commands::wc_status,
            commands::wc_status_map,
            commands::svn_checkout,
            commands::wc_update,
            commands::wc_commit,
            commands::wc_cleanup,
            commands::op_cancel,
            commands::wc_needs_cleanup,
            commands::fs_list,
            commands::fs_probe,
            commands::fs_read_text,
            commands::fs_write_text,
            commands::fs_read_chunk,
            commands::fs_can_open_external,
            commands::fs_open_external,
            commands::ui_state_get,
            commands::ui_state_set,
            commands::app_frontend_ready,
            commands::app_hold_close,
            commands::app_confirm_close,
            commands::app_cancel_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

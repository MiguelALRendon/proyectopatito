pub mod app;
pub mod commands;
pub mod config;
pub mod svn;

use tauri::Manager;

use crate::app::state::AppState;
use crate::config::{CONFIG_FILE_NAME, ConfigStore};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app.path().app_config_dir()?.join(CONFIG_FILE_NAME);
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
            commands::svn_checkout,
            commands::wc_update,
            commands::wc_commit,
            commands::wc_cleanup,
            commands::op_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

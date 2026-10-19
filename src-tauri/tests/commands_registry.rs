use dakedaduck_svn_lib::commands;
use tauri::ipc::Invoke;

fn registered_commands_handler<R: tauri::Runtime>()
-> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::app_about,
        commands::archive_list,
        commands::archive_cancel,
        commands::fs_list,
        commands::fs_probe,
        commands::fs_read_text,
        commands::fs_write_text,
        commands::fs_write_bytes,
        commands::fs_read_chunk,
        commands::fs_can_open_external,
        commands::fs_open_external,
        commands::wc_status_map,
        commands::ui_state_get,
        commands::ui_state_set,
        commands::app_frontend_ready,
        commands::app_hold_close,
        commands::app_cancel_close
    ]
}

#[test]
fn the_file_and_ui_state_commands_register_through_the_reexports_of_the_commands_module() {
    let _ = registered_commands_handler::<tauri::Wry>;
}

fn commands_defined_in(dir: &std::path::Path) -> std::collections::BTreeSet<String> {
    let mut names = std::collections::BTreeSet::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let source = std::fs::read_to_string(entry.unwrap().path()).unwrap();
        let mut lines = source.lines();
        while let Some(line) = lines.next() {
            if !line.trim().starts_with("#[tauri::command") {
                continue;
            }
            let signature = lines.by_ref().find(|next| next.contains("fn ")).unwrap();
            let after_fn = signature.split("fn ").nth(1).unwrap();
            names.insert(after_fn.split('(').next().unwrap().to_string());
        }
    }
    names
}

fn commands_registered_in(lib_source: &str) -> std::collections::BTreeSet<String> {
    let handler = lib_source.split("generate_handler![").nth(1).unwrap();
    let list = handler.split(']').next().unwrap();
    list.split(',')
        .filter_map(|item| item.trim().strip_prefix("commands::"))
        .map(str::to_string)
        .collect()
}

#[test]
fn every_tauri_command_defined_in_the_commands_module_is_registered_in_run() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let lib_source = std::fs::read_to_string(root.join("lib.rs")).unwrap();

    let defined = commands_defined_in(&root.join("commands"));
    let registered = commands_registered_in(&lib_source);

    assert!(defined.len() >= 25, "{defined:?}");
    assert_eq!(defined, registered);
}

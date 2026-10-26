mod library;

use library::{Group, SearchHit, SheetInfo};
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, State};

struct Library {
    root: PathBuf,
}

#[tauri::command]
fn library_root(lib: State<Library>) -> String {
    lib.root.to_string_lossy().into_owned()
}

#[tauri::command]
fn list_tree(lib: State<Library>) -> Group {
    library::tree(&lib.root)
}

#[tauri::command]
fn list_sheets(lib: State<Library>, group: String, recursive: bool) -> Result<Vec<SheetInfo>, String> {
    library::sheets(&lib.root, &group, recursive)
}

#[tauri::command]
fn read_sheet(lib: State<Library>, path: String) -> Result<String, String> {
    library::read_sheet(&lib.root, &path)
}

#[tauri::command]
fn write_sheet(lib: State<Library>, path: String, content: String) -> Result<String, String> {
    library::write_sheet(&lib.root, &path, &content)
}

#[tauri::command]
fn create_sheet(lib: State<Library>, group: String) -> Result<String, String> {
    library::create_sheet(&lib.root, &group)
}

#[tauri::command]
fn create_group(lib: State<Library>, parent: String, name: String) -> Result<String, String> {
    library::create_group(&lib.root, &parent, &name)
}

#[tauri::command]
fn rename_item(lib: State<Library>, path: String, new_name: String) -> Result<String, String> {
    library::rename_item(&lib.root, &path, &new_name)
}

#[tauri::command]
fn delete_item(lib: State<Library>, path: String) -> Result<(), String> {
    library::delete_item(&lib.root, &path)
}

#[tauri::command]
fn move_item(lib: State<Library>, path: String, dest_group: String) -> Result<String, String> {
    library::move_item(&lib.root, &path, &dest_group)
}

#[tauri::command]
fn search(lib: State<Library>, query: String) -> Vec<SearchHit> {
    library::search(&lib.root, &query)
}

#[tauri::command]
async fn export_sheet(lib: State<'_, Library>, path: String, dest: String) -> Result<(), String> {
    library::export(&lib.root, &path, &dest)
}

#[tauri::command]
async fn export_text(content: String, dest: String) -> Result<(), String> {
    library::export_text(&content, &dest)
}

#[tauri::command]
fn read_meta(lib: State<Library>) -> String {
    library::read_meta(&lib.root)
}

#[tauri::command]
fn write_meta(lib: State<Library>, json: String) -> Result<(), String> {
    library::write_meta(&lib.root, &json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Override the location with SCRIPTORIUM_LIBRARY if you want it somewhere else.
            let root = match std::env::var("SCRIPTORIUM_LIBRARY") {
                Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
                _ => app.path().document_dir().map_err(|e| e.to_string())?.join("Scriptorium"),
            };
            fs::create_dir_all(&root)?;
            library::seed(&root);
            app.manage(Library { root });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_root,
            list_tree,
            list_sheets,
            read_sheet,
            write_sheet,
            create_sheet,
            create_group,
            rename_item,
            delete_item,
            move_item,
            search,
            export_sheet,
            export_text,
            read_meta,
            write_meta
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scriptorium");
}

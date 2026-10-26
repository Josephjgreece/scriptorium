mod library;

use library::{Group, SearchHit, SheetInfo, TrashItem};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

/// The folder everything lives in. It can be switched while the app runs ("Choose library
/// folder"), so it sits behind a mutex; the choice is remembered in `config_file`.
struct Library {
    root: Mutex<PathBuf>,
    config_file: PathBuf,
    /// SCRIPTORIUM_LIBRARY is set, so the folder can't be changed from inside the app
    locked: bool,
}

impl Library {
    fn root(&self) -> PathBuf {
        self.root.lock().map(|r| r.clone()).unwrap_or_default()
    }
}

#[tauri::command]
fn library_root(lib: State<Library>) -> String {
    lib.root().to_string_lossy().into_owned()
}

#[tauri::command]
fn library_locked(lib: State<Library>) -> bool {
    lib.locked
}

/// Switch to another folder (created if needed) and remember it for next time.
#[tauri::command]
fn set_library(lib: State<Library>, path: String) -> Result<String, String> {
    if lib.locked {
        return Err("The library folder is set by the SCRIPTORIUM_LIBRARY environment variable".into());
    }
    let root = PathBuf::from(path.trim());
    if root.as_os_str().is_empty() {
        return Err("Choose a folder".into());
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if let Some(dir) = lib.config_file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&lib.config_file, root.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    library::seed(&root);
    *lib.root.lock().map_err(|e| e.to_string())? = root.clone();
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
fn library_stamp(lib: State<Library>) -> String {
    library::stamp(&lib.root())
}

#[tauri::command]
fn resolve_conflict(lib: State<Library>, path: String, keep_copy: bool) -> Result<String, String> {
    library::resolve_conflict(&lib.root(), &path, keep_copy)
}

#[tauri::command]
fn save_conflict_copy(lib: State<Library>, path: String, content: String) -> Result<String, String> {
    library::save_conflict_copy(&lib.root(), &path, &content)
}

#[tauri::command]
fn list_tree(lib: State<Library>) -> Group {
    library::tree(&lib.root())
}

#[tauri::command]
fn list_sheets(lib: State<Library>, group: String, recursive: bool) -> Result<Vec<SheetInfo>, String> {
    library::sheets(&lib.root(), &group, recursive)
}

#[tauri::command]
fn read_sheet(lib: State<Library>, path: String) -> Result<String, String> {
    library::read_sheet(&lib.root(), &path)
}

#[tauri::command]
fn write_sheet(lib: State<Library>, path: String, content: String) -> Result<String, String> {
    library::write_sheet(&lib.root(), &path, &content)
}

#[tauri::command]
fn create_sheet(lib: State<Library>, group: String) -> Result<String, String> {
    library::create_sheet(&lib.root(), &group)
}

#[tauri::command]
fn create_group(lib: State<Library>, parent: String, name: String) -> Result<String, String> {
    library::create_group(&lib.root(), &parent, &name)
}

#[tauri::command]
fn rename_item(lib: State<Library>, path: String, new_name: String) -> Result<String, String> {
    library::rename_item(&lib.root(), &path, &new_name)
}

#[tauri::command]
fn delete_item(lib: State<Library>, path: String) -> Result<(), String> {
    library::delete_item(&lib.root(), &path)
}

#[tauri::command]
fn move_item(lib: State<Library>, path: String, dest_group: String) -> Result<String, String> {
    library::move_item(&lib.root(), &path, &dest_group)
}

#[tauri::command]
fn list_trash(lib: State<Library>) -> Vec<TrashItem> {
    library::list_trash(&lib.root())
}

#[tauri::command]
fn read_trash_sheet(lib: State<Library>, id: String) -> Result<String, String> {
    library::read_trash_sheet(&lib.root(), &id)
}

#[tauri::command]
fn restore_trash(lib: State<Library>, id: String) -> Result<String, String> {
    library::restore_trash(&lib.root(), &id)
}

#[tauri::command]
fn purge_trash(lib: State<Library>, id: String) -> Result<(), String> {
    library::purge_trash(&lib.root(), &id)
}

#[tauri::command]
fn empty_trash(lib: State<Library>) -> Result<usize, String> {
    library::empty_trash(&lib.root())
}

#[tauri::command]
fn search(lib: State<Library>, query: String) -> Vec<SearchHit> {
    library::search(&lib.root(), &query)
}

#[tauri::command]
async fn export_sheet(lib: State<'_, Library>, path: String, dest: String) -> Result<(), String> {
    library::export(&lib.root(), &path, &dest)
}

#[tauri::command]
async fn export_text(content: String, dest: String) -> Result<(), String> {
    library::export_text(&content, &dest)
}

#[tauri::command]
fn read_meta(lib: State<Library>) -> String {
    library::read_meta(&lib.root())
}

#[tauri::command]
fn write_meta(lib: State<Library>, json: String) -> Result<(), String> {
    library::write_meta(&lib.root(), &json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Location: SCRIPTORIUM_LIBRARY if set, else the folder chosen in the app, else
            // Documents/Scriptorium.
            let config_file = app.path().app_config_dir().map_err(|e| e.to_string())?.join("library-path.txt");
            let env = std::env::var("SCRIPTORIUM_LIBRARY").ok().filter(|v| !v.trim().is_empty());
            let chosen = fs::read_to_string(&config_file).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
            let locked = env.is_some();
            let mut root = match (env, chosen) {
                (Some(v), _) | (None, Some(v)) => PathBuf::from(v),
                _ => app.path().document_dir().map_err(|e| e.to_string())?.join("Scriptorium"),
            };
            // a remembered folder that has vanished (unplugged drive) must not strand the app
            if fs::create_dir_all(&root).is_err() {
                root = app.path().document_dir().map_err(|e| e.to_string())?.join("Scriptorium");
                fs::create_dir_all(&root)?;
            }
            library::seed(&root);
            app.manage(Library { root: Mutex::new(root), config_file, locked });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_root,
            library_locked,
            set_library,
            library_stamp,
            resolve_conflict,
            save_conflict_copy,
            list_tree,
            list_sheets,
            read_sheet,
            write_sheet,
            create_sheet,
            create_group,
            rename_item,
            delete_item,
            move_item,
            list_trash,
            read_trash_sheet,
            restore_trash,
            purge_trash,
            empty_trash,
            search,
            export_sheet,
            export_text,
            read_meta,
            write_meta
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scriptorium");
}

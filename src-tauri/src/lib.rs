//! UML Studio desktop shell.
//!
//! Security model (spec §17): the webview gets no general filesystem API. Native Open/Save dialogs run
//! here, every path the user picks is recorded in an in-memory allow-list (plus previously picked
//! "recent" paths), and the file commands refuse any other path. Writes are atomic: data goes to a
//! temporary sibling file that is fsync'ed and then renamed over the target.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_PROJECT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 200 * 1024 * 1024;
const MAX_RECENTS: usize = 12;

#[derive(Default)]
struct PathScope {
    allowed: Mutex<HashSet<PathBuf>>,
}

impl PathScope {
    fn allow(&self, path: &Path) {
        if let Ok(mut set) = self.allowed.lock() {
            set.insert(normalize(path));
        }
    }

    fn check(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize(path);
        let allowed = self.allowed.lock().map_err(|_| "scope lock poisoned".to_string())?;
        if allowed.contains(&normalized) {
            Ok(normalized)
        } else {
            Err("Access denied: this file was not chosen through a UML Studio dialog.".to_string())
        }
    }
}

/// Canonical absolute path; for files that do not exist yet, the parent is canonicalized.
fn normalize(path: &Path) -> PathBuf {
    if let Ok(canonical) = fs::canonicalize(path) {
        return canonical;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => fs::canonicalize(parent).map(|p| p.join(name)).unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct RecentFile {
    path: String,
    name: String,
    project_name: String,
    last_opened_at: u64,
}

#[derive(Serialize)]
struct OpenedProject {
    path: String,
    name: String,
    contents: String,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn recents_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recent-projects.json"))
}

fn load_recents(app: &AppHandle) -> Vec<RecentFile> {
    recents_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<Vec<RecentFile>>(&text).ok())
        .unwrap_or_default()
}

fn store_recents(app: &AppHandle, list: &[RecentFile]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    atomic_write(&recents_path(app)?, text.as_bytes())
}

fn read_limited(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot read {}: {}", file_name(path), e))?;
    if meta.len() > MAX_PROJECT_BYTES {
        return Err(format!("{} is larger than the 25 MB project limit.", file_name(path)));
    }
    fs::read_to_string(path).map_err(|e| format!("Cannot read {}: {}", file_name(path), e))
}

/// Write via a temporary sibling + fsync + rename so a crash never leaves a truncated file.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Invalid destination".to_string())?;
    let tmp = parent.join(format!(".{}.tmp-{}", file_name(path), std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Cannot write {}: {}", file_name(path), error));
    }
    Ok(())
}

fn ensure_extension(mut path: PathBuf, extension: &str) -> PathBuf {
    let matches = path.extension().map(|e| e.eq_ignore_ascii_case(extension)).unwrap_or(false);
    if !matches {
        let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(format!(".{extension}"));
        path.set_file_name(name);
    }
    path
}

#[tauri::command]
async fn pick_open_project(app: AppHandle, scope: State<'_, PathScope>) -> Result<Option<OpenedProject>, String> {
    let picked = app.dialog().file().add_filter("UML Studio project", &["umls", "json"]).blocking_pick_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    scope.allow(&path);
    let contents = read_limited(&path)?;
    Ok(Some(OpenedProject { name: file_name(&path), path: path.to_string_lossy().into_owned(), contents }))
}

#[tauri::command]
async fn pick_save_path(app: AppHandle, scope: State<'_, PathScope>, suggested_name: String, kind: String) -> Result<Option<String>, String> {
    let (label, extension) = match kind.as_str() {
        "project" => ("UML Studio project", "umls"),
        "svg" => ("SVG image", "svg"),
        "png" => ("PNG image", "png"),
        "pdf" => ("PDF document", "pdf"),
        "json" => ("JSON snapshot", "json"),
        "zip" => ("ZIP archive", "zip"),
        "mmd" => ("Mermaid", "mmd"),
        "puml" => ("PlantUML", "puml"),
        _ => return Err(format!("Unsupported file kind: {kind}")),
    };
    let picked = app.dialog().file().set_file_name(&suggested_name).add_filter(label, &[extension]).blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = ensure_extension(picked.into_path().map_err(|e| e.to_string())?, extension);
    scope.allow(&path);
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn read_text_file(scope: State<'_, PathScope>, path: String) -> Result<String, String> {
    let path = scope.check(Path::new(&path))?;
    read_limited(&path)
}

#[tauri::command]
fn write_text_file(scope: State<'_, PathScope>, path: String, contents: String) -> Result<(), String> {
    let path = scope.check(Path::new(&path))?;
    atomic_write(&path, contents.as_bytes())
}

#[tauri::command]
fn write_binary_file(scope: State<'_, PathScope>, path: String, base64: String) -> Result<(), String> {
    let path = scope.check(Path::new(&path))?;
    if base64.len() > MAX_EXPORT_BYTES * 4 / 3 + 4 {
        return Err("Export is too large".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&path, &bytes)
}

#[tauri::command]
fn list_recent(app: AppHandle) -> Vec<RecentFile> {
    load_recents(&app)
}

#[tauri::command]
fn remember_recent(app: AppHandle, scope: State<'_, PathScope>, path: String, project_name: String) -> Result<(), String> {
    let normalized = scope.check(Path::new(&path))?;
    let path_string = normalized.to_string_lossy().into_owned();
    let mut list: Vec<RecentFile> = load_recents(&app).into_iter().filter(|r| r.path != path_string).collect();
    list.insert(0, RecentFile { name: file_name(&normalized), path: path_string, project_name, last_opened_at: now_ms() });
    list.truncate(MAX_RECENTS);
    store_recents(&app, &list)
}

#[tauri::command]
fn forget_recent(app: AppHandle, path: String) -> Result<(), String> {
    let list: Vec<RecentFile> = load_recents(&app).into_iter().filter(|r| r.path != path).collect();
    store_recents(&app, &list)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Paths the user chose in earlier sessions stay reachable from "Open Recent".
            let scope = PathScope::default();
            for recent in load_recents(app.handle()) {
                scope.allow(Path::new(&recent.path));
            }
            app.manage(scope);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_open_project,
            pick_save_path,
            read_text_file,
            write_text_file,
            write_binary_file,
            list_recent,
            remember_recent,
            forget_recent
        ])
        .run(tauri::generate_context!())
        .expect("error while running UML Studio");
}

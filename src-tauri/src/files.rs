use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    prelude::Accessor,
    probe::Probe,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::Manager;

#[derive(Default)]
pub struct Files {
    pub allowed: Mutex<HashSet<PathBuf>>,
    pub canceled: AtomicBool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub relative_path: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    track_number: u32,
    duration: f64,
    format: String,
    cover: Option<String>,
    cover_type: Option<String>,
}

fn audio(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "mp3" | "flac" | "m4a" | "aac" | "wav" | "ogg" | "opus" | "aif" | "aiff" | "wma"
    )
}
fn lrc(path: &Path) -> bool {
    path.extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("lrc"))
}

pub fn checked(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|_| "文件已移动或磁盘离线，请重新关联文件。")?;
    if !app
        .state::<Files>()
        .allowed
        .lock()
        .map_err(|_| "文件访问锁失效")?
        .contains(&path)
    {
        return Err("文件未授权，请重新选择文件或原目录。".into());
    }
    Ok(path)
}

pub fn restore(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let stored = app.path().app_data_dir()?.join("file-access.json");
    if let Ok(bytes) = fs::read(stored) {
        if let Ok(paths) = serde_json::from_slice::<HashSet<PathBuf>>(&bytes) {
            let state = app.state::<Files>();
            let mut allowed = state.allowed.lock().map_err(|_| "File access lock")?;
            for path in paths {
                // The private grant list is written only from a native picker/drop.
                if audio(&path) || lrc(&path) {
                    app.asset_protocol_scope().allow_file(&path)?;
                    allowed.insert(path);
                }
            }
        }
    }
    Ok(())
}

fn persist(app: &tauri::AppHandle) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(
        &*app
            .state::<Files>()
            .allowed
            .lock()
            .map_err(|_| "文件访问锁失效")?,
    )
    .map_err(|e| e.to_string())?;
    fs::write(directory.join("file-access.json"), bytes).map_err(|e| e.to_string())
}

pub fn scan(app: &tauri::AppHandle, paths: Vec<PathBuf>) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let state = app.state::<Files>();
    state.canceled.store(false, Ordering::Relaxed);
    for selected in paths {
        let prefix = if selected.is_dir() {
            selected.parent().unwrap_or(&selected).to_path_buf()
        } else {
            selected.parent().unwrap_or(Path::new("")).to_path_buf()
        };
        let mut pending = vec![selected];
        while let Some(path) = pending.pop() {
            if state.canceled.load(Ordering::Relaxed) {
                break;
            }
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            // Never recurse through junctions or symbolic links into another tree.
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    continue;
                }
            }
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if let Ok(children) = fs::read_dir(&path) {
                    pending.extend(children.filter_map(Result::ok).map(|e| e.path()));
                }
                continue;
            }
            if !audio(&path) && !lrc(&path) {
                continue;
            }
            let Ok(canonical) = fs::canonicalize(&path) else {
                continue;
            };
            if !seen.insert(canonical.clone()) {
                continue;
            }
            app.asset_protocol_scope()
                .allow_file(&canonical)
                .map_err(|e| e.to_string())?;
            state
                .allowed
                .lock()
                .map_err(|_| "文件访问锁失效")?
                .insert(canonical.clone());
            entries.push(Entry {
                path: canonical.to_string_lossy().into_owned(),
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                relative_path: path
                    .strip_prefix(&prefix)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
                size: meta.len(),
                modified: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|t| t.as_millis() as u64)
                    .unwrap_or(0),
            });
        }
    }
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    persist(app)?;
    Ok(entries)
}

#[tauri::command]
pub async fn choose_files(app: tauri::AppHandle, directory: bool) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new().set_title("Rhine Music · 选择音乐");
        let selected = if directory {
            dialog.pick_folder().map(|p| vec![p])
        } else {
            dialog
                .add_filter(
                    "音乐与歌词",
                    &[
                        "mp3", "flac", "m4a", "aac", "wav", "ogg", "opus", "aiff", "lrc",
                    ],
                )
                .pick_files()
        };
        scan(&app, selected.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_import(app: tauri::AppHandle) {
    app.state::<Files>().canceled.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub async fn file_available(app: tauri::AppHandle, paths: Vec<String>) -> Vec<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        paths.iter().map(|p| checked(&app, p).is_ok()).collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn parse_metadata(app: tauri::AppHandle, path: String) -> Result<Metadata, String> {
    let path = checked(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let tagged = Probe::open(&path)
            .map_err(|e| e.to_string())?
            .read()
            .map_err(|e| e.to_string())?;
        let mut metadata = Metadata {
            duration: tagged.properties().duration().as_secs_f64(),
            format: format!("{:?}", tagged.file_type()),
            ..Default::default()
        };
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            metadata.title = tag.title().map(|s| s.into_owned());
            metadata.artist = tag.artist().map(|s| s.into_owned());
            metadata.album = tag.album().map(|s| s.into_owned());
            metadata.album_artist = tag
                .get_string(lofty::tag::ItemKey::AlbumArtist)
                .map(str::to_owned);
            metadata.track_number = tag.track().unwrap_or(0);
            if let Some(picture) = tag
                .pictures()
                .first()
                .filter(|p| p.data().len() <= 10 * 1024 * 1024)
            {
                metadata.cover = Some(STANDARD.encode(picture.data()));
                metadata.cover_type = picture.mime_type().map(|m| m.as_str().to_string());
            }
        }
        Ok(metadata)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_lyrics(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = checked(&app, &path)?;
    if !lrc(&path) || fs::metadata(&path).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 {
        return Err("歌词文件过大或格式不受支持".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        fs::read_to_string(path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_backup(value: String, name: String) -> Result<(), String> {
    if value.len() > 200 * 1024 * 1024 {
        return Err("备份过大".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = rfd::FileDialog::new()
            .set_title("导出音乐资料")
            .set_file_name(&name)
            .add_filter("JSON 备份", &["json"])
            .save_file()
        {
            fs::write(path, value).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supported_extensions() {
        assert!(audio(Path::new("中文.FLAC")));
        assert!(lrc(Path::new("中文.LRC")));
        assert!(!audio(Path::new("secret.txt")));
        assert!(!lrc(Path::new("a.mp3")));
    }
}

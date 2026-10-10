use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use std::{
    fs,
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    title: String,
    artist: String,
    album: String,
    cover: Option<String>,
    duration: f64,
    position: f64,
    playing: bool,
}
#[derive(Default)]
pub struct SystemMedia(pub Mutex<Option<mpsc::Sender<MediaState>>>);

pub fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window missing")?;
    let hwnd = window.hwnd()?.0 as usize;
    let (sender, receiver) = mpsc::channel::<MediaState>();
    *app.state::<SystemMedia>()
        .0
        .lock()
        .map_err(|_| "Media lock")? = Some(sender);
    let app = app.clone();
    std::thread::spawn(move || {
        struct ComApartment;
        impl Drop for ComApartment {
            fn drop(&mut self) {
                unsafe {
                    windows_sys::Win32::System::Com::CoUninitialize();
                }
            }
        }
        let initialized = unsafe {
            windows_sys::Win32::System::Com::CoInitializeEx(
                std::ptr::null(),
                windows_sys::Win32::System::Com::COINIT_MULTITHREADED as u32,
            )
        };
        if initialized < 0 {
            let _ = app.emit("host-warning", "系统媒体控制初始化失败");
            return;
        }
        let _apartment = ComApartment;
        // Controls stay on their owning thread; only the message sender is shared.
        let Ok(mut controls) = MediaControls::new(PlatformConfig {
            dbus_name: "rhine-music",
            display_name: "Rhine Music",
            hwnd: Some(hwnd as *mut std::ffi::c_void),
        }) else {
            let _ = app.emit("host-warning", "系统媒体控制初始化失败");
            return;
        };
        let event_app = app.clone();
        if controls
            .attach(move |event| {
                let value = match event {
                    MediaControlEvent::Play => serde_json::json!({"action":"play"}),
                    MediaControlEvent::Pause => serde_json::json!({"action":"pause"}),
                    MediaControlEvent::Toggle => serde_json::json!({"action":"toggle"}),
                    MediaControlEvent::Next => serde_json::json!({"action":"next"}),
                    MediaControlEvent::Previous => serde_json::json!({"action":"previous"}),
                    MediaControlEvent::SetPosition(MediaPosition(position)) => {
                        serde_json::json!({"action":"seek","position":position.as_secs_f64()})
                    }
                    MediaControlEvent::Stop => serde_json::json!({"action":"pause"}),
                    MediaControlEvent::Seek(direction) => serde_json::json!({"action":"seek-by","offset":if direction == SeekDirection::Forward {10.0} else {-10.0}}),
                    MediaControlEvent::SeekBy(direction, amount) => serde_json::json!({"action":"seek-by","offset":amount.as_secs_f64() * if direction == SeekDirection::Forward {1.0} else {-1.0}}),
                    _ => return,
                };
                let _ = event_app.emit("host-media-action", value);
            })
            .is_err()
        {
            let _ = app.emit("host-warning", "系统媒体键注册失败");
            return;
        }
        let mut previous = (String::new(), String::new(), String::new(), None::<String>);
        while let Ok(state) = receiver.recv() {
            let key = (
                state.title.clone(),
                state.artist.clone(),
                state.album.clone(),
                state.cover.clone(),
            );
            if key != previous {
                let cover_url = state
                    .cover
                    .as_ref()
                    .and_then(|bytes| STANDARD.decode(bytes).ok())
                    .filter(|bytes| bytes.len() <= 5 * 1024 * 1024)
                    .and_then(|bytes| {
                        let directory = app.path().app_cache_dir().ok()?;
                        fs::create_dir_all(&directory).ok()?;
                        let path = directory.join("current-cover.png");
                        fs::write(&path, bytes).ok()?;
                        url::Url::from_file_path(path).ok().map(|u| u.to_string())
                    });
                let _ = controls.set_metadata(MediaMetadata {
                    title: Some(&state.title),
                    artist: Some(&state.artist),
                    album: Some(&state.album),
                    cover_url: cover_url.as_deref(),
                    duration: Some(Duration::from_secs_f64(state.duration.max(0.0))),
                });
                previous = key;
            }
            let progress = Some(MediaPosition(Duration::from_secs_f64(
                state.position.max(0.0),
            )));
            let _ = controls.set_playback(if state.playing {
                MediaPlayback::Playing { progress }
            } else {
                MediaPlayback::Paused { progress }
            });
        }
        let _ = controls.detach();
    });
    Ok(())
}
#[tauri::command]
pub fn update_media(app: tauri::AppHandle, state: MediaState) -> Result<(), String> {
    if !state.duration.is_finite() || !state.position.is_finite() {
        return Err("媒体进度无效".into());
    }
    if let Some(sender) = app
        .state::<SystemMedia>()
        .0
        .lock()
        .map_err(|_| "媒体锁失效")?
        .as_ref()
    {
        sender.send(state).map_err(|_| "系统媒体控制不可用")?;
    }
    Ok(())
}

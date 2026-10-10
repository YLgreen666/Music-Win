#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod credentials;
mod files;
mod media;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[derive(Default)]
struct Host {
    quit: AtomicBool,
    quit_revision: AtomicU64,
    close_to_tray: AtomicBool,
}

fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit(
            "host-hidden",
            app.get_webview_window("diagnostics").is_some(),
        );
    }
}
fn request_quit(app: &tauri::AppHandle) {
    if app.state::<Host>().quit.swap(true, Ordering::SeqCst) {
        return;
    }
    let revision = app
        .state::<Host>()
        .quit_revision
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let _ = app.save_window_state(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED);
    let _ = app.emit("host-quit", ());
    // The frontend acknowledges after flushing IndexedDB and releasing resources.
    // A hung WebView must not prevent explicit tray exit indefinitely.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let host = handle.state::<Host>();
        if host.quit.load(Ordering::SeqCst) && host.quit_revision.load(Ordering::SeqCst) == revision
        {
            handle.exit(0);
        }
    });
}
#[tauri::command]
fn finish_quit(app: tauri::AppHandle) {
    app.exit(0);
}
#[tauri::command]
fn cancel_quit(app: tauri::AppHandle) {
    let host = app.state::<Host>();
    host.quit.store(false, Ordering::SeqCst);
    host.quit_revision.fetch_add(1, Ordering::SeqCst);
}
#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) {
    app.state::<Host>()
        .close_to_tray
        .store(enabled, Ordering::Relaxed);
}
#[tauri::command]
fn show_diagnostics(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("diagnostics") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "diagnostics",
        tauri::WebviewUrl::App("verification/music-performance.html".into()),
    )
    .title("Rhine Music · 实机性能诊断")
    .inner_size(1280.0, 850.0)
    .use_https_scheme(true)
    .build()
    .map_err(|e| e.to_string())?;
    let _ = app.emit("host-hidden", true);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(Host {
            close_to_tray: AtomicBool::new(true),
            ..Default::default()
        })
        .manage(files::Files::default())
        .manage(media::SystemMedia::default())
        .setup(|app| {
            files::restore(app.handle())?;
            let window = app
                .get_webview_window("main")
                .ok_or("Main window missing")?;
            // Restore a visible location when a saved monitor was disconnected.
            if let (Ok(position), Ok(size), Ok(monitors)) = (
                window.outer_position(),
                window.outer_size(),
                window.available_monitors(),
            ) {
                let visible = monitors.iter().any(|m| {
                    let p = m.position();
                    let s = m.size();
                    position.x + size.width as i32 > p.x + 100
                        && position.x < p.x + s.width as i32 - 100
                        && position.y + size.height as i32 > p.y + 80
                        && position.y < p.y + s.height as i32 - 80
                });
                if !visible {
                    let _ = window.center();
                }
            }
            let items: Vec<_> = [
                ("show", "显示播放器"),
                ("toggle", "播放 / 暂停"),
                ("previous", "上一首"),
                ("next", "下一首"),
                ("quit", "退出"),
            ]
            .into_iter()
            .map(|(id, text)| MenuItem::with_id(app, id, text, true, None::<&str>))
            .collect::<Result<_, _>>()?;
            let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items
                .iter()
                .map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
                .collect();
            let menu = Menu::with_items(app, &refs)?;
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .ok_or("Window icon missing")?
                        .clone(),
                )
                .tooltip("Rhine Music")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show(app),
                    "quit" => request_quit(app),
                    action => {
                        let _ = app.emit("host-media-action", serde_json::json!({"action":action}));
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            media::start(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            if window.label() != "main" {
                if window.label() == "diagnostics" && matches!(event, tauri::WindowEvent::Destroyed)
                {
                    if let Some(main) = app.get_webview_window("main") {
                        let hidden = main.is_minimized().unwrap_or(false)
                            || !main.is_visible().unwrap_or(true);
                        let _ = app.emit("host-hidden", hidden);
                    }
                }
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if app.state::<Host>().close_to_tray.load(Ordering::Relaxed) {
                        let _ = app.save_window_state(
                            StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                        );
                        let _ = window.hide();
                        if let Some(diagnostics) = app.get_webview_window("diagnostics") {
                            let _ = diagnostics.close();
                        }
                        let _ = app.emit("host-hidden", true);
                    } else {
                        request_quit(app);
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    let hidden = window.is_minimized().unwrap_or(false)
                        || !window.is_visible().unwrap_or(true)
                        || app.get_webview_window("diagnostics").is_some();
                    let _ = app.emit("host-hidden", hidden);
                }
                tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                    let app = app.clone();
                    let paths = paths.clone();
                    tauri::async_runtime::spawn_blocking(move || match files::scan(&app, paths) {
                        Ok(entries) => {
                            let _ = app.emit("host-drop", entries);
                        }
                        Err(_) => {
                            let _ =
                                app.emit("host-warning", "拖入文件读取失败，请通过导入按钮重试");
                        }
                    });
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::choose_files,
            files::cancel_import,
            files::file_available,
            files::parse_metadata,
            files::read_lyrics,
            files::save_backup,
            credentials::load_login,
            credentials::save_login,
            media::update_media,
            set_close_to_tray,
            show_diagnostics,
            cancel_quit,
            finish_quit
        ])
        .run(tauri::generate_context!())
        .expect("Rhine Music could not start");
}

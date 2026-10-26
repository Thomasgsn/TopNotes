mod persistence;

use tauri::{
    menu::{Menu, MenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
};

const TRAY_ID: &str = "topnotes";
const MAIN_WINDOW: &str = "main";
const QUIT_REQUESTED_EVENT: &str = "topnotes://quit-requested";

struct TrayLabels {
    show: &'static str,
    new_note: &'static str,
    quit: &'static str,
}

fn tray_labels(locale: &str) -> TrayLabels {
    match locale {
        "fr" => TrayLabels {
            show: "Afficher TopNotes",
            new_note: "Nouvelle note",
            quit: "Quitter",
        },
        "it" => TrayLabels {
            show: "Mostra TopNotes",
            new_note: "Nuova nota",
            quit: "Esci",
        },
        "es" => TrayLabels {
            show: "Mostrar TopNotes",
            new_note: "Nueva nota",
            quit: "Salir",
        },
        "de" => TrayLabels {
            show: "TopNotes anzeigen",
            new_note: "Neue Notiz",
            quit: "Beenden",
        },
        _ => TrayLabels {
            show: "Show TopNotes",
            new_note: "New note",
            quit: "Quit",
        },
    }
}

fn build_tray_menu<R: Runtime>(app: &AppHandle<R>, locale: &str) -> tauri::Result<Menu<R>> {
    let labels = tray_labels(locale);

    MenuBuilder::new(app)
        .text("show", labels.show)
        .text("new_note", labels.new_note)
        .separator()
        .text("quit", labels.quit)
        .build()
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }

    Ok(())
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if window.is_visible()? && window.is_focused()? {
            window.hide()?;
        } else {
            show_main_window(app)?;
        }
    }

    Ok(())
}

#[tauri::command]
fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "TopNotes main window is not available".to_string())?;

    window
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())?;

    // macOS applies the window level asynchronously, so an immediate read can
    // return the previous state. Report the state accepted by the setter.
    Ok(enabled)
}

#[tauri::command]
fn set_tray_locale(app: AppHandle, locale: String) -> Result<(), String> {
    let menu = build_tray_menu(&app, &locale).map_err(|error| error.to_string())?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "TopNotes tray icon is not available".to_string())?;

    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first. Two processes would each keep their own copy of
        // the notes and overwrite each other's saves, so a second launch only
        // reveals the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            let persistence = persistence::Persistence::open(app.path().app_data_dir()?)?;
            app.manage(persistence);

            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;

            let menu = build_tray_menu(app.handle(), "en")?;
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray/44x44.png"))?;
            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon)
                .tooltip("TopNotes")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        let _ = show_main_window(app);
                    }
                    "new_note" => {
                        let _ = show_main_window(app);
                        let _ = app.emit("topnotes://new-note", ());
                    }
                    "quit" => {
                        let _ = app.emit(QUIT_REQUESTED_EVENT, ());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = toggle_main_window(tray.app_handle());
                    }
                });

            #[cfg(target_os = "macos")]
            {
                tray = tray.icon_as_template(true);
            }

            tray.build(app)?;

            for window in app.webview_windows().values() {
                window.set_always_on_top(true)?;
            }

            if std::env::args().any(|argument| argument == "--hidden") {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    window.hide()?;
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            persistence::load_app_data,
            persistence::save_notes,
            persistence::save_settings,
            quit_app,
            set_always_on_top,
            set_tray_locale
        ])
        .run(tauri::generate_context!())
        .expect("error while running TopNotes");
}

use serde::Deserialize;
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
pub(crate) struct ExportFile {
    name: String,
    content: String,
}

/// Writes exported files into a new folder in Downloads, reveals it in the
/// file manager and returns its path.
#[tauri::command]
pub(crate) async fn export_files(
    app: AppHandle,
    folder_name: String,
    files: Vec<ExportFile>,
) -> Result<String, String> {
    let paths = app.path();
    let base = paths
        .download_dir()
        .or_else(|_| paths.document_dir())
        .or_else(|_| paths.home_dir())
        .map_err(|error| error.to_string())?;
    let folder =
        tauri::async_runtime::spawn_blocking(move || write_export(&base, &folder_name, &files))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&folder);
    Ok(folder.display().to_string())
}

fn write_export(base: &Path, folder_name: &str, files: &[ExportFile]) -> io::Result<PathBuf> {
    let folder_name = safe_file_name(folder_name)?;
    let mut folder = base.join(folder_name);
    for index in 2.. {
        if !folder.exists() {
            break;
        }
        folder = base.join(format!("{folder_name} ({index})"));
    }
    fs::create_dir_all(&folder)?;
    for file in files {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(folder.join(safe_file_name(&file.name)?))?;
        output.write_all(file.content.as_bytes())?;
    }
    Ok(folder)
}

/// Accepts plain file names only, so an export can never write outside its folder.
fn safe_file_name(name: &str) -> io::Result<&str> {
    let valid =
        !name.trim().is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0']);
    if valid {
        Ok(name)
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid export file name {name:?}"),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_DIRECTORY: AtomicUsize = AtomicUsize::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "topnotes-export-test-{}-{}",
                std::process::id(),
                NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn file(name: &str, content: &str) -> ExportFile {
        ExportFile {
            name: name.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn exports_go_to_a_new_folder_each_time() {
        let base = TestDirectory::new();
        let files = [file("Réunion.md", "# Points"), file("Idées 😀.md", "Texte")];

        let first = write_export(&base.0, "TopNotes 2026-10-26", &files).unwrap();
        let second = write_export(&base.0, "TopNotes 2026-10-26", &files).unwrap();

        assert_eq!(first, base.0.join("TopNotes 2026-10-26"));
        assert_eq!(second, base.0.join("TopNotes 2026-10-26 (2)"));
        assert_eq!(
            fs::read_to_string(first.join("Réunion.md")).unwrap(),
            "# Points"
        );
        assert_eq!(
            fs::read_to_string(second.join("Idées 😀.md")).unwrap(),
            "Texte"
        );
    }

    #[test]
    fn file_names_cannot_leave_the_export_folder() {
        let base = TestDirectory::new();
        for name in ["../evil.md", "a/b.md", "..", "", "a\\b.md"] {
            assert!(
                write_export(&base.0, "Export", &[file(name, "x")]).is_err(),
                "{name}"
            );
        }
        assert!(write_export(&base.0, "../outside", &[]).is_err());
        assert!(!base.0.join("evil.md").exists());
        assert!(!base.0.parent().unwrap().join("outside").exists());
    }

    #[test]
    fn duplicate_names_never_overwrite_a_file() {
        let base = TestDirectory::new();
        let result = write_export(&base.0, "Export", &[file("a.md", "1"), file("a.md", "2")]);
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(base.0.join("Export").join("a.md")).unwrap(),
            "1"
        );
    }
}

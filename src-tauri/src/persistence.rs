use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const SCHEMA_VERSION: u32 = 1;
const DATA_FILE_NAME: &str = "topnotes.json";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppData {
    #[serde(default = "schema_version")]
    schema_version: u32,
    #[serde(default)]
    notes: Option<Vec<Note>>,
    #[serde(default)]
    tags: Option<Vec<NoteTag>>,
    #[serde(default)]
    settings: Option<Settings>,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            notes: None,
            tags: None,
            settings: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Note {
    id: String,
    title: String,
    body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body_format: Option<String>,
    tag: Option<String>,
    pinned: bool,
    archived: bool,
    trashed: bool,
    created_at: u64,
    updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteTag {
    id: String,
    name: String,
    color: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Settings {
    locale: AppLocale,
    always_on_top: bool,
    autostart_initialized: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AppLocale {
    Fr,
    En,
    It,
    Es,
    De,
}

#[derive(Clone)]
pub(crate) struct Persistence {
    inner: Arc<PersistenceInner>,
}

struct PersistenceInner {
    data_path: PathBuf,
    data: Mutex<AppData>,
}

impl Persistence {
    pub(crate) fn open(app_data_dir: PathBuf) -> io::Result<Self> {
        let data_path = app_data_dir.join(DATA_FILE_NAME);
        let data = load_or_recover(&data_path)?;
        Ok(Self {
            inner: Arc::new(PersistenceInner {
                data_path,
                data: Mutex::new(data),
            }),
        })
    }

    fn load(&self) -> io::Result<AppData> {
        Ok(self.lock_data()?.clone())
    }

    fn save_notes(&self, notes: Vec<Note>, tags: Option<Vec<NoteTag>>) -> io::Result<()> {
        self.update(|data| {
            data.notes = Some(notes);
            if let Some(tags) = tags {
                data.tags = Some(tags);
            }
        })
    }

    fn save_settings(&self, settings: Settings) -> io::Result<()> {
        self.update(|data| data.settings = Some(settings))
    }

    fn update(&self, update: impl FnOnce(&mut AppData)) -> io::Result<()> {
        let mut current = self.lock_data()?;
        let mut next = current.clone();
        update(&mut next);
        write_atomically(&self.inner.data_path, &next)?;
        *current = next;
        Ok(())
    }

    fn lock_data(&self) -> io::Result<MutexGuard<'_, AppData>> {
        self.inner
            .data
            .lock()
            .map_err(|_| io::Error::other("the persistence lock is poisoned"))
    }
}

#[tauri::command]
pub(crate) fn load_app_data(state: State<'_, Persistence>) -> Result<AppData, String> {
    state.load().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn save_notes(
    state: State<'_, Persistence>,
    notes: Vec<Note>,
    tags: Option<Vec<NoteTag>>,
) -> Result<(), String> {
    let persistence = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || persistence.save_notes(notes, tags))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn save_settings(
    state: State<'_, Persistence>,
    settings: Settings,
) -> Result<(), String> {
    let persistence = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || persistence.save_settings(settings))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn schema_version() -> u32 {
    SCHEMA_VERSION
}

fn load_or_recover(path: &Path) -> io::Result<AppData> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(AppData::default()),
        Err(error) => return Err(error),
    };

    match serde_json::from_str::<AppData>(&raw) {
        Ok(data) if data.schema_version == SCHEMA_VERSION => Ok(data),
        Ok(data) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "unsupported TopNotes data schema {}; expected {SCHEMA_VERSION}",
                data.schema_version
            ),
        )),
        Err(error) => {
            preserve_corrupt_file(path)?;
            eprintln!("TopNotes preserved an unreadable data file: {error}");
            Ok(AppData::default())
        }
    }
}

fn preserve_corrupt_file(path: &Path) -> io::Result<()> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let corrupt_path = path.with_file_name(format!("topnotes.corrupt-{timestamp}.json"));
    fs::rename(path, corrupt_path)
}

fn write_atomically(path: &Path, data: &AppData) -> io::Result<()> {
    let directory = path
        .parent()
        .ok_or_else(|| io::Error::other("the data path has no parent directory"))?;
    fs::create_dir_all(directory)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = path.with_file_name(format!(
        ".{DATA_FILE_NAME}.{}-{timestamp}.tmp",
        std::process::id()
    ));

    let result = (|| {
        let file = secure_temporary_file(&temporary_path)?;
        let mut writer = BufWriter::new(file);
        serde_json::to_writer(&mut writer, data).map_err(io::Error::other)?;
        writer.flush()?;
        let file = writer
            .into_inner()
            .map_err(|error| io::Error::other(error.to_string()))?;
        file.sync_all()?;
        fs::rename(&temporary_path, path)?;
        sync_directory(directory)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn secure_temporary_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    options.open(path)
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> io::Result<()> {
    File::open(directory)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "topnotes-persistence-test-{}-{timestamp}",
                std::process::id()
            ));
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn settings() -> Settings {
        Settings {
            locale: AppLocale::Fr,
            always_on_top: false,
            autostart_initialized: true,
        }
    }

    #[test]
    fn missing_storage_starts_empty() {
        let directory = TestDirectory::new();
        let persistence = Persistence::open(directory.0.clone()).unwrap();

        assert_eq!(persistence.load().unwrap(), AppData::default());
    }

    #[test]
    fn updates_are_durable_and_merged() {
        let directory = TestDirectory::new();
        let persistence = Persistence::open(directory.0.clone()).unwrap();
        persistence.save_notes(Vec::new(), None).unwrap();
        persistence.save_settings(settings()).unwrap();

        let reopened = Persistence::open(directory.0.clone()).unwrap();
        assert_eq!(
            reopened.load().unwrap(),
            AppData {
                schema_version: SCHEMA_VERSION,
                notes: Some(Vec::new()),
                tags: None,
                settings: Some(settings()),
            }
        );
    }

    #[test]
    fn malformed_storage_is_preserved_before_recovery() {
        let directory = TestDirectory::new();
        fs::create_dir_all(&directory.0).unwrap();
        fs::write(directory.0.join(DATA_FILE_NAME), "not json").unwrap();

        let persistence = Persistence::open(directory.0.clone()).unwrap();
        assert_eq!(persistence.load().unwrap(), AppData::default());

        let recovery_files = fs::read_dir(&directory.0)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
            .count();
        assert_eq!(recovery_files, 1);
    }

    #[test]
    fn custom_tags_and_markdown_survive_reopening() {
        let directory = TestDirectory::new();
        let persistence = Persistence::open(directory.0.clone()).unwrap();
        let notes = vec![Note {
            id: "note-1".to_string(),
            title: "Note".to_string(),
            body: "# Titre\n\n- [x] Terminé".to_string(),
            body_format: Some("markdown".to_string()),
            tag: Some("custom-clients".to_string()),
            pinned: false,
            archived: false,
            trashed: false,
            created_at: 1,
            updated_at: 2,
        }];
        let tags = vec![NoteTag {
            id: "custom-clients".to_string(),
            name: "Clients".to_string(),
            color: "#00aaff".to_string(),
        }];
        persistence
            .save_notes(notes.clone(), Some(tags.clone()))
            .unwrap();
        persistence.save_settings(settings()).unwrap();

        let reopened = Persistence::open(directory.0.clone())
            .unwrap()
            .load()
            .unwrap();
        assert_eq!(reopened.notes, Some(notes));
        assert_eq!(reopened.tags, Some(tags));
        assert_eq!(reopened.settings, Some(settings()));
    }

    #[test]
    fn legacy_notes_load_without_a_tag_catalog_or_body_format() {
        let data: AppData = serde_json::from_str(
            r#"{
          "schemaVersion": 1,
          "notes": [{"id":"old", "title":"Ancienne note", "body":"<h2>Titre</h2>",
            "tag":"work", "pinned":false, "archived":false, "trashed":false,
            "createdAt":1, "updatedAt":2}],
          "settings":null
        }"#,
        )
        .unwrap();
        assert!(data.tags.is_none());
        let note = &data.notes.unwrap()[0];
        assert!(note.body_format.is_none());
        assert_eq!(note.tag.as_deref(), Some("work"));
        assert_eq!(note.body, "<h2>Titre</h2>");
    }
}

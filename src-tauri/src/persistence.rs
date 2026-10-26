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
const BACKUP_DIRECTORY_NAME: &str = "backups";
const BACKUPS_TO_KEEP: usize = 7;

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
    // Added after the first release: older files load with the default.
    #[serde(default)]
    sort_order: SortOrder,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum SortOrder {
    #[default]
    Updated,
    Created,
    Title,
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
    last_backup_day: Mutex<String>,
    // Set when the data file exists but cannot be used (newer schema, read
    // error). Writes are then refused so the file is never overwritten.
    load_error: Option<String>,
}

impl Persistence {
    pub(crate) fn open(app_data_dir: PathBuf) -> io::Result<Self> {
        let data_path = app_data_dir.join(DATA_FILE_NAME);
        let (data, load_error) = match load_or_recover(&data_path) {
            Ok(data) => (data, None),
            Err(error) => (
                AppData::default(),
                Some(format!("{} ({})", error, data_path.display())),
            ),
        };
        Ok(Self {
            inner: Arc::new(PersistenceInner {
                data_path,
                data: Mutex::new(data),
                last_backup_day: Mutex::new(String::new()),
                load_error,
            }),
        })
    }

    fn load(&self) -> io::Result<AppData> {
        self.ensure_loaded()?;
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
        self.ensure_loaded()?;
        let mut current = self.lock_data()?;
        self.back_up_once_per_day();
        let mut next = current.clone();
        update(&mut next);
        write_atomically(&self.inner.data_path, &next)?;
        *current = next;
        Ok(())
    }

    fn ensure_loaded(&self) -> io::Result<()> {
        match &self.inner.load_error {
            Some(error) => Err(io::Error::other(error.clone())),
            None => Ok(()),
        }
    }

    // A failed backup must never prevent saving the user's notes.
    fn back_up_once_per_day(&self) {
        let today = today_utc();
        let Ok(mut last_backup_day) = self.inner.last_backup_day.lock() else {
            return;
        };
        if *last_backup_day == today {
            return;
        }
        match back_up_daily(&self.inner.data_path, &today) {
            Ok(()) => *last_backup_day = today,
            Err(error) => eprintln!("TopNotes could not back up its data: {error}"),
        }
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

/// Copies the data file as it was before today's first write into
/// `backups/topnotes-YYYY-MM-DD.json` and keeps the most recent backups only.
fn back_up_daily(data_path: &Path, today: &str) -> io::Result<()> {
    if !data_path.exists() {
        return Ok(());
    }
    let directory = data_path
        .parent()
        .ok_or_else(|| io::Error::other("the data path has no parent directory"))?
        .join(BACKUP_DIRECTORY_NAME);
    fs::create_dir_all(&directory)?;

    let backup_path = directory.join(format!("topnotes-{today}.json"));
    if !backup_path.exists() {
        let temporary_path = directory.join(format!(".topnotes-{today}.json.tmp"));
        fs::copy(data_path, &temporary_path)?;
        fs::rename(&temporary_path, &backup_path)?;
    }
    prune_backups(&directory)
}

fn prune_backups(directory: &Path) -> io::Result<()> {
    let mut backups: Vec<PathBuf> = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("topnotes-") && name.ends_with(".json"))
        })
        .collect();
    backups.sort();
    let excess = backups.len().saturating_sub(BACKUPS_TO_KEEP);
    for path in &backups[..excess] {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn today_utc() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    civil_date(seconds / 86_400)
}

/// Formats a number of days since 1970-01-01 as `YYYY-MM-DD` (Howard Hinnant's
/// days-to-civil algorithm), avoiding a date crate for a single file name.
fn civil_date(days_since_epoch: u64) -> String {
    let shifted = days_since_epoch as i64 + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
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

    // Tests run in parallel and macOS clocks are only microsecond precise, so a
    // timestamp alone can give two tests the same directory.
    static NEXT_DIRECTORY: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    impl TestDirectory {
        fn new() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let index = NEXT_DIRECTORY.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "topnotes-persistence-test-{}-{timestamp}-{index}",
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
            sort_order: SortOrder::Updated,
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

    fn backup_names(directory: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(directory.join(BACKUP_DIRECTORY_NAME))
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn first_write_of_the_day_backs_up_the_previous_data() {
        let directory = TestDirectory::new();
        let persistence = Persistence::open(directory.0.clone()).unwrap();
        persistence.save_settings(settings()).unwrap();
        let before = fs::read_to_string(directory.0.join(DATA_FILE_NAME)).unwrap();

        back_up_daily(&directory.0.join(DATA_FILE_NAME), "2026-10-26").unwrap();
        persistence.save_notes(Vec::new(), None).unwrap();
        back_up_daily(&directory.0.join(DATA_FILE_NAME), "2026-10-26").unwrap();

        assert_eq!(backup_names(&directory.0), vec!["topnotes-2026-10-26.json"]);
        let backup = directory
            .0
            .join(BACKUP_DIRECTORY_NAME)
            .join("topnotes-2026-10-26.json");
        assert_eq!(fs::read_to_string(backup).unwrap(), before);
    }

    #[test]
    fn nothing_is_backed_up_before_the_first_save() {
        let directory = TestDirectory::new();
        fs::create_dir_all(&directory.0).unwrap();
        back_up_daily(&directory.0.join(DATA_FILE_NAME), "2026-10-26").unwrap();
        assert!(backup_names(&directory.0).is_empty());
    }

    #[test]
    fn only_the_most_recent_backups_are_kept() {
        let directory = TestDirectory::new();
        let backups = directory.0.join(BACKUP_DIRECTORY_NAME);
        fs::create_dir_all(&backups).unwrap();
        for day in 1..=9 {
            fs::write(backups.join(format!("topnotes-2026-10-0{day}.json")), "{}").unwrap();
        }
        fs::write(backups.join("notes.txt"), "kept").unwrap();
        fs::write(directory.0.join(DATA_FILE_NAME), "{}").unwrap();

        back_up_daily(&directory.0.join(DATA_FILE_NAME), "2026-10-26").unwrap();

        let names = backup_names(&directory.0);
        assert_eq!(names.len(), BACKUPS_TO_KEEP + 1);
        assert_eq!(names.first().unwrap(), "notes.txt");
        assert_eq!(names[1], "topnotes-2026-10-04.json");
        assert_eq!(names.last().unwrap(), "topnotes-2026-10-26.json");
    }

    #[test]
    fn civil_dates_are_computed_from_unix_days() {
        assert_eq!(civil_date(0), "1970-01-01");
        assert_eq!(civil_date(20_752), "2026-10-26");
        assert_eq!(civil_date(11_016), "2000-02-29");
    }

    #[test]
    fn data_from_a_newer_version_is_reported_and_never_overwritten() {
        let directory = TestDirectory::new();
        fs::create_dir_all(&directory.0).unwrap();
        let newer = r#"{"schemaVersion":2,"notes":[],"futureField":true}"#;
        fs::write(directory.0.join(DATA_FILE_NAME), newer).unwrap();

        let persistence = Persistence::open(directory.0.clone()).unwrap();
        let error = persistence.load().unwrap_err().to_string();
        assert!(error.contains("schema 2"), "{error}");
        assert!(persistence.save_notes(Vec::new(), None).is_err());
        assert!(persistence.save_settings(settings()).is_err());
        assert_eq!(
            fs::read_to_string(directory.0.join(DATA_FILE_NAME)).unwrap(),
            newer
        );
    }

    #[test]
    fn settings_without_a_sort_order_use_the_default_and_keep_a_chosen_one() {
        let legacy: Settings = serde_json::from_str(
            r#"{"locale":"fr","alwaysOnTop":true,"autostartInitialized":true}"#,
        )
        .unwrap();
        assert_eq!(legacy.sort_order, SortOrder::Updated);

        let chosen: Settings = serde_json::from_str(
            r#"{"locale":"fr","alwaysOnTop":true,"autostartInitialized":true,"sortOrder":"title"}"#,
        )
        .unwrap();
        assert_eq!(chosen.sort_order, SortOrder::Title);
        assert!(serde_json::to_string(&chosen)
            .unwrap()
            .contains(r#""sortOrder":"title""#));
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

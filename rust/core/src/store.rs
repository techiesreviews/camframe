//! Where Preferences live on disk: `preferences.json`, written in one step, plus the last good copy.
//! Mirrors `src/preferences-store.js` of CamFrame 0.9.0.
//!
//! A save writes a temporary file, flushes it, then renames it over `preferences.json`, so a crash
//! leaves the old file or the new one, never a cut-off one. Before each save the current file, when
//! it is complete, becomes `preferences.last-good.json`; a broken `preferences.json` then loads that
//! copy instead of starting from defaults. A missing `preferences.json` still means "no saved
//! Preferences".
//!
//! The Rust app keeps its own folder ("CamFrame Rust"), so CamFrame 0.9.0 keeps working untouched
//! beside it. On its first start it copies 0.9.0's Preferences once (`adopt_from`).

use std::cell::Cell;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;

pub const APP_FOLDER: &str = "CamFrame Rust";
pub const ELECTRON_FOLDER: &str = "CamFrame";
pub const PREFERENCES_FILE: &str = "preferences.json";

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// The folder for app data on this system: `%APPDATA%` on Windows, Application Support on macOS,
/// `$XDG_CONFIG_HOME` (or `~/.config`) elsewhere. `env` reads an environment variable.
pub fn config_root(env: impl Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return env("APPDATA").map(PathBuf::from);
    }
    let home = env("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        return home.map(|home| home.join("Library").join("Application Support"));
    }
    env("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| home.map(|home| home.join(".config")))
}

fn is_document(text: &str) -> bool {
    matches!(serde_json::from_str::<Value>(text), Ok(Value::Object(_)))
}

/// Diagnostics only: no document text, paths or error messages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentStatus {
    Valid,
    Missing,
    Damaged,
    Unreadable(io::ErrorKind),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadSource {
    Primary,
    Backup,
    Defaults,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LoadOutcome {
    pub source: LoadSource,
    pub primary: DocumentStatus,
    /// None when the primary was valid or missing, so the backup was not tried.
    pub backup: Option<DocumentStatus>,
}

pub struct PreferencesStore {
    path: PathBuf,
    last_good: PathBuf,
    session_read_error: Cell<Option<io::ErrorKind>>,
    load_outcome: Cell<Option<LoadOutcome>>,
}

impl PreferencesStore {
    pub fn new(path: PathBuf) -> PreferencesStore {
        let last_good = path.with_file_name(PREFERENCES_FILE.replace(".json", ".last-good.json"));
        PreferencesStore { path, last_good, session_read_error: Cell::new(None), load_outcome: Cell::new(None) }
    }

    /// The store in the app's own folder under `root`.
    pub fn in_folder(root: &Path) -> PreferencesStore {
        PreferencesStore::new(root.join(APP_FOLDER).join(PREFERENCES_FILE))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The most recent read's outcome. Saves leave it intact, including startup migration.
    pub fn load_outcome(&self) -> Option<LoadOutcome> {
        self.load_outcome.get()
    }

    /// The text to load: `preferences.json` when it is complete, else the last good copy when that
    /// is, else whatever `preferences.json` held. None when there is no `preferences.json`.
    pub fn read(&self) -> Option<String> {
        let (current, primary) = match fs::read(&self.path) {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                let status = if is_document(&text) { DocumentStatus::Valid } else { DocumentStatus::Damaged };
                (text, status)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.load_outcome.set(Some(LoadOutcome {
                    source: LoadSource::Defaults,
                    primary: DocumentStatus::Missing,
                    backup: None,
                }));
                return None;
            }
            Err(error) => {
                // Fallback settings must not replace the original if access returns before quit.
                // Opening a new store on restart allows the original Scenes to load again.
                self.session_read_error.set(Some(error.kind()));
                (String::new(), DocumentStatus::Unreadable(error.kind()))
            }
        };
        if primary == DocumentStatus::Valid {
            self.load_outcome.set(Some(LoadOutcome { source: LoadSource::Primary, primary, backup: None }));
            return Some(current);
        }
        let backup = match fs::read_to_string(&self.last_good) {
            Ok(last_good) if is_document(&last_good) => {
                self.load_outcome.set(Some(LoadOutcome {
                    source: LoadSource::Backup,
                    primary,
                    backup: Some(DocumentStatus::Valid),
                }));
                return Some(last_good);
            }
            Ok(_) => DocumentStatus::Damaged,
            Err(error) if error.kind() == io::ErrorKind::NotFound => DocumentStatus::Missing,
            Err(error) => DocumentStatus::Unreadable(error.kind()),
        };
        self.load_outcome.set(Some(LoadOutcome { source: LoadSource::Defaults, primary, backup: Some(backup) }));
        Some(current)
    }

    pub fn write(&self, text: &str) -> io::Result<()> {
        if let Some(kind) = self.session_read_error.get() {
            return Err(io::Error::new(kind, "Preferences could not be read in this session; restart before saving"));
        }
        if let Some(folder) = self.path.parent() {
            fs::create_dir_all(folder)?;
        }
        let current = match fs::read(&self.path) {
            Ok(bytes) => String::from_utf8(bytes).ok(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            // A rename can succeed even when reading fails. Keep the original in place until a
            // later save can read it, including saves from the app's startup migration.
            Err(error) => return Err(error),
        };
        if let Some(current) = current
            && is_document(&current)
            && current != text
        {
            // The copy is a spare: failing to refresh it must not cost the save itself.
            let _ = replace(&self.last_good, &current, false);
        }
        replace(&self.path, text, true)
    }

    /// On the first start (no Preferences of its own yet), copy the Preferences of CamFrame 0.9.0
    /// from `electron_file`, so the Rust app opens with the same camera, look and Scenes. Returns
    /// whether a copy was made. 0.9.0's file is only read.
    pub fn adopt_from(&self, electron_file: &Path) -> io::Result<bool> {
        if self.path.exists() {
            return Ok(false);
        }
        let Ok(text) = fs::read_to_string(electron_file) else { return Ok(false) };
        if !is_document(&text) {
            return Ok(false);
        }
        self.write(&text)?;
        Ok(true)
    }
}

fn replace(file: &Path, text: &str, in_place_when_blocked: bool) -> io::Result<()> {
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    let mut name = file.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{}-{sequence}.tmp", std::process::id()));
    let temporary = file.with_file_name(name);
    let result = (|| {
        let mut handle = File::create(&temporary)?;
        handle.write_all(text.as_bytes())?;
        handle.sync_all()?;
        drop(handle);
        match fs::rename(&temporary, file) {
            Ok(()) => Ok(true),
            // Windows refuses the rename while another program (an antivirus or the indexer) holds
            // the file open: write in place rather than lose the save.
            Err(error)
                if in_place_when_blocked
                    && cfg!(target_os = "windows")
                    && error.kind() == io::ErrorKind::PermissionDenied =>
            {
                fs::write(file, text)?;
                Ok(false)
            }
            Err(error) => Err(error),
        }
    })();
    match result {
        Ok(true) => {
            flush_folder(file);
            Ok(())
        }
        Ok(false) => {
            let _ = fs::remove_file(&temporary);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

/// On Linux and macOS a rename reaches the disk only when its folder is flushed too. Best effort.
fn flush_folder(file: &Path) {
    #[cfg(unix)]
    if let Some(folder) = file.parent()
        && let Ok(handle) = File::open(folder)
    {
        let _ = handle.sync_all();
    }
    #[cfg(not(unix))]
    let _ = file;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("camframe-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn load_outcomes_keep_primary_and_backup_reasons_without_settings() {
        for primary in ["missing", "valid", "damaged", "unreadable"] {
            for backup in ["missing", "valid", "damaged", "unreadable"] {
                let root = folder(&format!("outcome-{primary}-{backup}"));
                let store = PreferencesStore::in_folder(&root);
                fs::create_dir_all(store.path().parent().unwrap()).unwrap();
                let original = if primary == "damaged" { "{private-primary" } else { r#"{"size":412}"# };
                let spare = if backup == "damaged" { "{private-backup" } else { r#"{"size":350}"# };
                for (state, path, text) in [(primary, &store.path, original), (backup, &store.last_good, spare)] {
                    match state {
                        "missing" => {}
                        // A directory gives a real read error on Windows, macOS and Linux.
                        "unreadable" => fs::create_dir(path).unwrap(),
                        _ => fs::write(path, text).unwrap(),
                    }
                }
                let classify = |state, path: &Path| match state {
                    "missing" => DocumentStatus::Missing,
                    "valid" => DocumentStatus::Valid,
                    "damaged" => DocumentStatus::Damaged,
                    _ => DocumentStatus::Unreadable(fs::read(path).unwrap_err().kind()),
                };
                let tried_backup = !matches!(primary, "missing" | "valid");
                let source = match (primary, tried_backup, backup) {
                    ("valid", _, _) => LoadSource::Primary,
                    (_, true, "valid") => LoadSource::Backup,
                    _ => LoadSource::Defaults,
                };
                let expected = LoadOutcome {
                    source,
                    primary: classify(primary, &store.path),
                    backup: tried_backup.then(|| classify(backup, &store.last_good)),
                };
                let text = store.read();
                let outcome = store.load_outcome().unwrap();
                assert_eq!(outcome, expected, "{primary}/{backup}");
                let expected_text = match source {
                    LoadSource::Primary => Some(original),
                    LoadSource::Backup => Some(spare),
                    LoadSource::Defaults if primary == "missing" => None,
                    LoadSource::Defaults if primary == "unreadable" => Some(""),
                    _ => Some(original),
                };
                assert_eq!(text.as_deref(), expected_text);
                assert!(!format!("{outcome:?}").contains("private"));
                let _ = store.write(r#"{"size":288}"#);
                assert_eq!(store.load_outcome(), Some(expected), "saves retain the load reason");
                fs::remove_dir_all(root).unwrap();
            }
        }
    }

    #[test]
    fn a_missing_file_means_no_preferences() {
        let root = folder("missing");
        assert_eq!(PreferencesStore::in_folder(&root).read(), None);
    }

    #[test]
    fn a_broken_file_loads_the_last_good_copy() {
        let root = folder("broken");
        let store = PreferencesStore::in_folder(&root);
        store.write(r#"{"size":300}"#).unwrap();
        store.write(r#"{"size":320}"#).unwrap();
        fs::write(store.path(), r#"{"size":3"#).unwrap();
        assert_eq!(store.read().as_deref(), Some(r#"{"size":300}"#));
        let leftovers = fs::read_dir(store.path().parent().unwrap())
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0, "no temporary files left behind");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn saves_keep_an_unreadable_original_until_access_returns() {
        use std::os::unix::fs::PermissionsExt;

        for spare in [None, Some("{broken"), Some(r#"{"size":350}"#)] {
            let root = folder(&format!("unreadable-{}", spare.unwrap_or("missing").len()));
            let store = PreferencesStore::in_folder(&root);
            let original = r#"{"size":412,"presets":[{"name":"Saved Interview"}]}"#;
            store.write(original).unwrap();
            if let Some(text) = spare {
                fs::write(&store.last_good, text).unwrap();
            }
            let permissions = fs::metadata(store.path()).unwrap().permissions();
            fs::set_permissions(store.path(), fs::Permissions::from_mode(0o000)).unwrap();
            let read_error = fs::read(store.path()).unwrap_err();
            assert_eq!(read_error.kind(), io::ErrorKind::PermissionDenied);

            let first_save = store.write(r#"{"size":288}"#);
            let quit_save = store.write(r#"{"size":288}"#);
            store.read();
            fs::set_permissions(store.path(), permissions).unwrap();

            assert_eq!(store.read().as_deref(), Some(original), "the saved Scene comes back");
            assert_eq!(first_save.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
            assert_eq!(quit_save.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
            assert_eq!(fs::read_to_string(&store.last_good).ok().as_deref(), spare);
            assert_eq!(store.write(r#"{"size":288}"#).unwrap_err().kind(), io::ErrorKind::PermissionDenied);
            PreferencesStore::in_folder(&root).write(r#"{"size":320}"#).unwrap();
            assert_eq!(fs::read_to_string(&store.last_good).unwrap(), original);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn the_first_start_copies_camframe_090_preferences_once() {
        let root = folder("adopt");
        let electron = root.join(ELECTRON_FOLDER).join(PREFERENCES_FILE);
        fs::create_dir_all(electron.parent().unwrap()).unwrap();
        fs::write(&electron, r#"{"shape":"rounded"}"#).unwrap();
        let store = PreferencesStore::in_folder(&root);
        assert!(store.adopt_from(&electron).unwrap());
        assert_eq!(store.read().as_deref(), Some(r#"{"shape":"rounded"}"#));
        fs::write(&electron, r#"{"shape":"portrait"}"#).unwrap();
        assert!(!store.adopt_from(&electron).unwrap(), "only the first start copies");
        assert_eq!(fs::read_to_string(&electron).unwrap(), r#"{"shape":"portrait"}"#, "0.9.0's file is untouched");
        fs::remove_dir_all(root).unwrap();
    }
}

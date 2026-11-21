//! Opens and saves Preferences in the app's own folder ("CamFrame Rust"). On the first start the
//! Preferences of CamFrame 0.9.0 are copied once; 0.9.0's own file is only read.

use std::path::{Path, PathBuf};

use camframe_core::settings::{Settings, preferences_from_document};
use camframe_core::store::{ELECTRON_FOLDER, PREFERENCES_FILE, PreferencesStore, config_root};

pub struct Prefs {
    store: Option<PreferencesStore>,
}

impl Prefs {
    /// Opens the store under `root` (the system app-data folder unless a test passes its own) and
    /// loads the Preferences to start with.
    pub fn open(root: Option<PathBuf>) -> (Prefs, Settings) {
        let root = root.or_else(|| config_root(|name| std::env::var(name).ok()));
        let Some(root) = root else {
            eprintln!("CamFrame: no app-data folder; Preferences will not be saved");
            return (Prefs { store: None }, preferences_from_document(None));
        };
        let store = PreferencesStore::in_folder(&root);
        if let Err(error) = store.adopt_from(&electron_preferences(&root)) {
            eprintln!("CamFrame: could not copy the CamFrame 0.9.0 Preferences: {error}");
        }
        let settings = preferences_from_document(store.read().as_deref());
        (Prefs { store: Some(store) }, settings)
    }

    pub fn save(&self, settings: &Settings) {
        let Some(store) = &self.store else { return };
        let text = match serde_json::to_string_pretty(settings) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("CamFrame: could not write Preferences: {error}");
                return;
            }
        };
        if let Err(error) = store.write(&text) {
            eprintln!("CamFrame: could not save Preferences to {}: {error}", store.path().display());
        }
    }
}

fn electron_preferences(root: &Path) -> PathBuf {
    root.join(ELECTRON_FOLDER).join(PREFERENCES_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use camframe_core::settings::Shape;
    use camframe_core::store::APP_FOLDER;

    #[test]
    fn the_first_start_opens_with_the_090_look_and_saves_to_its_own_folder() {
        let root = std::env::temp_dir().join(format!("camframe-prefs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let electron = electron_preferences(&root);
        std::fs::create_dir_all(electron.parent().unwrap()).unwrap();
        std::fs::write(&electron, r#"{"schemaVersion":15,"shape":"portrait","size":320}"#).unwrap();

        let (prefs, settings) = Prefs::open(Some(root.clone()));
        assert_eq!((settings.shape, settings.size), (Shape::Portrait, 320));
        prefs.save(&Settings { size: 400, ..settings });

        let (_, reopened) = Prefs::open(Some(root.clone()));
        assert_eq!(reopened.size, 400);
        let own = std::fs::read_to_string(root.join(APP_FOLDER).join(PREFERENCES_FILE)).unwrap();
        assert!(own.starts_with("{\n  \"schemaVersion\": 15,"), "same layout as 0.9.0's file");
        assert!(std::fs::read_to_string(&electron).unwrap().contains("320"), "0.9.0's file is untouched");
        std::fs::remove_dir_all(root).unwrap();
    }
}

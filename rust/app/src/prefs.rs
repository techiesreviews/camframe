//! Opens and saves Preferences in the app's own folder ("CamFrame Rust"). On the first start the
//! Preferences of CamFrame 0.9.0 are copied once; 0.9.0's own file is only read.

use std::path::{Path, PathBuf};

use camframe_core::settings::{Settings, preferences_from_document};
use camframe_core::store::{ELECTRON_FOLDER, PREFERENCES_FILE, PreferencesStore, config_root};

const FRAME_DEFAULTS_VERSION: u8 = 1;

#[derive(serde::Serialize)]
struct RustPreferences<'a> {
    #[serde(flatten)]
    settings: &'a Settings,
    #[serde(rename = "rustFrameDefaultsVersion")]
    frame_defaults_version: u8,
}

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
        let text = store.read();
        let mut settings = preferences_from_document(text.as_deref());
        let frame_version = text
            .as_deref()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
            .and_then(|value| value.get("rustFrameDefaultsVersion").and_then(|version| version.as_u64()));
        let prefs = Prefs { store: Some(store) };
        // Earlier, unreleased test builds inherited the old app's frame. Reset it once;
        // subsequent saves record the migration so a newly chosen frame survives restarts.
        if frame_version.unwrap_or(0) < u64::from(FRAME_DEFAULTS_VERSION) {
            settings.border_width = 0;
            settings.border_color = "#ffffff".into();
            prefs.save(&settings);
        }
        (prefs, settings)
    }

    pub fn save(&self, settings: &Settings) {
        let Some(store) = &self.store else { return };
        let text = match serde_json::to_string_pretty(&RustPreferences {
            settings,
            frame_defaults_version: FRAME_DEFAULTS_VERSION,
        }) {
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

    fn border_reset_case(label: &str, folder: &str) {
        let root = std::env::temp_dir().join(format!("camframe-border-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let file = root.join(folder).join(PREFERENCES_FILE);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        let old = r##"{"schemaVersion":15,"size":320,"borderWidth":6,"borderColor":"#ff8800"}"##;
        std::fs::write(&file, old).unwrap();

        let (_, settings) = Prefs::open(Some(root.clone()));
        assert_eq!((settings.border_width, settings.border_color.as_str()), (0, "#ffffff"), "{label}");
        assert_eq!(settings.size, 320, "other preferences stay unchanged");
        let (_, reopened) = Prefs::open(Some(root.clone()));
        assert_eq!((reopened.border_width, reopened.border_color.as_str()), (0, "#ffffff"));
        if folder == ELECTRON_FOLDER {
            assert_eq!(std::fs::read_to_string(file).unwrap(), old, "0.9.0 is read-only");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn imported_preferences_start_without_a_camera_border() {
        border_reset_case("import", ELECTRON_FOLDER);
    }

    #[test]
    fn earlier_test_preferences_start_without_a_camera_border() {
        border_reset_case("earlier-test", APP_FOLDER);
    }

    #[test]
    fn a_border_chosen_after_the_reset_survives_a_restart() {
        let root = std::env::temp_dir().join(format!("camframe-border-choice-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (prefs, mut settings) = Prefs::open(Some(root.clone()));
        assert_eq!((settings.border_width, settings.border_color.as_str()), (0, "#ffffff"));
        settings.border_width = 4;
        settings.border_color = "#123456".into();
        prefs.save(&settings);
        let (_, reopened) = Prefs::open(Some(root.clone()));
        assert_eq!((reopened.border_width, reopened.border_color.as_str()), (4, "#123456"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn startup_migration_and_later_saves_keep_unreadable_preferences() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        for version in [0, 1] {
            for spare in [None, Some("{broken"), Some(r#"{"schemaVersion":15,"size":350}"#)] {
                let root = std::env::temp_dir().join(format!(
                    "camframe-unreadable-{version}-{}-{}",
                    spare.unwrap_or("missing").len(),
                    std::process::id()
                ));
                let _ = fs::remove_dir_all(&root);
                let file = root.join(APP_FOLDER).join(PREFERENCES_FILE);
                let last_good = file.with_file_name("preferences.last-good.json");
                fs::create_dir_all(file.parent().unwrap()).unwrap();
                let original = format!(
                    r#"{{"schemaVersion":15,"size":412,"rustFrameDefaultsVersion":{version},"presets":[{{"id":"saved","name":"Saved Interview","settings":{{"size":412}}}}]}}"#
                );
                fs::write(&file, &original).unwrap();
                if let Some(text) = spare {
                    fs::write(&last_good, text).unwrap();
                }
                let permissions = fs::metadata(&file).unwrap().permissions();
                fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
                assert_eq!(fs::read(&file).unwrap_err().kind(), std::io::ErrorKind::PermissionDenied);

                let (prefs, settings) = Prefs::open(Some(root.clone()));
                prefs.save(&settings);
                fs::set_permissions(&file, permissions).unwrap();
                prefs.save(&settings);

                assert_eq!(fs::read_to_string(&file).unwrap(), original, "version {version}, spare {spare:?}");
                assert_eq!(fs::read_to_string(&last_good).ok().as_deref(), spare);
                let (_, restored) = Prefs::open(Some(root.clone()));
                assert_eq!(restored.size, 412);
                assert_eq!(restored.presets[0].name, "Saved Interview");
                fs::remove_dir_all(root).unwrap();
            }
        }
    }

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

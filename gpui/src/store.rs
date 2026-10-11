//! Preferences persistence. The document format matches Electron's `preferences.json`, but
//! the experiment keeps its own directory so it never races the Electron app's writes.

use std::path::PathBuf;

use crate::settings::{self, Settings};

pub fn preferences_path() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("camframe-gpui").join("preferences.json"))
}

pub fn load() -> Settings {
    let document = preferences_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok());
    settings::startup_settings_from_document(document)
}

pub fn save(settings: &Settings) -> anyhow::Result<()> {
    let path = preferences_path().ok_or_else(|| anyhow::anyhow!("no configuration directory"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(&settings::to_document(settings)?)?;
    // Write then rename so a crash never leaves a truncated document.
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}

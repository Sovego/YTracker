//! Persistent desktop configuration model and file-backed manager.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Default configured workday hours.
fn default_workday_hours() -> u8 {
    8
}

/// Default workday start time in `HH:MM` local format.
fn default_workday_start_time() -> String {
    "09:00".to_string()
}

/// Default workday end time in `HH:MM` local format.
fn default_workday_end_time() -> String {
    "17:00".to_string()
}

/// Represents the application configuration persisted on disk, including timer notification interval and workday settings.
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Config {
    pub timer_notification_interval: u32,
    #[serde(default = "default_workday_hours")]
    pub workday_hours: u8,
    #[serde(default = "default_workday_start_time")]
    pub workday_start_time: String,
    #[serde(default = "default_workday_end_time")]
    pub workday_end_time: String,
}

impl Default for Config {
    /// Returns baseline config when no persisted settings are available.
    fn default() -> Self {
        Self {
            timer_notification_interval: 15,
            workday_hours: default_workday_hours(),
            workday_start_time: default_workday_start_time(),
            workday_end_time: default_workday_end_time(),
        }
    }
}

/// Manages loading and saving of application configuration to a JSON file in the platform-specific config directory.
pub struct ConfigManager {
    path: PathBuf,
}

impl ConfigManager {
    /// Creates a manager bound to the platform-specific app config path.
    pub fn new() -> Self {
        // Use directories crate to find config dir
        // If directories crate fails, fallback to local?
        // For now assume it works.
        let dirs = directories::ProjectDirs::from("ru", "sovego", "ytracker")
            .expect("Could not determine config directory");
        let path = dirs.config_dir().join("config.json");
        Self { path }
    }

    /// Loads config from disk, falling back to defaults on read/parse errors.
    pub fn load(&self) -> Config {
        if self.path.exists() {
            let content = fs::read_to_string(&self.path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Config::default()
        }
    }

    /// Persists config to disk, creating parent directories when needed.
    pub fn save(&self, config: &Config) -> Result<(), std::io::Error> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(config)?;
        fs::write(&self.path, content)?;
        Ok(())
    }
}

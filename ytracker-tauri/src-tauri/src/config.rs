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

#[cfg(test)]
mod tests {
    use super::{Config, ConfigManager};
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        env::temp_dir().join(format!("ytracker-tests-{name}-{nanos}/config.json"))
    }

    #[test]
    fn default_config_has_expected_values() {
        let config = Config::default();
        assert_eq!(config.timer_notification_interval, 15);
        assert_eq!(config.workday_hours, 8);
        assert_eq!(config.workday_start_time, "09:00");
        assert_eq!(config.workday_end_time, "17:00");
    }

    #[test]
    fn load_missing_file_returns_default() {
        let path = unique_path("missing");
        let manager = ConfigManager { path };

        let loaded = manager.load();
        assert_eq!(loaded.timer_notification_interval, 15);
        assert_eq!(loaded.workday_hours, 8);
    }

    #[test]
    fn save_and_load_round_trip() {
        let path = unique_path("roundtrip");
        let parent = path.parent().map(ToOwned::to_owned);

        let manager = ConfigManager { path: path.clone() };
        let config = Config {
            timer_notification_interval: 30,
            workday_hours: 7,
            workday_start_time: "10:15".to_string(),
            workday_end_time: "18:45".to_string(),
        };

        manager.save(&config).expect("save should succeed");
        let loaded = manager.load();

        assert_eq!(loaded.timer_notification_interval, 30);
        assert_eq!(loaded.workday_hours, 7);
        assert_eq!(loaded.workday_start_time, "10:15");
        assert_eq!(loaded.workday_end_time, "18:45");

        if let Some(parent) = parent {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn load_invalid_json_falls_back_to_default() {
        let path = unique_path("invalid");
        let parent = path.parent().expect("parent must exist");
        fs::create_dir_all(parent).expect("create temp directory");
        fs::write(&path, "not-valid-json").expect("write invalid config");

        let manager = ConfigManager { path: path.clone() };
        let loaded = manager.load();
        assert_eq!(loaded.timer_notification_interval, 15);
        assert_eq!(loaded.workday_start_time, "09:00");

        let _ = fs::remove_dir_all(parent);
    }
}

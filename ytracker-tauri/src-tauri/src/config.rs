use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct Config {
    pub timer_notification_interval: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            timer_notification_interval: 15,
        }
    }
}

pub struct ConfigManager {
    path: PathBuf,
}

impl ConfigManager {
    pub fn new() -> Self {
        // Use directories crate to find config dir
        // If directories crate fails, fallback to local?
        // For now assume it works.
        let dirs = directories::ProjectDirs::from("ru", "sovego", "ytracker")
            .expect("Could not determine config directory");
        let path = dirs.config_dir().join("config.json");
        Self { path }
    }

    pub fn load(&self) -> Config {
        if self.path.exists() {
            let content = fs::read_to_string(&self.path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Config::default()
        }
    }

    pub fn save(&self, config: &Config) -> Result<(), std::io::Error> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(config)?;
        fs::write(&self.path, content)?;
        Ok(())
    }
}

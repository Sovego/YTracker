use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use ytracker_api::config::DEFAULT_COOLDOWN_MS;
use ytracker_api::rate_limiter::RateLimiter;

const KEYRING_ACCOUNT: &str = "session";
const KEYRING_FALLBACK_SERVICE: &str = "ru.sovego.ytracker-tauri";

#[derive(Debug, Clone)]
pub struct ClientCredentials {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientCredentialsInfo {
    pub client_id: Option<String>,
    pub has_client_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionToken {
    pub token: String,
    pub org_id: Option<String>,
    pub org_type: String,
}

#[derive(Clone)]
pub struct SecretsManager {
    inner: Arc<SecretsInner>,
}

struct SecretsInner {
    keyring_service: String,
    session_cache: Mutex<Option<SessionToken>>,
    client_id: Option<String>,
    client_secret: Option<String>,
    rate_limiter: RateLimiter,
}

impl SecretsManager {
    pub fn initialize(app_handle: &AppHandle) -> Result<Self, String> {
        let identifier = app_handle.config().identifier.clone();
        let service = if identifier.trim().is_empty() {
            KEYRING_FALLBACK_SERVICE.to_string()
        } else {
            identifier
        };

        let manager = SecretsManager {
            inner: Arc::new(SecretsInner {
                keyring_service: service,
                session_cache: Mutex::new(None),
                client_id: option_env!("YTRACKER_CLIENT_ID").map(|v| v.to_string()),
                client_secret: option_env!("YTRACKER_CLIENT_SECRET").map(|v| v.to_string()),
                rate_limiter: RateLimiter::new(Duration::from_millis(DEFAULT_COOLDOWN_MS)),
            }),
        };

        let session = manager.load_session_from_store()?;
        *manager.inner.session_cache.lock().unwrap() = session;

        Ok(manager)
    }

    pub fn get_rate_limiter(&self) -> RateLimiter {
        self.inner.rate_limiter.clone()
    }

    pub fn get_public_info(&self) -> Result<ClientCredentialsInfo, String> {
        Ok(ClientCredentialsInfo {
            client_id: self.inner.client_id.clone(),
            has_client_secret: self.inner.client_secret.is_some(),
        })
    }

    pub fn get_credentials(&self) -> Result<Option<ClientCredentials>, String> {
        match (&self.inner.client_id, &self.inner.client_secret) {
            (Some(id), Some(secret)) => Ok(Some(ClientCredentials {
                client_id: id.clone(),
                client_secret: secret.clone(),
            })),
            _ => Ok(None),
        }
    }

    pub fn save_session(
        &self,
        token: &str,
        org_id: Option<&str>,
        org_type: &str,
    ) -> Result<(), String> {
        let trimmed_token = token.trim();
        if trimmed_token.is_empty() {
            return Err("Access token must not be empty".into());
        }

        let normalized_org_type = normalize_org_type(org_type);
        let cleaned_org_id = org_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let session = SessionToken {
            token: trimmed_token.to_string(),
            org_id: cleaned_org_id.clone(),
            org_type: normalized_org_type.clone(),
        };

        self.persist_session(Some(&session))?;
        *self.inner.session_cache.lock().unwrap() = Some(session);

        Ok(())
    }

    pub fn get_session(&self) -> Result<Option<SessionToken>, String> {
        {
            let cache = self.inner.session_cache.lock().unwrap();
            if cache.is_some() {
                return Ok(cache.clone());
            }
        }

        let session = self.load_session_from_store()?;
        *self.inner.session_cache.lock().unwrap() = session.clone();
        Ok(session)
    }

    pub fn clear_session(&self) -> Result<(), String> {
        self.persist_session(None)?;
        *self.inner.session_cache.lock().unwrap() = None;
        Ok(())
    }

    fn load_session_from_store(&self) -> Result<Option<SessionToken>, String> {
        let entry = self.session_entry()?;
        match entry.get_password() {
            Ok(secret) => {
                let token = serde_json::from_str(&secret)
                    .map_err(|err| format!("Failed to decode stored session: {err}"))?;
                Ok(Some(token))
            }
            Err(KeyringError::NoEntry) => Ok(None),
            Err(err) => Err(format!("Failed to read session from keyring: {err}")),
        }
    }

    fn persist_session(&self, session: Option<&SessionToken>) -> Result<(), String> {
        let entry = self.session_entry()?;
        match session {
            Some(data) => {
                let payload = serde_json::to_string(data)
                    .map_err(|err| format!("Failed to serialize session: {err}"))?;
                entry
                    .set_password(&payload)
                    .map_err(|err| format!("Failed to store session in keyring: {err}"))
            }
            None => match entry.delete_password() {
                Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
                Err(err) => Err(format!("Failed to delete session from keyring: {err}")),
            },
        }
    }

    fn session_entry(&self) -> Result<Entry, String> {
        Entry::new(&self.inner.keyring_service, KEYRING_ACCOUNT)
            .map_err(|err| format!("Failed to open keyring entry: {err}"))
    }
}

fn normalize_org_type(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "cloud" => "cloud".to_string(),
        _ => "yandex360".to_string(),
    }
}

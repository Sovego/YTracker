//! Configuration primitives for Tracker API base URL, headers, and timeouts.

use std::time::Duration;

pub const DEFAULT_API_BASE: &str = "https://api.tracker.yandex.net";
pub const DEFAULT_API_VERSION: &str = "v3";
pub const DEFAULT_USER_AGENT: &str = "ytracker-tauri";
pub const DEFAULT_COOLDOWN_MS: u64 = 500;
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 10;

/// Represents organization types supported by Tracker API, which require different header names for org id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OrgType {
    Yandex360,
    Cloud,
}

impl OrgType {
    /// Returns org header name required by Tracker API for selected org type.
    pub fn header_name(&self) -> &'static str {
        match self {
            OrgType::Yandex360 => "X-Org-ID",
            OrgType::Cloud => "X-Cloud-Org-ID",
        }
    }
}
/// Represents authorization scheme used for API requests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthMethod {
    OAuth,
    Bearer,
}

impl AuthMethod {
    /// Returns authorization scheme string used in `Authorization` header.
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthMethod::OAuth => "OAuth",
            AuthMethod::Bearer => "Bearer",
        }
    }
}
/// Represents configuration parameters for Tracker API client, including base URL, auth token, headers and timeouts.
#[derive(Clone, Debug)]
pub struct TrackerConfig {
    pub base_url: String,
    pub api_version: String,
    pub token: String,
    pub org_id: Option<String>,
    pub org_type: OrgType,
    pub accept_language: Option<String>,
    pub user_agent: String,
    pub cooldown: Duration,
    pub timeout: Duration,
    pub connect_timeout: Duration,
    pub auth_method: AuthMethod,
}

impl TrackerConfig {
    /// Creates config with defaults for base URL, timeouts, and auth method.
    pub fn new(token: impl Into<String>, org_type: OrgType) -> Self {
        Self {
            base_url: DEFAULT_API_BASE.to_string(),
            api_version: DEFAULT_API_VERSION.to_string(),
            token: token.into(),
            org_id: None,
            org_type,
            accept_language: None,
            user_agent: DEFAULT_USER_AGENT.to_string(),
            cooldown: Duration::from_millis(DEFAULT_COOLDOWN_MS),
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
            connect_timeout: Duration::from_secs(DEFAULT_CONNECT_TIMEOUT_SECS),
            auth_method: AuthMethod::OAuth,
        }
    }

    /// Sets organization id header value.
    pub fn with_org_id(mut self, org_id: impl Into<String>) -> Self {
        self.org_id = Some(org_id.into());
        self
    }

    /// Overrides API base URL.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    /// Overrides API version path prefix.
    pub fn with_api_version(mut self, version: impl Into<String>) -> Self {
        self.api_version = version.into();
        self
    }

    /// Sets `Accept-Language` header value.
    pub fn with_accept_language(mut self, language: impl Into<String>) -> Self {
        self.accept_language = Some(language.into());
        self
    }

    /// Sets custom user agent string.
    pub fn with_user_agent(mut self, ua: impl Into<String>) -> Self {
        self.user_agent = ua.into();
        self
    }

    /// Sets request pacing cooldown interval.
    pub fn with_cooldown(mut self, duration: Duration) -> Self {
        self.cooldown = duration;
        self
    }

    /// Sets per-request total timeout.
    pub fn with_timeout(mut self, duration: Duration) -> Self {
        self.timeout = duration;
        self
    }

    /// Sets transport connect timeout.
    pub fn with_connect_timeout(mut self, duration: Duration) -> Self {
        self.connect_timeout = duration;
        self
    }

    /// Selects authorization scheme used for API requests.
    pub fn with_auth_method(mut self, method: AuthMethod) -> Self {
        self.auth_method = method;
        self
    }

    /// Returns canonical API root URL ending with a trailing slash.
    pub fn api_root(&self) -> String {
        format!(
            "{}/{}/",
            self.base_url.trim_end_matches('/'),
            self.api_version.trim_start_matches('/')
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthMethod, OrgType, TrackerConfig};
    use std::time::Duration;

    #[test]
    fn org_type_header_names_match_contract() {
        assert_eq!(OrgType::Yandex360.header_name(), "X-Org-ID");
        assert_eq!(OrgType::Cloud.header_name(), "X-Cloud-Org-ID");
    }

    #[test]
    fn auth_method_strings_match_header_scheme() {
        assert_eq!(AuthMethod::OAuth.as_str(), "OAuth");
        assert_eq!(AuthMethod::Bearer.as_str(), "Bearer");
    }

    #[test]
    fn new_config_uses_defaults_and_builder_overrides() {
        let config = TrackerConfig::new("token-1", OrgType::Cloud)
            .with_org_id("org-77")
            .with_base_url("https://example.test/")
            .with_api_version("/v9")
            .with_accept_language("en")
            .with_user_agent("yt-tests")
            .with_cooldown(Duration::from_millis(50))
            .with_timeout(Duration::from_secs(5))
            .with_connect_timeout(Duration::from_secs(3))
            .with_auth_method(AuthMethod::Bearer);

        assert_eq!(config.token, "token-1");
        assert_eq!(config.org_id.as_deref(), Some("org-77"));
        assert_eq!(config.accept_language.as_deref(), Some("en"));
        assert_eq!(config.user_agent, "yt-tests");
        assert_eq!(config.cooldown, Duration::from_millis(50));
        assert_eq!(config.timeout, Duration::from_secs(5));
        assert_eq!(config.connect_timeout, Duration::from_secs(3));
        assert_eq!(config.auth_method, AuthMethod::Bearer);
        assert_eq!(config.api_root(), "https://example.test/v9/");
    }
}

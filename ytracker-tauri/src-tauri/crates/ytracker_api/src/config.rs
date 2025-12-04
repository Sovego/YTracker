use std::time::Duration;

pub const DEFAULT_API_BASE: &str = "https://api.tracker.yandex.net";
pub const DEFAULT_API_VERSION: &str = "v3";
pub const DEFAULT_USER_AGENT: &str = "ytracker-tauri";
pub const DEFAULT_COOLDOWN_MS: u64 = 500;
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 10;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OrgType {
    Yandex360,
    Cloud,
}

impl OrgType {
    pub fn header_name(&self) -> &'static str {
        match self {
            OrgType::Yandex360 => "X-Org-ID",
            OrgType::Cloud => "X-Cloud-Org-ID",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthMethod {
    OAuth,
    Bearer,
}

impl AuthMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthMethod::OAuth => "OAuth",
            AuthMethod::Bearer => "Bearer",
        }
    }
}

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

    pub fn with_org_id(mut self, org_id: impl Into<String>) -> Self {
        self.org_id = Some(org_id.into());
        self
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    pub fn with_api_version(mut self, version: impl Into<String>) -> Self {
        self.api_version = version.into();
        self
    }

    pub fn with_accept_language(mut self, language: impl Into<String>) -> Self {
        self.accept_language = Some(language.into());
        self
    }

    pub fn with_user_agent(mut self, ua: impl Into<String>) -> Self {
        self.user_agent = ua.into();
        self
    }

    pub fn with_cooldown(mut self, duration: Duration) -> Self {
        self.cooldown = duration;
        self
    }

    pub fn with_timeout(mut self, duration: Duration) -> Self {
        self.timeout = duration;
        self
    }

    pub fn with_connect_timeout(mut self, duration: Duration) -> Self {
        self.connect_timeout = duration;
        self
    }

    pub fn with_auth_method(mut self, method: AuthMethod) -> Self {
        self.auth_method = method;
        self
    }

    pub fn api_root(&self) -> String {
        format!(
            "{}/{}/",
            self.base_url.trim_end_matches('/'),
            self.api_version.trim_start_matches('/')
        )
    }
}

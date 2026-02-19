//! User profile models returned by Tracker identity endpoints.

use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
/// Represents user profile information returned by Tracker API, including display/login/email and avatar metadata.
pub struct UserProfile {
    pub display: Option<String>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(rename = "avatarId")]
    pub avatar_id: Option<String>,
}

impl UserProfile {
    /// Returns best available avatar identifier/url from profile payload.
    pub fn avatar(&self) -> Option<String> {
        self.avatar_url
            .clone()
            .or_else(|| self.avatar_id.clone())
    }
}

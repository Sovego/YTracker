use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub display: Option<String>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(rename = "avatarId")]
    pub avatar_id: Option<String>,
}

impl UserProfile {
    pub fn avatar(&self) -> Option<String> {
        self.avatar_url
            .clone()
            .or_else(|| self.avatar_id.clone())
    }
}

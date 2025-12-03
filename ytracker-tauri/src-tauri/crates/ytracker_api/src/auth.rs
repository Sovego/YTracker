use reqwest::Client;
use serde::Deserialize;

use crate::error::{Result, TrackerError};

const TOKEN_URL: &str = "https://oauth.yandex.ru/token";

#[derive(Debug, Deserialize, Clone)]
pub struct TokenResponse {
    #[serde(rename = "access_token")]
    pub access_token: String,
    #[serde(rename = "token_type")]
    pub token_type: Option<String>,
    #[serde(rename = "expires_in")]
    pub expires_in: Option<i64>,
    #[serde(default)]
    pub scope: Option<String>,
}

pub async fn exchange_code(
    code: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<TokenResponse> {
    let client = Client::new();
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
        ])
        .send()
        .await?;

    let status = response.status();
    if status.is_success() {
        response.json::<TokenResponse>().await.map_err(TrackerError::from)
    } else {
        let body = response.text().await.unwrap_or_default();
        Err(TrackerError::http(status, None, body))
    }
}

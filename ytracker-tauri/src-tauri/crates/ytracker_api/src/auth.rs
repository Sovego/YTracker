//! OAuth token exchange helpers for Tracker authentication.

use reqwest::Client;
use serde::Deserialize;

use crate::error::{Result, TrackerError};

const TOKEN_URL: &str = "https://oauth.yandex.ru/token";

#[derive(Debug, Deserialize, Clone)]
/// OAuth token response payload returned by Tracker auth endpoint.
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

/// Exchanges OAuth authorization code for an access token.
pub async fn exchange_code(
    code: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<TokenResponse> {
    let client = Client::new();
    exchange_code_with_url(&client, TOKEN_URL, code, client_id, client_secret).await
}

async fn exchange_code_with_url(
    client: &Client,
    token_url: &str,
    code: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<TokenResponse> {
    let response = client
        .post(token_url)
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

#[cfg(test)]
mod tests {
    use super::exchange_code_with_url;
    use crate::error::TrackerError;
    use mockito::{Matcher, Server};
    use reqwest::Client;
    use reqwest::StatusCode;

    #[tokio::test]
    async fn exchange_code_parses_success_response() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/token")
            .match_header("content-type", "application/x-www-form-urlencoded")
            .match_body(Matcher::AllOf(vec![
                Matcher::UrlEncoded("grant_type".into(), "authorization_code".into()),
                Matcher::UrlEncoded("code".into(), "abc".into()),
                Matcher::UrlEncoded("client_id".into(), "client-1".into()),
                Matcher::UrlEncoded("client_secret".into(), "secret-1".into()),
            ]))
            .with_status(200)
            .with_body(
                r#"{"access_token":"token-xyz","token_type":"bearer","expires_in":3600}"#,
            )
            .create_async()
            .await;

        let client = Client::new();
        let response = exchange_code_with_url(
            &client,
            &format!("{}/token", server.url()),
            "abc",
            "client-1",
            "secret-1",
        )
        .await
        .expect("exchange should succeed");

        assert_eq!(response.access_token, "token-xyz");
        assert_eq!(response.token_type.as_deref(), Some("bearer"));
        assert_eq!(response.expires_in, Some(3600));
    }

    #[tokio::test]
    async fn exchange_code_maps_http_failure() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/token")
            .with_status(400)
            .with_body("invalid_grant")
            .create_async()
            .await;

        let client = Client::new();
        let result = exchange_code_with_url(
            &client,
            &format!("{}/token", server.url()),
            "abc",
            "client-1",
            "secret-1",
        )
        .await;

        match result {
            Err(TrackerError::Http { status, message, .. }) => {
                assert_eq!(status, StatusCode::BAD_REQUEST);
                assert_eq!(message, "invalid_grant");
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }
}

use crate::config::TrackerConfig;
use crate::error::{Result, TrackerError};
use crate::models::{
    AttachmentMetadata,
    Comment as TrackerComment,
    Issue as TrackerIssue,
    SimpleEntityRaw,
    Transition as TrackerTransition,
    UserProfile,
};
use crate::rate_limiter::RateLimiter;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_LANGUAGE, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client as HttpClient, Method, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone)]
pub struct TrackerClient {
    http: HttpClient,
    config: TrackerConfig,
    limiter: RateLimiter,
}

impl TrackerClient {
    pub fn new(config: TrackerConfig) -> Result<Self> {
        let http = build_http_client(&config)?;
        let limiter = RateLimiter::new(config.cooldown);
        Ok(Self {
            http,
            config,
            limiter,
        })
    }

    pub fn new_with_limiter(config: TrackerConfig, limiter: RateLimiter) -> Result<Self> {
        let http = build_http_client(&config)?;
        Ok(Self {
            http,
            config,
            limiter,
        })
    }

    pub fn config(&self) -> &TrackerConfig {
        &self.config
    }

    pub fn rate_limiter(&self) -> &RateLimiter {
        &self.limiter
    }

    pub async fn get<T>(&self, path: &str) -> Result<T>
    where
        T: DeserializeOwned,
    {
        self.send_with_body(Method::GET, path, Option::<&Value>::None).await
    }

    pub async fn get_with_query<T>(
        &self,
        path: &str,
        query: Option<&[(&str, &str)]>,
    ) -> Result<T>
    where
        T: DeserializeOwned,
    {
        self.limiter.hit().await;
        let mut request = self.http.get(self.url_for(path));
        if let Some(params) = query {
            request = request.query(params);
        }
        let response = request.send().await?;
        Self::parse_json(response).await
    }

    pub async fn post<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        self.send_with_body(Method::POST, path, Some(body)).await
    }

    pub async fn patch<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        self.send_with_body(Method::PATCH, path, Some(body)).await
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        self.send_expect_empty(Method::DELETE, path, None::<&Value>).await
    }

    pub async fn send_with_body<B, T>(&self, method: Method, path: &str, body: Option<&B>) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        self.limiter.hit().await;
        let url = self.url_for(path);
        let mut request = self.http.request(method, url);
        if let Some(payload) = body {
            request = request.json(payload);
        }
        let response = request.send().await?;
        Self::parse_json(response).await
    }

    pub async fn send_expect_empty<B>(&self, method: Method, path: &str, body: Option<&B>) -> Result<()>
    where
        B: Serialize + ?Sized,
    {
        self.limiter.hit().await;
        let url = self.url_for(path);
        let mut request = self.http.request(method, url);
        if let Some(payload) = body {
            request = request.json(payload);
        }
        let response = request.send().await?;
        Self::ensure_success(response).await
    }

    fn url_for(&self, path: &str) -> String {
        let mut base = self.config.api_root();
        let trimmed = path.trim_start_matches('/');
        base.push_str(trimmed);
        base
    }

    fn absolute_url(&self, href: &str) -> Result<Url> {
        if href.starts_with("http://") || href.starts_with("https://") {
            return Url::parse(href).map_err(|err| TrackerError::Other(err.to_string()));
        }

        let base = if self.config.base_url.ends_with('/') {
            self.config.base_url.clone()
        } else {
            format!("{}/", self.config.base_url)
        };

        Url::parse(&base)
            .and_then(|url| url.join(href))
            .map_err(|err| TrackerError::Other(err.to_string()))
    }

    async fn parse_json<T>(response: Response) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let status = response.status();
        if status.is_success() {
            response.json::<T>().await.map_err(TrackerError::from)
        } else if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            let body = response.text().await.unwrap_or_default();
            Err(TrackerError::Authentication(format!(
                "Access denied ({}) - {}",
                status, body
            )))
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(build_http_error(status, &body))
        }
    }

    async fn ensure_success(response: Response) -> Result<()> {
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            let body = response.text().await.unwrap_or_default();
            Err(TrackerError::Authentication(format!(
                "Access denied ({}) - {}",
                status, body
            )))
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(build_http_error(status, &body))
        }
    }

    pub async fn get_myself(&self) -> Result<UserProfile> {
        self.get("myself").await
    }

    pub async fn get_issue(&self, issue_key: &str) -> Result<TrackerIssue> {
        let path = format!("issues/{}", issue_key);
        self.get_with_query(&path, Some(&[("fields", ISSUE_SUMMARY_FIELDS)])).await
    }

    pub async fn search_issues(&self, query: &str, per_page: Option<u32>) -> Result<Vec<TrackerIssue>> {
        let per_page = per_page.unwrap_or(100).clamp(1, 500);
        self.limiter.hit().await;
        let url = format!("{}issues/_search", self.config.api_root());
        let params = [
            ("perPage", per_page.to_string()),
            ("page", "1".to_string()),
            ("fields", ISSUE_SUMMARY_FIELDS.to_string()),
        ];
        let payload = IssueSearchRequest::new(query);
        let response = self
            .http
            .post(url)
            .query(&params)
            .json(&payload)
            .send()
            .await?;
        Self::parse_json(response).await
    }

    pub async fn get_issue_comments(&self, issue_key: &str) -> Result<Vec<TrackerComment>> {
        let path = format!("issues/{}/comments", issue_key);
        self.get(&path).await
    }

    pub async fn get_issue_attachments(&self, issue_key: &str) -> Result<Vec<AttachmentMetadata>> {
        let path = format!("issues/{}/attachments", issue_key);
        self.get(&path).await
    }

    pub async fn get_statuses(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.get("statuses").await
    }

    pub async fn get_resolutions(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.get("resolutions").await
    }

    pub async fn add_comment(&self, issue_key: &str, text: &str) -> Result<()> {
        let path = format!("issues/{}/comments", issue_key);
        let payload = CommentCreateRequest { text };
        self.send_expect_empty(Method::POST, &path, Some(&payload)).await
    }

    pub async fn update_issue_fields(
        &self,
        issue_key: &str,
        summary: Option<&str>,
        description: Option<&str>,
    ) -> Result<()> {
        let path = format!("issues/{}", issue_key);
        let payload = IssueUpdateRequest { summary, description };
        self.send_expect_empty(Method::PATCH, &path, Some(&payload)).await
    }

    pub async fn get_transitions(&self, issue_key: &str) -> Result<Vec<TrackerTransition>> {
        let path = format!("issues/{}/transitions", issue_key);
        self.get(&path).await
    }

    pub async fn execute_transition(
        &self,
        issue_key: &str,
        transition_id: &str,
        comment: Option<&str>,
        resolution: Option<&str>,
    ) -> Result<()> {
        let path = format!(
            "issues/{}/transitions/{}/_execute",
            issue_key, transition_id
        );
        let payload = TransitionExecuteRequest { comment, resolution };
        self.send_expect_empty(Method::POST, &path, Some(&payload)).await
    }

    pub async fn log_work_entry(
        &self,
        issue_key: &str,
        start: &str,
        duration: &str,
        comment: Option<&str>,
    ) -> Result<()> {
        let path = format!("issues/{}/worklog", issue_key);
        let payload = WorklogCreateRequest {
            start,
            duration,
            comment,
        };
        self.send_expect_empty(Method::POST, &path, Some(&payload)).await
    }

    pub async fn fetch_binary(&self, href: &str) -> Result<BinaryContent> {
        self.limiter.hit().await;
        let url = self.absolute_url(href)?;
        let response = self.http.get(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(build_http_error(status, &body));
        }
        let mime_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        let bytes = response.bytes().await?.to_vec();
        Ok(BinaryContent { bytes, mime_type })
    }
}

fn build_http_client(config: &TrackerConfig) -> Result<HttpClient> {
    let mut headers = HeaderMap::new();

    let auth_value = header_value(format!(
        "{} {}",
        config.auth_method.as_str(),
        config.token
    ))?;
    headers.insert(AUTHORIZATION, auth_value);

    if let Some(language) = &config.accept_language {
        headers.insert(ACCEPT_LANGUAGE, header_value(language.clone())?);
    }

    headers.insert(USER_AGENT, header_value(config.user_agent.clone())?);

    if let Some(org_id) = &config.org_id {
        let header_name = HeaderName::from_bytes(config.org_type.header_name().as_bytes())
            .map_err(|err| TrackerError::Other(err.to_string()))?;
        headers.insert(header_name, header_value(org_id.clone())?);
    }

    HttpClient::builder()
        .default_headers(headers)
        .timeout(config.timeout)
        .connect_timeout(config.connect_timeout)
        .build()
        .map_err(|err| TrackerError::Other(err.to_string()))
}

fn header_value(value: String) -> Result<HeaderValue> {
    HeaderValue::from_str(&value).map_err(|err| TrackerError::Other(err.to_string()))
}

fn build_http_error(status: StatusCode, body: &str) -> TrackerError {
    let code = extract_error_code(body);
    TrackerError::http(status, code, body.to_string())
}

fn extract_error_code(body: &str) -> Option<String> {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()))
}

const ISSUE_SUMMARY_FIELDS: &str = "key,summary,description,status,priority";

#[derive(Debug, Serialize)]
struct CommentCreateRequest<'a> {
    text: &'a str,
}

#[derive(Debug, Serialize)]
struct IssueUpdateRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct TransitionExecuteRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolution: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct WorklogCreateRequest<'a> {
    start: &'a str,
    duration: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<&'a str>,
}

#[derive(Debug, Clone)]
pub struct BinaryContent {
    pub bytes: Vec<u8>,
    pub mime_type: Option<String>,
}

#[derive(Serialize)]
struct IssueSearchRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filter: Option<IssueSearchFilter<'a>>,
}

impl<'a> IssueSearchRequest<'a> {
    fn new(query: &'a str) -> Self {
        if query.trim().is_empty() {
            Self {
                query: None,
                filter: None,
            }
        } else {
            let trimmed = query.trim();
            Self {
                query: Some(trimmed),
                filter: None,
            }
        }
    }
}

#[derive(Serialize)]
struct IssueSearchFilter<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<&'a str>,
}

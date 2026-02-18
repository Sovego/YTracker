use crate::config::TrackerConfig;
use crate::error::{Result, TrackerError};
use crate::models::{
    AttachmentMetadata,
    Comment as TrackerComment,
    Issue as TrackerIssue,
    SimpleEntityRaw,
    Transition as TrackerTransition,
    UserProfile,
    WorklogEntry as TrackerWorklogEntry,
};
use crate::rate_limiter::RateLimiter;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_LANGUAGE, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client as HttpClient, Method, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map as JsonMap, Value};

#[derive(Clone)]
pub struct TrackerClient {
    http: HttpClient,
    config: TrackerConfig,
    limiter: RateLimiter,
}

const FILTER_PAGE_LIMIT: u32 = 10;
const FILTER_PAGE_SIZE: u32 = 200;

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

    pub async fn search_issues(&self, params: &IssueSearchParams, per_page: Option<u32>) -> Result<Vec<TrackerIssue>> {
        let per_page = per_page.unwrap_or(100).clamp(1, 500);
        self.limiter.hit().await;
        let url = format!("{}issues/_search", self.config.api_root());
        let paging_params = [
            ("perPage", per_page.to_string()),
            ("page", "1".to_string()),
            ("fields", ISSUE_SUMMARY_FIELDS.to_string()),
        ];
        let payload = IssueSearchRequest::from_params(params);
        let response = self
            .http
            .post(url)
            .query(&paging_params)
            .json(&payload)
            .send()
            .await?;
        Self::parse_json(response).await
    }

    pub async fn search_issues_scroll(
        &self,
        params: &IssueSearchParams,
        scroll_id: Option<&str>,
        per_scroll: Option<u32>,
        scroll_type: ScrollType,
        scroll_ttl_millis: Option<u64>,
    ) -> Result<ScrollPage<TrackerIssue>> {
        self.limiter.hit().await;
        let url = format!("{}issues/_search", self.config.api_root());
        let mut request_params = vec![("fields", ISSUE_SUMMARY_FIELDS.to_string())];

        if let Some(id) = scroll_id {
            request_params.push(("scrollId", id.to_string()));
        } else {
            let per_scroll = per_scroll.unwrap_or(100).clamp(1, 1000);
            request_params.push(("scrollType", scroll_type.as_str().to_string()));
            request_params.push(("perScroll", per_scroll.to_string()));
        }

        if let Some(ttl) = scroll_ttl_millis {
            request_params.push(("scrollTTLMillis", ttl.to_string()));
        }

        let payload = IssueSearchRequest::from_params(params);
        let response = self
            .http
            .post(url)
            .query(&request_params)
            .json(&payload)
            .send()
            .await?;

        let (headers, issues): (HeaderMap, Vec<TrackerIssue>) =
            parse_json_with_headers(response).await?;

        Ok(ScrollPage {
            items: issues,
            scroll_id: header_string(&headers, "X-Scroll-Id"),
            scroll_token: header_string(&headers, "X-Scroll-Token"),
            total_count: header_string(&headers, "X-Total-Count").and_then(|value| value.parse().ok()),
        })
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

    pub async fn get_issue_worklogs(&self, issue_key: &str) -> Result<Vec<TrackerWorklogEntry>> {
        const WORKLOG_PER_PAGE: usize = 100;
        const WORKLOG_MAX_ENTRIES: usize = 500;

        let path = format!("issues/{}/worklog", issue_key);
        let mut result: Vec<TrackerWorklogEntry> = Vec::new();
        let mut cursor: Option<String> = None;

        loop {
            let per_page_value = WORKLOG_PER_PAGE.to_string();
            let mut query = vec![("perPage", per_page_value.as_str())];
            if let Some(cursor_id) = cursor.as_deref() {
                query.push(("id", cursor_id));
            }

            let chunk: Vec<TrackerWorklogEntry> = self.get_with_query(&path, Some(&query)).await?;
            if chunk.is_empty() {
                break;
            }

            let last_id = chunk
                .last()
                .and_then(|entry| worklog_id_string(&entry.id));
            let chunk_len = chunk.len();
            result.extend(chunk);

            if result.len() >= WORKLOG_MAX_ENTRIES {
                result.truncate(WORKLOG_MAX_ENTRIES);
                break;
            }

            if chunk_len < WORKLOG_PER_PAGE {
                break;
            }

            if let Some(next_id) = last_id {
                cursor = Some(next_id);
            } else {
                break;
            }
        }

        Ok(result)
    }

    pub async fn clear_scroll_context(&self, scroll_id: &str) -> Result<()> {
        #[derive(Serialize)]
        struct ScrollClearRequest<'a> {
            #[serde(rename = "scrollId")]
            scroll_id: &'a str,
        }

        let payload = ScrollClearRequest { scroll_id };
        self.send_expect_empty(Method::POST, "system/search/scroll/_clear", Some(&payload))
            .await
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

    pub async fn list_all_queues(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.fetch_simple_entity_pages("queues").await
    }

    pub async fn list_all_projects(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.fetch_simple_entity_pages("projects").await
    }

    pub async fn list_all_users(&self) -> Result<Vec<UserProfile>> {
        self.fetch_user_pages("users").await
    }

    async fn fetch_simple_entity_pages(&self, path: &str) -> Result<Vec<SimpleEntityRaw>> {
        let mut results = Vec::new();
        let base_url = self.url_for(path);
        let mut page = 1;
        let per_page = FILTER_PAGE_SIZE.clamp(1, 500);

        loop {
            if page > FILTER_PAGE_LIMIT {
                break;
            }
            self.limiter.hit().await;
            let query = vec![
                ("perPage".to_string(), per_page.to_string()),
                ("page".to_string(), page.to_string()),
            ];
            let response = self
                .http
                .get(base_url.clone())
                .query(&query)
                .send()
                .await?;
            let chunk: Vec<SimpleEntityRaw> = Self::parse_json(response).await?;
            let count = chunk.len();
            if count == 0 {
                break;
            }
            results.extend(chunk);
            if count < per_page as usize {
                break;
            }
            page += 1;
        }

        Ok(results)
    }

    async fn fetch_user_pages(&self, path: &str) -> Result<Vec<UserProfile>> {
        let mut results = Vec::new();
        let base_url = self.url_for(path);
        let mut page = 1;
        let per_page = FILTER_PAGE_SIZE.clamp(1, 500);

        loop {
            if page > FILTER_PAGE_LIMIT {
                break;
            }
            self.limiter.hit().await;
            let query = vec![
                ("perPage".to_string(), per_page.to_string()),
                ("page".to_string(), page.to_string()),
            ];
            let response = self
                .http
                .get(base_url.clone())
                .query(&query)
                .send()
                .await?;
            let chunk: Vec<UserProfile> = Self::parse_json(response).await?;
            let count = chunk.len();
            if count == 0 {
                break;
            }
            results.extend(chunk);
            if count < per_page as usize {
                break;
            }
            page += 1;
        }

        Ok(results)
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

async fn parse_json_with_headers<T>(response: Response) -> Result<(HeaderMap, T)>
where
    T: DeserializeOwned,
{
    let status = response.status();
    let headers = response.headers().clone();
    if status.is_success() {
        let data = response.json::<T>().await.map_err(TrackerError::from)?;
        Ok((headers, data))
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

fn header_string(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|text| text.to_string())
}

#[derive(Clone, Copy, Debug)]
pub enum ScrollType {
    Sorted,
    Unsorted,
}

impl ScrollType {
    fn as_str(&self) -> &'static str {
        match self {
            ScrollType::Sorted => "sorted",
            ScrollType::Unsorted => "unsorted",
        }
    }
}

#[derive(Debug)]
pub struct ScrollPage<T> {
    pub items: Vec<T>,
    pub scroll_id: Option<String>,
    pub scroll_token: Option<String>,
    pub total_count: Option<u64>,
}

#[derive(Clone, Debug, Default)]
pub struct IssueSearchParams {
    pub query: Option<String>,
    pub filter: Option<JsonMap<String, Value>>,
}

impl IssueSearchParams {
    pub fn new(query: Option<String>, filter: Option<JsonMap<String, Value>>) -> Self {
        Self { query, filter }
    }
}

const ISSUE_SUMMARY_FIELDS: &str = "key,summary,description,status,priority,spent,timeSpent";

fn worklog_id_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

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
struct IssueSearchRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filter: Option<JsonMap<String, Value>>,
}

impl IssueSearchRequest {
    fn from_params(params: &IssueSearchParams) -> Self {
        let normalized_query = params
            .query
            .as_ref()
            .and_then(|q| {
                let trimmed = q.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            });

        Self {
            query: normalized_query,
            filter: params.filter.clone(),
        }
    }
}

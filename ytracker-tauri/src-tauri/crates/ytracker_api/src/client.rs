//! HTTP client wrapper for Yandex Tracker endpoints.

use crate::config::TrackerConfig;
use crate::error::{Result, TrackerError};
use crate::models::{
    AttachmentMetadata,
    ChecklistItem as TrackerChecklistItem,
    ChecklistItemCreate,
    ChecklistItemUpdate,
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
/// High-level Tracker API client with typed request/response helpers.
pub struct TrackerClient {
    http: HttpClient,
    config: TrackerConfig,
    limiter: RateLimiter,
}

const FILTER_PAGE_LIMIT: u32 = 10;
const FILTER_PAGE_SIZE: u32 = 200;

impl TrackerClient {
    /// Creates a client with HTTP transport and default per-config rate limiter.
    pub fn new(config: TrackerConfig) -> Result<Self> {
        let http = build_http_client(&config)?;
        let limiter = RateLimiter::new(config.cooldown);
        Ok(Self {
            http,
            config,
            limiter,
        })
    }

    /// Creates a client with externally provided limiter instance.
    pub fn new_with_limiter(config: TrackerConfig, limiter: RateLimiter) -> Result<Self> {
        let http = build_http_client(&config)?;
        Ok(Self {
            http,
            config,
            limiter,
        })
    }

    /// Returns immutable client configuration.
    pub fn config(&self) -> &TrackerConfig {
        &self.config
    }

    /// Returns shared request rate limiter.
    pub fn rate_limiter(&self) -> &RateLimiter {
        &self.limiter
    }

    /// Sends a typed GET request to relative API path.
    pub async fn get<T>(&self, path: &str) -> Result<T>
    where
        T: DeserializeOwned,
    {
        self.send_with_body(Method::GET, path, Option::<&Value>::None).await
    }

    /// Sends a typed GET request with query parameters.
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

    /// Sends a typed POST request with JSON body.
    pub async fn post<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        self.send_with_body(Method::POST, path, Some(body)).await
    }

    /// Sends a typed PATCH request with JSON body.
    pub async fn patch<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        self.send_with_body(Method::PATCH, path, Some(body)).await
    }

    /// Sends DELETE request expecting empty success body.
    pub async fn delete(&self, path: &str) -> Result<()> {
        self.send_expect_empty(Method::DELETE, path, None::<&Value>).await
    }

    /// Generic typed request helper for methods with optional JSON body.
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

    /// Generic request helper for commands expecting no response payload.
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

    /// Builds an API URL from relative Tracker endpoint path.
    fn url_for(&self, path: &str) -> String {
        let mut base = self.config.api_root();
        let trimmed = path.trim_start_matches('/');
        base.push_str(trimmed);
        base
    }

    /// Resolves relative or absolute href to a valid absolute URL.
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

    /// Parses successful JSON responses and maps auth/http failures.
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

    /// Validates empty-success responses and maps auth/http failures.
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

    /// Returns profile of the currently authenticated Tracker user.
    pub async fn get_myself(&self) -> Result<UserProfile> {
        self.get("myself").await
    }

    /// Loads a single issue with summary/detail fields used by desktop UI.
    pub async fn get_issue(&self, issue_key: &str) -> Result<TrackerIssue> {
        let path = format!("issues/{}", issue_key);
        self.get_with_query(&path, Some(&[("fields", ISSUE_SUMMARY_FIELDS)])).await
    }

    /// Performs issue search via POST endpoint with optional query/filter payload.
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

    /// Performs scroll-based issue search and returns next-scroll metadata from headers.
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

    /// Returns all comments for a specific issue.
    pub async fn get_issue_comments(&self, issue_key: &str) -> Result<Vec<TrackerComment>> {
        let path = format!("issues/{}/comments", issue_key);
        self.get(&path).await
    }

    /// Returns attachment metadata list for a specific issue.
    pub async fn get_issue_attachments(&self, issue_key: &str) -> Result<Vec<AttachmentMetadata>> {
        let path = format!("issues/{}/attachments", issue_key);
        self.get(&path).await
    }

    /// Returns global status directory entries.
    pub async fn get_statuses(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.get("statuses").await
    }

    /// Returns global resolution directory entries.
    pub async fn get_resolutions(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.get("resolutions").await
    }

    /// Adds a plain-text comment to an issue.
    pub async fn add_comment(&self, issue_key: &str, text: &str) -> Result<()> {
        let path = format!("issues/{}/comments", issue_key);
        let payload = CommentCreateRequest { text };
        self.send_expect_empty(Method::POST, &path, Some(&payload)).await
    }

    /// Updates mutable issue fields (currently summary and description).
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

    /// Returns available workflow transitions for an issue.
    pub async fn get_transitions(&self, issue_key: &str) -> Result<Vec<TrackerTransition>> {
        let path = format!("issues/{}/transitions", issue_key);
        self.get(&path).await
    }

    /// Executes a workflow transition with optional comment and resolution.
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

    /// Writes a worklog entry to issue history.
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

    /// Loads issue worklogs with cursor pagination and defensive upper bound.
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

    /// Searches worklogs by optional creator and created-at range constraints.
    pub async fn get_worklogs_by_params(
        &self,
        created_by: Option<&str>,
        created_from: Option<&str>,
        created_to: Option<&str>,
    ) -> Result<Vec<TrackerWorklogEntry>> {
        let created_by = created_by
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let created_from = created_from
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let created_to = created_to
            .map(str::trim)
            .filter(|value| !value.is_empty());

        let created_at = if created_from.is_some() || created_to.is_some() {
            Some(WorklogCreatedAtRange {
                from: created_from,
                to: created_to,
            })
        } else {
            None
        };

        let payload = WorklogSearchRequest {
            created_by,
            created_at,
        };

        self.post("worklog/_search", &payload).await
    }

    /// GET /v3/issues/<issue_key>/checklistItems — get checklist items.
    pub async fn get_checklist(
        &self,
        issue_key: &str,
    ) -> Result<Vec<TrackerChecklistItem>> {
        let path = format!("issues/{}/checklistItems", issue_key);
        self.get(&path).await
    }

    /// POST /v3/issues/<issue_key>/checklistItems — create checklist / add item.
    pub async fn add_checklist_item(
        &self,
        issue_key: &str,
        item: &ChecklistItemCreate,
    ) -> Result<Value> {
        let path = format!("issues/{}/checklistItems", issue_key);
        self.post(&path, item).await
    }

    /// PATCH /v3/issues/<issue_key>/checklistItems/<item_id> — edit a checklist item.
    pub async fn edit_checklist_item(
        &self,
        issue_key: &str,
        item_id: &str,
        update: &ChecklistItemUpdate,
    ) -> Result<Value> {
        let path = format!("issues/{}/checklistItems/{}", issue_key, item_id);
        self.patch(&path, update).await
    }

    /// DELETE /v3/issues/<issue_key>/checklistItems — delete entire checklist.
    pub async fn delete_checklist(&self, issue_key: &str) -> Result<()> {
        let path = format!("issues/{}/checklistItems", issue_key);
        self.delete(&path).await
    }

    /// DELETE /v3/issues/<issue_key>/checklistItems/<item_id> — delete single item.
    pub async fn delete_checklist_item(
        &self,
        issue_key: &str,
        item_id: &str,
    ) -> Result<()> {
        let path = format!("issues/{}/checklistItems/{}", issue_key, item_id);
        self.delete(&path).await
    }

    /// Clears backend scroll context for previously issued scroll search id.
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

    /// Downloads arbitrary binary resource referenced by absolute or relative URL.
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

    /// Returns full queues directory by traversing paged endpoint.
    pub async fn list_all_queues(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.fetch_simple_entity_pages("queues").await
    }

    /// Returns full projects directory by traversing paged endpoint.
    pub async fn list_all_projects(&self) -> Result<Vec<SimpleEntityRaw>> {
        self.fetch_simple_entity_pages("projects").await
    }

    /// Returns full users directory by traversing paged endpoint.
    pub async fn list_all_users(&self) -> Result<Vec<UserProfile>> {
        self.fetch_user_pages("users").await
    }

    /// Shared paginator for simple-entity directory endpoints.
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

    /// Shared paginator for user directory endpoint.
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

/// Builds reqwest client with Tracker-specific default headers and timeouts.
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

/// Converts string into HTTP header value with consistent error mapping.
fn header_value(value: String) -> Result<HeaderValue> {
    HeaderValue::from_str(&value).map_err(|err| TrackerError::Other(err.to_string()))
}

/// Builds structured HTTP error from status/body payload.
fn build_http_error(status: StatusCode, body: &str) -> TrackerError {
    let code = extract_error_code(body);
    TrackerError::http(status, code, body.to_string())
}

/// Attempts to extract API-specific error code from JSON response body.
fn extract_error_code(body: &str) -> Option<String> {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()))
}

/// Parses JSON body while preserving response headers for pagination metadata.
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

/// Reads header value as UTF-8 string.
fn header_string(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|text| text.to_string())
}

#[derive(Clone, Copy, Debug)]
/// Scroll API mode used by issue-search operations.
pub enum ScrollType {
    Sorted,
    Unsorted,
}

impl ScrollType {
    /// Returns API value for scroll mode query parameter.
    fn as_str(&self) -> &'static str {
        match self {
            ScrollType::Sorted => "sorted",
            ScrollType::Unsorted => "unsorted",
        }
    }
}

#[derive(Debug)]
/// Generic paged payload returned by scroll-enabled endpoints.
pub struct ScrollPage<T> {
    pub items: Vec<T>,
    pub scroll_id: Option<String>,
    pub scroll_token: Option<String>,
    pub total_count: Option<u64>,
}

#[derive(Clone, Debug, Default)]
/// Search parameters for issue listing with optional query/filter constraints.
pub struct IssueSearchParams {
    pub query: Option<String>,
    pub filter: Option<JsonMap<String, Value>>,
}

impl IssueSearchParams {
    /// Creates issue search params from optional query and filter map.
    pub fn new(query: Option<String>, filter: Option<JsonMap<String, Value>>) -> Self {
        Self { query, filter }
    }
}

const ISSUE_SUMMARY_FIELDS: &str = "key,summary,description,status,priority,spent,timeSpent";

/// Converts dynamic worklog id into normalized string representation.
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorklogSearchRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    created_by: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<WorklogCreatedAtRange<'a>>,
}

#[derive(Serialize)]
struct WorklogCreatedAtRange<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to: Option<&'a str>,
}

#[derive(Debug, Clone)]
/// Binary body and metadata returned for downloaded attachment resources.
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
    /// Creates normalized search request body from issue search parameters.
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

#[cfg(test)]
mod tests {
    use super::{
        build_http_error, extract_error_code, worklog_id_string, IssueSearchParams,
        IssueSearchRequest, ScrollType, TrackerClient,
    };
    use crate::config::{AuthMethod, OrgType, TrackerConfig};
    use crate::error::TrackerError;
    use mockito::{Matcher, Server};
    use reqwest::StatusCode;
    use serde_json::{json, Map as JsonMap, Value};

    fn test_client(base_url: &str) -> TrackerClient {
        let config = TrackerConfig::new("test-token", OrgType::Yandex360)
            .with_base_url(base_url)
            .with_api_version("v3")
            .with_org_id("org-123")
            .with_auth_method(AuthMethod::OAuth)
            .with_user_agent("ytracker-api-tests");

        TrackerClient::new(config).expect("client should be created")
    }

    #[test]
    fn worklog_id_string_normalizes_supported_values() {
        assert_eq!(worklog_id_string(&Value::String(" 42 ".to_string())), Some("42".to_string()));
        assert_eq!(worklog_id_string(&json!(101)), Some("101".to_string()));
        assert_eq!(worklog_id_string(&Value::String("   ".to_string())), None);
        assert_eq!(worklog_id_string(&Value::Bool(true)), None);
    }

    #[test]
    fn issue_search_request_trims_empty_query() {
        let mut filter = JsonMap::new();
        filter.insert("queue".to_string(), json!("YT"));
        let params = IssueSearchParams::new(Some("   ".to_string()), Some(filter.clone()));
        let payload = IssueSearchRequest::from_params(&params);

        assert!(payload.query.is_none());
        assert_eq!(payload.filter, Some(filter));
    }

    #[test]
    fn extract_error_code_reads_json_body_code_field() {
        let code = extract_error_code(r#"{"code":"QUEUE_NOT_FOUND","message":"no queue"}"#);
        assert_eq!(code.as_deref(), Some("QUEUE_NOT_FOUND"));
        assert!(extract_error_code("not-json").is_none());
    }

    #[test]
    fn build_http_error_includes_status_and_extracted_code() {
        let err = build_http_error(StatusCode::BAD_REQUEST, r#"{"code":"BAD_REQ"}"#);
        match err {
            TrackerError::Http { status, code, .. } => {
                assert_eq!(status, StatusCode::BAD_REQUEST);
                assert_eq!(code.as_deref(), Some("BAD_REQ"));
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[tokio::test]
    async fn get_with_query_sends_auth_and_org_headers() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("GET", "/v3/ping")
            .match_header("authorization", "OAuth test-token")
            .match_header("x-org-id", "org-123")
            .match_header("user-agent", "ytracker-api-tests")
            .with_status(200)
            .with_body("{}")
            .create_async()
            .await;

        let client = test_client(&server.url());
        let result: Value = client
            .get_with_query("ping", None)
            .await
            .expect("request should succeed");
        assert_eq!(result, json!({}));
    }

    #[tokio::test]
    async fn get_with_query_maps_unauthorized_to_authentication_error() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("GET", "/v3/protected")
            .with_status(401)
            .with_body("token invalid")
            .create_async()
            .await;

        let client = test_client(&server.url());
        let result: Result<Value, TrackerError> = client.get_with_query("protected", None).await;

        match result {
            Err(TrackerError::Authentication(message)) => {
                assert!(message.contains("Access denied"));
                assert!(message.contains("token invalid"));
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }

    #[tokio::test]
    async fn search_issues_scroll_reads_scroll_headers() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/v3/issues/_search")
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("fields".into(), "key,summary,description,status,priority,spent,timeSpent".into()),
                Matcher::UrlEncoded("scrollType".into(), "sorted".into()),
                Matcher::UrlEncoded("perScroll".into(), "50".into()),
                Matcher::UrlEncoded("scrollTTLMillis".into(), "1500".into()),
            ]))
            .with_status(200)
            .with_header("X-Scroll-Id", "sid-1")
            .with_header("X-Scroll-Token", "stok-9")
            .with_header("X-Total-Count", "77")
            .with_body("[]")
            .create_async()
            .await;

        let client = test_client(&server.url());
        let params = IssueSearchParams::default();
        let page = client
            .search_issues_scroll(&params, None, Some(50), ScrollType::Sorted, Some(1_500))
            .await
            .expect("scroll search should succeed");

        assert_eq!(page.scroll_id.as_deref(), Some("sid-1"));
        assert_eq!(page.scroll_token.as_deref(), Some("stok-9"));
        assert_eq!(page.total_count, Some(77));
        assert!(page.items.is_empty());
    }

    #[tokio::test]
    async fn fetch_binary_supports_relative_href_and_content_type() {
        let mut server = Server::new_async().await;
        let body = vec![1_u8, 2, 3, 4];
        let _mock = server
            .mock("GET", "/files/bin")
            .with_status(200)
            .with_header("content-type", "application/octet-stream")
            .with_body(body.clone())
            .create_async()
            .await;

        let client = test_client(&server.url());
        let content = client
            .fetch_binary("/files/bin")
            .await
            .expect("binary fetch should succeed");

        assert_eq!(content.bytes, body);
        assert_eq!(content.mime_type.as_deref(), Some("application/octet-stream"));
    }
}

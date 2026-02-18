use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, Duration, Local, NaiveTime, Utc};
use directories::UserDirs;
use log::{debug, info, warn};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use serde_json::{Map as JsonMap, Value};
use std::collections::HashSet;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, Runtime};
#[allow(unused_imports)]
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};
use tokio::{fs as async_fs, task, time::sleep};

mod config;
mod issue_store;
mod bridge;
mod secrets;
mod timer;
use config::{Config, ConfigManager};
use issue_store::IssueStore;
use secrets::{ClientCredentialsInfo, SecretsManager, SessionToken};
use timer::Timer;
use ytracker_api::models::CommentAuthor as NativeCommentAuthor;
use ytracker_api::rate_limiter::RateLimiter;
use ytracker_api::client::IssueSearchParams;
use ytracker_api::{
    auth, AttachmentMetadata as NativeAttachment, Comment as NativeComment,
    ChecklistItem as NativeChecklistItem, ChecklistItemCreate, ChecklistItemUpdate,
    ChecklistDeadlineInput,
    Issue as NativeIssue,
    IssueFieldRef as NativeIssueFieldRef, OrgType, ScrollType, SimpleEntityRaw as NativeSimpleEntity,
    TrackerClient, TrackerConfig, Transition as NativeTransition, UserProfile as NativeUserProfile,
    WorklogEntry as NativeWorklogEntry,
};

static DURATION_TOKEN_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\d+)\s*(w|d|h|m)").expect("invalid duration regex"));
const DEFAULT_ISSUE_QUERY: &str = "Assignee: me() Resolution: empty()";
const TRAY_ID: &str = "YTracker";
const MENU_STOP_ID: &str = "tray_stop_timer";
const MENU_REFRESH_ID: &str = "tray_refresh";
const MENU_RUNNING_LABEL_ID: &str = "tray_running_label";
const MENU_IDLE_LABEL_ID: &str = "tray_idle_label";
const MENU_NO_ISSUES_ID: &str = "tray_no_issues";
const MENU_MORE_ISSUES_ID: &str = "tray_more_issues";
const MENU_START_SUBMENU_ID: &str = "tray_start_submenu";
const ISSUE_MENU_PREFIX: &str = "tray_issue::";
const MAX_TRAY_ISSUES: usize = 12;
const ISSUE_REFRESH_INTERVAL_SECS: u64 = 300;
const ISSUE_SCROLL_PER_PAGE: u32 = 100;
const ISSUE_SCROLL_TTL_MILLIS: u64 = 60_000;
const WORKDAY_MOTIVATION_PHRASES: [&str; 8] = [
    "Small progress is still progress — you've got this.",
    "A little more focus now will make tomorrow easier.",
    "Keep going — your effort today matters.",
    "One steady push and you'll close the day strong.",
    "You're building momentum — stay with it.",
    "Every tracked minute moves you forward.",
    "Finish with confidence — you can do it.",
    "Your future self will thank you for this final stretch.",
];

fn default_filter_map() -> JsonMap<String, Value> {
    let mut map = JsonMap::new();
    map.insert("assignee".to_string(), Value::String("me()".to_string()));
    map.insert(
        "resolution".to_string(),
        Value::String("empty()".to_string()),
    );
    map
}

#[derive(Debug, Serialize)]
struct UpdateAvailablePayload {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    automatic: bool,
}

#[derive(Debug, Serialize)]
struct TimerStoppedPayload {
    issue_key: String,
    elapsed: u64,
}

#[derive(Debug, Serialize, Clone)]
struct IssuePagePayload {
    issues: Vec<bridge::Issue>,
    next_scroll_id: Option<String>,
    total_count: Option<u64>,
    has_more: bool,
}

fn format_elapsed(elapsed: u64) -> String {
    let hours = elapsed / 3600;
    let minutes = (elapsed % 3600) / 60;
    if hours > 0 {
        format!("{}h {:02}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}

fn parse_workday_time(value: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(value.trim(), "%H:%M").ok()
}

fn current_local_day_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn parse_tracker_datetime(value: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Local))
        .or_else(|| {
            DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f%z")
                .ok()
                .map(|dt| dt.with_timezone(&Local))
        })
}

fn motivational_phrase() -> &'static str {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos() as usize)
        .unwrap_or(0);
    let index = nanos % WORKDAY_MOTIVATION_PHRASES.len();
    WORKDAY_MOTIVATION_PHRASES[index]
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_text(value: &str, limit: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    if limit <= 1 {
        return "…".to_string();
    }
    let mut truncated: String = trimmed.chars().take(limit - 1).collect();
    truncated.push('…');
    truncated
}

fn redact_log_details(value: &str) -> String {
    let collapsed = collapse_whitespace(value);
    let category = collapsed
        .split(':')
        .next()
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .unwrap_or("error");
    let lowered = collapsed.to_lowercase();
    let has_sensitive_hint = [
        "token",
        "authorization",
        "bearer",
        "oauth",
        "client_secret",
        "password",
        "code=",
        "set-cookie",
    ]
    .iter()
    .any(|hint| lowered.contains(hint));

    if has_sensitive_hint {
        return format!(
            "{}: <redacted-sensitive-details>",
            truncate_text(category, 64)
        );
    }

    truncate_text(&collapsed, 180)
}

fn format_issue_label(issue: &bridge::Issue) -> String {
    let summary = collapse_whitespace(&issue.summary);
    if summary.is_empty() {
        issue.key.clone()
    } else {
        format!("{}: {}", issue.key, truncate_text(&summary, 60))
    }
}

fn format_running_label(state: &timer::TimerState) -> String {
    let key = state.issue_key.as_deref().unwrap_or("Timer");
    let summary = state
        .issue_summary
        .as_deref()
        .map(|s| truncate_text(&collapse_whitespace(s), 50))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Timer running".to_string());
    format!(
        "Running: {} — {} ({})",
        key,
        summary,
        format_elapsed(state.elapsed)
    )
}

fn issue_menu_id(issue_key: &str) -> String {
    format!("{}{}", ISSUE_MENU_PREFIX, issue_key)
}

fn notify_timer_started(app: &tauri::AppHandle, issue_key: &str, summary: Option<&str>) {
    let title = format!("Timer started: {}", issue_key);
    let body = summary
        .map(|s| truncate_text(&collapse_whitespace(s), 80))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Tracking time from tray".to_string());

    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        warn!("Failed to show start notification: {}", err);
    }
}

fn notify_timer_stopped(app: &tauri::AppHandle, issue_key: &str, elapsed: u64) {
    let title = format!("Timer stopped: {}", issue_key);
    let body = format!("Tracked {}", format_elapsed(elapsed));

    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        warn!("Failed to show stop notification: {}", err);
    }
}

fn emit_timer_stopped_event(app: &tauri::AppHandle, issue_key: &str, elapsed: u64) {
    let payload = TimerStoppedPayload {
        issue_key: issue_key.to_string(),
        elapsed,
    };

    if let Err(err) = app.emit("timer-stopped", &payload) {
        warn!("Failed to emit timer-stopped event: {}", err);
    }
}

fn broadcast_timer_state(app: &tauri::AppHandle, timer: &Arc<Timer>, issue_store: &IssueStore) {
    let snapshot = timer.get_state();
    if let Err(err) = app.emit("timer-tick", &snapshot) {
        warn!("Failed to emit timer tick: {}", err);
    }
    if let Err(err) = update_tray_menu(app, &issue_store.snapshot(), &snapshot) {
        warn!("Failed to update tray state: {}", err);
    }
}

async fn refresh_issue_cache(
    app: tauri::AppHandle,
    issue_store: IssueStore,
    timer: Arc<Timer>,
    query: Option<String>,
) -> Result<Vec<bridge::Issue>, String> {
    debug!("Refreshing issue cache");
    let params = if let Some(q) = query {
        IssueSearchParams::new(Some(q), None)
    } else {
        IssueSearchParams::new(None, Some(default_filter_map()))
    };
    let issues = match fetch_issues_native(&app, &params).await {
        Ok(issues) => {
            debug!("Issue cache refreshed");
            issues
        }
        Err(e) => {
            warn!("Failed to refresh issue cache");
            debug!("Issue cache refresh details: {}", redact_log_details(&e));
            return Err(e);
        }
    };
    issue_store.set(issues.clone());
    let state = timer.get_state();
    if let Err(err) = update_tray_menu(&app, &issues, &state) {
        warn!("Failed to update tray state: {}", err);
    }
    Ok(issues)
}

fn build_tray_menu<R: Runtime>(
    app: &tauri::AppHandle<R>,
    issues: &[bridge::Issue],
    timer_state: &timer::TimerState,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    if timer_state.active {
        let running_item = MenuItem::with_id(
            app,
            MENU_RUNNING_LABEL_ID,
            format_running_label(timer_state),
            false,
            None::<&str>,
        )?;
        menu.append(&running_item)?;

        let stop_item = MenuItem::with_id(app, MENU_STOP_ID, "Stop Timer", true, None::<&str>)?;
        menu.append(&stop_item)?;
    } else {
        let idle_item =
            MenuItem::with_id(app, MENU_IDLE_LABEL_ID, "Timer idle", false, None::<&str>)?;
        menu.append(&idle_item)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if issues.is_empty() {
        let placeholder = MenuItem::with_id(
            app,
            MENU_NO_ISSUES_ID,
            "No issues found",
            false,
            None::<&str>,
        )?;
        menu.append(&placeholder)?;
    } else {
        let start_submenu = Submenu::with_id(app, MENU_START_SUBMENU_ID, "Start Timer", true)?;

        for issue in issues.iter().take(MAX_TRAY_ISSUES) {
            let enabled = timer_state.issue_key.as_deref() != Some(&issue.key);
            let entry = MenuItem::with_id(
                app,
                issue_menu_id(&issue.key),
                format_issue_label(issue),
                enabled,
                None::<&str>,
            )?;
            start_submenu.append(&entry)?;
        }

        if issues.len() > MAX_TRAY_ISSUES {
            let extra_count = issues.len() - MAX_TRAY_ISSUES;
            let extra = MenuItem::with_id(
                app,
                MENU_MORE_ISSUES_ID,
                format!("+{} more issues…", extra_count),
                false,
                None::<&str>,
            )?;
            start_submenu.append(&extra)?;
        }

        menu.append(&start_submenu)?;
    }

    let refresh_item =
        MenuItem::with_id(app, MENU_REFRESH_ID, "Refresh Issues", true, None::<&str>)?;
    menu.append(&refresh_item)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    menu.append(&show_item)?;
    menu.append(&quit_item)?;

    Ok(menu)
}

fn update_tray_menu<R: Runtime>(
    app: &tauri::AppHandle<R>,
    issues: &[bridge::Issue],
    timer_state: &timer::TimerState,
) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_tray_menu(app, issues, timer_state)?;
        tray.set_menu(Some(menu))?;

        let title = if timer_state.active {
            let key = timer_state.issue_key.as_deref().unwrap_or("Timer");
            format!("YT: {} ({})", key, format_elapsed(timer_state.elapsed))
        } else {
            "YTracker".to_string()
        };

        if let Err(err) = tray.set_title(Some(&title)) {
            debug!("Failed to set tray title: {}", err);
        }
    }

    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn log_work(
    issue_key: String,
    duration: String,
    comment: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    log_work_native(secrets_clone, &issue_key, &duration, &comment).await
}

#[tauri::command]
async fn get_current_user(
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<bridge::UserProfile, String> {
    get_current_user_native(&secrets).await
}

#[tauri::command]
async fn logout(
    app: tauri::AppHandle,
    secrets: tauri::State<'_, SecretsManager>,
    issue_store: tauri::State<'_, IssueStore>,
    timer: tauri::State<'_, Arc<Timer>>,
) -> Result<(), String> {
    secrets
        .clear_session()
        .map_err(|err| format!("Failed to clear session: {}", err))?;

    let _ = timer.stop();
    issue_store.set(Vec::new());
    broadcast_timer_state(&app, &timer, issue_store.inner());

    Ok(())
}

async fn get_current_user_native(secrets: &SecretsManager) -> Result<bridge::UserProfile, String> {
    let client = build_tracker_client(secrets)?;
    let profile = client.get_myself().await.map_err(|err| err.to_string())?;
    Ok(convert_user_profile(profile))
}

fn convert_user_profile(profile: NativeUserProfile) -> bridge::UserProfile {
    let avatar_url = profile.avatar();
    bridge::UserProfile {
        display: profile.display,
        login: profile.login,
        email: profile.email,
        avatar_url,
    }
}

fn canonical_org_type(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "cloud" => "cloud".to_string(),
        _ => "yandex360".to_string(),
    }
}

fn parse_org_type(value: &str) -> OrgType {
    match value.trim().to_lowercase().as_str() {
        "cloud" => OrgType::Cloud,
        _ => OrgType::Yandex360,
    }
}

fn build_tracker_client(secrets: &SecretsManager) -> Result<TrackerClient, String> {
    let session = secrets
        .get_session()
        .map_err(|e| format!("Failed to load stored token: {}", e))?
        .ok_or_else(|| "Not authenticated. Sign in again to continue.".to_string())?;
    tracker_client_from_session(&session, secrets.get_rate_limiter())
}

fn tracker_client_from_session(
    session: &SessionToken,
    limiter: RateLimiter,
) -> Result<TrackerClient, String> {
    let org_type = parse_org_type(&session.org_type);
    let mut config = TrackerConfig::new(session.token.clone(), org_type);
    if let Some(org_id) = &session.org_id {
        config = config.with_org_id(org_id.clone());
    }
    TrackerClient::new_with_limiter(config, limiter).map_err(|err| err.to_string())
}

fn secrets_from_app(app: &tauri::AppHandle) -> Result<SecretsManager, String> {
    app.try_state::<SecretsManager>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "Secrets manager is not initialized".to_string())
}

async fn has_session_from_app(app: &tauri::AppHandle) -> Result<bool, String> {
    let manager = secrets_from_app(app)?;
    let has_session = task::spawn_blocking(move || manager.get_session())
        .await
        .map_err(|err| format!("Failed to check session: {}", err))??
        .is_some();
    Ok(has_session)
}

fn convert_issues_native(issues: Vec<NativeIssue>) -> Vec<bridge::Issue> {
    let config = ConfigManager::new().load();
    let workday_hours = sanitize_workday_hours(config.workday_hours);
    issues
        .into_iter()
        .map(|issue| convert_issue_native(issue, workday_hours))
        .collect()
}

fn convert_issue_native(issue: NativeIssue, workday_hours: u64) -> bridge::Issue {
    let (status_key, status_display) = coerce_field_ref(issue.status.as_ref());
    let (priority_key, priority_display) = coerce_field_ref(issue.priority.as_ref());

    bridge::Issue {
        key: issue.key,
        summary: issue.summary.unwrap_or_default(),
        description: issue.description.unwrap_or_default(),
        status: bridge::Status {
            key: status_key,
            display: status_display,
        },
        priority: bridge::Priority {
            key: priority_key,
            display: priority_display,
        },
        tracked_seconds: issue
            .spent
            .as_ref()
            .and_then(|value| parse_duration_value_to_seconds(value, workday_hours))
            .or_else(|| {
                issue
                    .time_spent
                    .as_ref()
                    .and_then(|value| parse_duration_value_to_seconds(value, workday_hours))
            }),
    }
}

fn coerce_field_ref(field: Option<&NativeIssueFieldRef>) -> (String, String) {
    let default_key = "unknown".to_string();
    let default_display = "Unknown".to_string();

    field
        .and_then(|value| {
            let key = value.key().filter(|text| !text.trim().is_empty());
            let label = value
                .display_value()
                .as_ref()
                .and_then(coerce_display_value);
            match (key, label) {
                (Some(key), Some(label)) => Some((key, label)),
                (Some(key), None) => Some((key.clone(), key)),
                (None, Some(label)) => Some((label.clone(), label)),
                _ => None,
            }
        })
        .unwrap_or_else(|| (default_key, default_display))
}

async fn fetch_issues_native(
    app: &tauri::AppHandle,
    params: &IssueSearchParams,
) -> Result<Vec<bridge::Issue>, String> {
    let secrets = secrets_from_app(app)?;
    let client = build_tracker_client(&secrets)?;
    let mut resolved_params = params.clone();
    resolve_filter_shortcuts(&mut resolved_params, &client).await?;
    let response = client
        .search_issues(&resolved_params, None)
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_issues_native(response))
}

async fn fetch_issue_page_native(
    app: &tauri::AppHandle,
    params: &IssueSearchParams,
    scroll_id: Option<&str>,
) -> Result<IssuePagePayload, String> {
    let secrets = secrets_from_app(app)?;
    let client = build_tracker_client(&secrets)?;
    let mut resolved_params = params.clone();
    resolve_filter_shortcuts(&mut resolved_params, &client).await?;
    let response = client
        .search_issues_scroll(
            &resolved_params,
            scroll_id,
            Some(ISSUE_SCROLL_PER_PAGE),
            ScrollType::Sorted,
            Some(ISSUE_SCROLL_TTL_MILLIS),
        )
        .await
        .map_err(|err| err.to_string())?;

    let issues = convert_issues_native(response.items);
    let next_scroll_id = response.scroll_id;
    let has_more = next_scroll_id.is_some();

    Ok(IssuePagePayload {
        issues,
        next_scroll_id,
        total_count: response.total_count,
        has_more,
    })
}

async fn fetch_comments_native(
    secrets: SecretsManager,
    issue_key: &str,
) -> Result<Vec<bridge::Comment>, String> {
    let client = build_tracker_client(&secrets)?;
    let comments = client
        .get_issue_comments(issue_key)
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_comments_native(comments))
}

async fn fetch_attachments_native(
    secrets: SecretsManager,
    issue_key: &str,
) -> Result<Vec<bridge::Attachment>, String> {
    let client = build_tracker_client(&secrets)?;
    let attachments = client
        .get_issue_attachments(issue_key)
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_attachments_native(attachments))
}

async fn fetch_issue_detail_native(
    secrets: SecretsManager,
    issue_key: &str,
) -> Result<bridge::Issue, String> {
    let client = build_tracker_client(&secrets)?;
    let issue = client
        .get_issue(issue_key)
        .await
        .map_err(|err| err.to_string())?;
    let config = ConfigManager::new().load();
    let workday_hours = sanitize_workday_hours(config.workday_hours);
    Ok(convert_issue_native(issue, workday_hours))
}

async fn fetch_worklogs_native(
    secrets: SecretsManager,
    issue_key: &str,
) -> Result<Vec<bridge::WorklogEntry>, String> {
    let client = build_tracker_client(&secrets)?;
    let entries = client
        .get_issue_worklogs(issue_key)
        .await
        .map_err(|err| err.to_string())?;
    let config = ConfigManager::new().load();
    let workday_hours = sanitize_workday_hours(config.workday_hours);
    Ok(convert_worklogs_native(entries, workday_hours))
}

// ─── Checklist helpers ───────────────────────────────────────────────

fn checklist_item_id_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.trim().to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

fn convert_checklist_items_native(items: Vec<NativeChecklistItem>) -> Vec<bridge::ChecklistItem> {
    items
        .into_iter()
        .map(|item| bridge::ChecklistItem {
            id: checklist_item_id_string(&item.id),
            text: item.text.unwrap_or_default(),
            checked: item.checked.unwrap_or(false),
            assignee: item
                .assignee
                .as_ref()
                .and_then(|a| a.display.clone().or_else(|| a.login.clone())),
            deadline: item.deadline.as_ref().and_then(|d| d.date.clone()),
            deadline_type: item.deadline.as_ref().and_then(|d| d.deadline_type.clone()),
            is_exceeded: item.deadline.as_ref().and_then(|d| d.is_exceeded),
            item_type: item.checklist_item_type,
        })
        .collect()
}

async fn fetch_checklist_native(
    secrets: SecretsManager,
    issue_key: &str,
) -> Result<Vec<bridge::ChecklistItem>, String> {
    let client = build_tracker_client(&secrets)?;
    let items = client
        .get_checklist(issue_key)
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_checklist_items_native(items))
}

async fn add_checklist_item_native(
    secrets: SecretsManager,
    issue_key: &str,
    payload: bridge::ChecklistItemCreatePayload,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    let deadline = payload.deadline.as_ref().map(|date| ChecklistDeadlineInput {
        date: date.clone(),
        deadline_type: payload.deadline_type.clone(),
    });
    let create = ChecklistItemCreate {
        text: payload.text,
        checked: payload.checked,
        assignee: payload.assignee,
        deadline,
    };
    client
        .add_checklist_item(issue_key, &create)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

async fn edit_checklist_item_native(
    secrets: SecretsManager,
    issue_key: &str,
    item_id: &str,
    payload: bridge::ChecklistItemUpdatePayload,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    let deadline = payload.deadline.as_ref().map(|date| ChecklistDeadlineInput {
        date: date.clone(),
        deadline_type: payload.deadline_type.clone(),
    });
    let update = ChecklistItemUpdate {
        text: payload.text,
        checked: payload.checked,
        assignee: payload.assignee,
        deadline,
    };
    client
        .edit_checklist_item(issue_key, item_id, &update)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

async fn delete_checklist_native(
    secrets: SecretsManager,
    issue_key: &str,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    client
        .delete_checklist(issue_key)
        .await
        .map_err(|err| err.to_string())
}

async fn delete_checklist_item_native(
    secrets: SecretsManager,
    issue_key: &str,
    item_id: &str,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    client
        .delete_checklist_item(issue_key, item_id)
        .await
        .map_err(|err| err.to_string())
}

async fn fetch_today_logged_seconds_for_issues(
    app: &tauri::AppHandle,
    issues: &[bridge::Issue],
    workday_hours: u64,
) -> Result<u64, String> {
    let issue_keys: Vec<String> = issues.iter().map(|issue| issue.key.clone()).collect();
    fetch_today_logged_seconds_for_issue_keys(app, &issue_keys, workday_hours).await
}

async fn fetch_today_logged_seconds_for_issue_keys(
    app: &tauri::AppHandle,
    issue_keys: &[String],
    workday_hours: u64,
) -> Result<u64, String> {
    let secrets = secrets_from_app(app)?;
    let client = build_tracker_client(&secrets)?;
    let today_key = current_local_day_key();
    let now_local = Local::now();
    let start_of_today = now_local
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| naive.and_local_timezone(Local).single())
        .ok_or_else(|| "Failed to resolve local day start".to_string())?;
    let start_of_tomorrow = start_of_today + Duration::days(1);
    let created_from = start_of_today.to_rfc3339();
    let created_to = start_of_tomorrow.to_rfc3339();

    let mut current_login: Option<String> = None;
    let created_by = ensure_current_login(&client, &mut current_login).await.ok();

    let entries = client
        .get_worklogs_by_params(
            created_by.as_deref(),
            Some(&created_from),
            Some(&created_to),
        )
        .await
        .map_err(|err| err.to_string())?;

    let mut unique_keys: HashSet<String> = HashSet::new();
    for key in issue_keys {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            continue;
        }
        unique_keys.insert(trimmed.to_string());
    }

    let mut total = 0u64;

    for entry in entries {
        if !unique_keys.is_empty() {
            let issue_key = entry.issue.as_ref().and_then(|issue| issue.key.clone());
            let Some(issue_key) = issue_key else {
                continue;
            };
            if !unique_keys.contains(issue_key.trim()) {
                continue;
            }
        }

        let date_value = entry
            .start
            .as_deref()
            .or(entry.created_at.as_deref())
            .unwrap_or("");

        let is_today = parse_tracker_datetime(date_value)
            .map(|date| date.format("%Y-%m-%d").to_string() == today_key)
            .unwrap_or(false);

        if !is_today {
            continue;
        }

        let seconds = entry
            .duration
            .as_deref()
            .and_then(|value| parse_tracker_duration_to_seconds(value, workday_hours))
            .unwrap_or(0);
        total = total.saturating_add(seconds);
    }

    Ok(total)
}

#[tauri::command]
async fn get_today_logged_seconds_for_issues(
    app: tauri::AppHandle,
    issue_keys: Vec<String>,
) -> Result<u64, String> {
    if issue_keys.is_empty() {
        return Ok(0);
    }

    let config = ConfigManager::new().load();
    let workday_hours = sanitize_workday_hours(config.workday_hours);
    fetch_today_logged_seconds_for_issue_keys(&app, &issue_keys, workday_hours).await
}

async fn fetch_statuses_native(
    secrets: SecretsManager,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let client = build_tracker_client(&secrets)?;
    let statuses = client.get_statuses().await.map_err(|err| err.to_string())?;
    Ok(convert_simple_entities_native(statuses))
}

async fn fetch_resolutions_native(
    secrets: SecretsManager,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let client = build_tracker_client(&secrets)?;
    let resolutions = client
        .get_resolutions()
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_simple_entities_native(resolutions))
}

async fn fetch_queues_native(
    secrets: SecretsManager,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let client = build_tracker_client(&secrets)?;
    let queues = client
        .list_all_queues()
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_simple_entities_native(queues))
}

async fn fetch_projects_native(
    secrets: SecretsManager,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let client = build_tracker_client(&secrets)?;
    let projects = client
        .list_all_projects()
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_project_entities_native(projects))
}

async fn fetch_users_native(
    secrets: SecretsManager,
) -> Result<Vec<bridge::UserProfile>, String> {
    let client = build_tracker_client(&secrets)?;
    let users = client
        .list_all_users()
        .await
        .map_err(|err| err.to_string())?;
    Ok(users.into_iter().map(convert_user_profile).collect())
}

async fn release_scroll_context_native(
    app: &tauri::AppHandle,
    scroll_id: &str,
) -> Result<(), String> {
    if scroll_id.trim().is_empty() {
        return Ok(());
    }
    let secrets = secrets_from_app(app)?;
    let client = build_tracker_client(&secrets)?;
    client
        .clear_scroll_context(scroll_id)
        .await
        .map_err(|err| err.to_string())
}

fn convert_comments_native(comments: Vec<NativeComment>) -> Vec<bridge::Comment> {
    comments
        .into_iter()
        .map(|comment| bridge::Comment {
            id: coerce_display_value(&comment.id).unwrap_or_default(),
            text: comment.text.unwrap_or_default(),
            author: coerce_comment_author(&comment.created_by),
            created_at: comment.created_at.unwrap_or_default(),
        })
        .collect()
}

fn convert_attachments_native(attachments: Vec<NativeAttachment>) -> Vec<bridge::Attachment> {
    attachments
        .into_iter()
        .map(|attachment| bridge::Attachment {
            id: coerce_display_value(&attachment.id).unwrap_or_default(),
            name: attachment
                .name
                .as_ref()
                .and_then(coerce_display_value)
                .unwrap_or_else(|| "Attachment".to_string()),
            url: attachment.content.unwrap_or_default(),
            mime_type: attachment.mime_type.or(attachment.mimetype),
        })
        .collect()
}

async fn find_attachment_metadata(
    client: &TrackerClient,
    issue_key: &str,
    attachment_id: &str,
) -> Result<NativeAttachment, String> {
    let attachments = client
        .get_issue_attachments(issue_key)
        .await
        .map_err(|err| err.to_string())?;
    attachments
        .into_iter()
        .find(|attachment| coerce_display_value(&attachment.id).as_deref() == Some(attachment_id))
        .ok_or_else(|| {
            format!(
                "Attachment {} not found on issue {}",
                attachment_id, issue_key
            )
        })
}

fn attachment_download_url(attachment: &NativeAttachment) -> Result<String, String> {
    attachment
        .content
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Attachment is missing download URL".to_string())
}

fn attachment_mime_type(attachment: &NativeAttachment, response_mime: Option<String>) -> String {
    response_mime
        .or_else(|| attachment.mime_type.clone())
        .or_else(|| attachment.mimetype.clone())
        .unwrap_or_else(|| "application/octet-stream".to_string())
}

fn resolve_download_destination(dest_path: &str) -> Result<PathBuf, String> {
    let trimmed = dest_path.trim();
    if trimmed.is_empty() {
        return Err("Destination path cannot be empty".to_string());
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        return Ok(PathBuf::from(trimmed));
    }

    if let Some(mut dir) =
        UserDirs::new().and_then(|dirs| dirs.download_dir().map(|p| p.to_path_buf()))
    {
        dir.push(trimmed);
        return Ok(dir);
    }

    env::current_dir()
        .map_err(|err| err.to_string())
        .map(|mut cwd| {
            cwd.push(trimmed);
            cwd
        })
}

async fn download_attachment_native(
    secrets: SecretsManager,
    issue_key: &str,
    attachment_id: &str,
    dest_path: &str,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    let attachment = find_attachment_metadata(&client, issue_key, attachment_id).await?;
    let url = attachment_download_url(&attachment)?;
    let binary = client
        .fetch_binary(&url)
        .await
        .map_err(|err| err.to_string())?;
    let resolved_path = resolve_download_destination(dest_path)?;

    if let Some(parent) = resolved_path.parent() {
        if !parent.as_os_str().is_empty() {
            async_fs::create_dir_all(parent)
                .await
                .map_err(|err| err.to_string())?;
        }
    }

    async_fs::write(&resolved_path, &binary.bytes)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

async fn preview_attachment_native(
    secrets: SecretsManager,
    issue_key: &str,
    attachment_id: &str,
) -> Result<bridge::AttachmentPreview, String> {
    let client = build_tracker_client(&secrets)?;
    let attachment = find_attachment_metadata(&client, issue_key, attachment_id).await?;
    let url = attachment_download_url(&attachment)?;
    let binary = client
        .fetch_binary(&url)
        .await
        .map_err(|err| err.to_string())?;
    let mime_type = attachment_mime_type(&attachment, binary.mime_type.clone());
    let data_base64 = BASE64_STANDARD.encode(&binary.bytes);
    Ok(bridge::AttachmentPreview {
        mime_type,
        data_base64,
    })
}

async fn preview_inline_resource_native(
    secrets: SecretsManager,
    resource_path: &str,
) -> Result<bridge::AttachmentPreview, String> {
    if resource_path.trim().is_empty() {
        return Err("Resource path is empty".to_string());
    }
    let client = build_tracker_client(&secrets)?;
    let binary = client
        .fetch_binary(resource_path)
        .await
        .map_err(|err| err.to_string())?;
    let mime_type = binary
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let data_base64 = BASE64_STANDARD.encode(&binary.bytes);
    Ok(bridge::AttachmentPreview {
        mime_type,
        data_base64,
    })
}

async fn add_comment_native(
    secrets: SecretsManager,
    issue_key: &str,
    text: &str,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Comment text cannot be empty".to_string());
    }
    let client = build_tracker_client(&secrets)?;
    client
        .add_comment(issue_key, text)
        .await
        .map_err(|err| err.to_string())
}

async fn update_issue_native(
    secrets: SecretsManager,
    issue_key: &str,
    summary: Option<&str>,
    description: Option<&str>,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    client
        .update_issue_fields(issue_key, summary, description)
        .await
        .map_err(|err| err.to_string())
}

async fn fetch_transitions_native(
    secrets: SecretsManager,
    issue_key: &str,
) -> Result<Vec<bridge::Transition>, String> {
    let client = build_tracker_client(&secrets)?;
    let transitions = client
        .get_transitions(issue_key)
        .await
        .map_err(|err| err.to_string())?;
    Ok(convert_transitions_native(transitions))
}

async fn execute_transition_native(
    secrets: SecretsManager,
    issue_key: &str,
    transition_id: &str,
    comment: Option<&str>,
    resolution: Option<&str>,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    client
        .execute_transition(issue_key, transition_id, comment, resolution)
        .await
        .map_err(|err| err.to_string())
}

async fn log_work_native(
    secrets: SecretsManager,
    issue_key: &str,
    duration: &str,
    comment: &str,
) -> Result<(), String> {
    let client = build_tracker_client(&secrets)?;
    let duration_iso = parse_duration_to_iso(duration)?;
    let start = current_timestamp_iso();
    let trimmed_comment = comment.trim();
    let comment_ref = if trimmed_comment.is_empty() {
        None
    } else {
        Some(trimmed_comment)
    };
    client
        .log_work_entry(issue_key, &start, &duration_iso, comment_ref)
        .await
        .map_err(|err| err.to_string())
}

fn current_timestamp_iso() -> String {
    Utc::now().to_rfc3339()
}

fn parse_duration_to_iso(input: &str) -> Result<String, String> {
    let normalized = input.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Duration cannot be empty".to_string());
    }

    let mut weeks = 0u64;
    let mut days = 0u64;
    let mut hours = 0u64;
    let mut minutes = 0u64;

    for capture in DURATION_TOKEN_REGEX.captures_iter(&normalized) {
        let value = capture[1]
            .parse::<u64>()
            .map_err(|_| "Invalid duration value".to_string())?;
        match &capture[2] {
            "w" => weeks += value,
            "d" => days += value,
            "h" => hours += value,
            "m" => minutes += value,
            _ => {}
        }
    }

    if weeks == 0 && days == 0 && hours == 0 && minutes == 0 {
        if let Ok(value) = normalized.parse::<u64>() {
            minutes = value;
        } else if let Ok(value) = normalized.parse::<f64>() {
            let whole_hours = value.trunc();
            let fractional = value - whole_hours;
            hours = whole_hours as u64;
            let fractional_minutes = (fractional * 60.0).round();
            if fractional_minutes > 0.0 {
                minutes = fractional_minutes as u64;
            }
        }
    }

    if weeks == 0 && days == 0 && hours == 0 && minutes == 0 {
        return Err("Duration resolves to zero".to_string());
    }

    let mut iso = String::from("P");
    if weeks > 0 {
        iso.push_str(&format!("{}W", weeks));
    }
    if days > 0 {
        iso.push_str(&format!("{}D", days));
    }
    if hours > 0 || minutes > 0 {
        iso.push('T');
        if hours > 0 {
            iso.push_str(&format!("{}H", hours));
        }
        if minutes > 0 {
            iso.push_str(&format!("{}M", minutes));
        }
    }

    if iso == "P" {
        iso.push_str("T0M");
    }

    Ok(iso)
}

fn convert_simple_entities_native(entities: Vec<NativeSimpleEntity>) -> Vec<bridge::SimpleEntity> {
    entities
        .into_iter()
        .map(convert_simple_entity_native)
        .collect()
}

fn convert_project_entities_native(entities: Vec<NativeSimpleEntity>) -> Vec<bridge::SimpleEntity> {
    entities
        .into_iter()
        .map(convert_project_entity_native)
        .collect()
}

fn convert_simple_entity_native(entity: NativeSimpleEntity) -> bridge::SimpleEntity {
    let key = entity
        .key
        .or(entity.id)
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    let display = entity
        .display
        .as_ref()
        .and_then(coerce_display_value)
        .or_else(|| entity.name.as_ref().and_then(coerce_display_value))
        .unwrap_or_else(|| key.clone());

    bridge::SimpleEntity { key, display }
}

fn convert_project_entity_native(mut entity: NativeSimpleEntity) -> bridge::SimpleEntity {
    let key = entity
        .id
        .take()
        .or_else(|| entity.key.take())
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    let display = entity
        .display
        .as_ref()
        .and_then(coerce_display_value)
        .or_else(|| entity.name.as_ref().and_then(coerce_display_value))
        .unwrap_or_else(|| key.clone());

    bridge::SimpleEntity { key, display }
}

fn coerce_display_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Object(map) => {
            for key in ["display", "name", "value", "en", "ru"] {
                if let Some(candidate) = map.get(key) {
                    if let Some(text) = coerce_display_value(candidate) {
                        return Some(text);
                    }
                }
            }
            map.values().find_map(coerce_display_value)
        }
        Value::Array(items) => items.iter().find_map(coerce_display_value),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Null => None,
    }
}

fn coerce_comment_author(author: &Option<NativeCommentAuthor>) -> String {
    author
        .as_ref()
        .and_then(|user| {
            user.display
                .as_ref()
                .and_then(coerce_display_value)
                .or_else(|| user.login.clone())
                .or_else(|| user.email.clone())
        })
        .unwrap_or_else(|| "Unknown".to_string())
}

fn convert_transitions_native(transitions: Vec<NativeTransition>) -> Vec<bridge::Transition> {
    transitions
        .into_iter()
        .map(|transition| bridge::Transition {
            id: transition.id.unwrap_or_else(|| "unknown".to_string()),
            name: transition
                .display
                .as_ref()
                .and_then(coerce_display_value)
                .or_else(|| transition.name.as_ref().and_then(coerce_display_value))
                .unwrap_or_else(|| "Transition".to_string()),
            to_status: convert_transition_status(transition.status.as_ref())
                .or_else(|| convert_transition_status(transition.to.as_ref())),
        })
        .collect()
}

fn sanitize_workday_hours(hours: u8) -> u64 {
    let normalized = hours.clamp(1, 24);
    normalized as u64
}

fn sanitize_workday_time(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    if parse_workday_time(trimmed).is_some() {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn normalize_config(mut config: Config) -> Config {
    config.workday_hours = sanitize_workday_hours(config.workday_hours) as u8;
    config.workday_start_time = sanitize_workday_time(config.workday_start_time, "09:00");
    config.workday_end_time = sanitize_workday_time(config.workday_end_time, "17:00");
    if config.timer_notification_interval == 0 {
        config.timer_notification_interval = 1;
    }
    config
}

fn parse_duration_value_to_seconds(value: &Value, workday_hours: u64) -> Option<u64> {
    match value {
        Value::String(text) => parse_tracker_duration_to_seconds(text, workday_hours),
        Value::Number(number) => number.as_u64(),
        Value::Object(map) => {
            for key in ["duration", "value", "display", "text", "en", "ru"] {
                if let Some(candidate) = map.get(key) {
                    if let Some(seconds) = parse_duration_value_to_seconds(candidate, workday_hours) {
                        return Some(seconds);
                    }
                }
            }
            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|entry| parse_duration_value_to_seconds(entry, workday_hours)),
        Value::Bool(_) | Value::Null => None,
    }
}

fn parse_tracker_duration_to_seconds(input: &str, workday_hours: u64) -> Option<u64> {
    let normalized = input.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    let mut weeks = 0u64;
    let mut days = 0u64;
    let mut hours = 0u64;
    let mut minutes = 0u64;

    for capture in DURATION_TOKEN_REGEX.captures_iter(&normalized) {
        let value = capture[1].parse::<u64>().ok()?;
        match &capture[2] {
            "w" => weeks += value,
            "d" => days += value,
            "h" => hours += value,
            "m" => minutes += value,
            _ => {}
        }
    }

    if weeks == 0 && days == 0 && hours == 0 && minutes == 0 {
        return None;
    }

    const WORKDAYS_PER_WEEK: u64 = 5;
    Some(
        weeks * WORKDAYS_PER_WEEK * workday_hours * 3600
            + days * workday_hours * 3600
            + hours * 3600
            + minutes * 60,
    )
}

fn convert_worklogs_native(entries: Vec<NativeWorklogEntry>, workday_hours: u64) -> Vec<bridge::WorklogEntry> {
    entries
        .into_iter()
        .map(|entry| bridge::WorklogEntry {
            id: coerce_display_value(&entry.id).unwrap_or_default(),
            date: entry
                .start
                .or(entry.created_at)
                .unwrap_or_default(),
            duration_seconds: entry
                .duration
                .as_deref()
                .and_then(|value| parse_tracker_duration_to_seconds(value, workday_hours))
                .unwrap_or(0),
            comment: entry.comment.unwrap_or_default(),
            author: coerce_comment_author(&entry.created_by),
        })
        .collect()
}

fn convert_transition_status(
    status: Option<&ytracker_api::TransitionDestination>,
) -> Option<bridge::Status> {
    status.and_then(|destination| {
        let key = destination
            .key
            .clone()
            .or(destination.id.clone())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let display = destination
            .display
            .as_ref()
            .and_then(coerce_display_value)
            .or_else(|| destination.name.as_ref().and_then(coerce_display_value));

        match (key, display) {
            (Some(key), Some(display)) => Some(bridge::Status { key, display }),
            (Some(key), None) => Some(bridge::Status {
                display: key.clone(),
                key,
            }),
            _ => None,
        }
    })
}

#[tauri::command]
fn get_config() -> Config {
    let cm = ConfigManager::new();
    normalize_config(cm.load())
}

#[tauri::command]
fn save_config(config: Config) -> Result<(), String> {
    let cm = ConfigManager::new();
    let normalized = normalize_config(config);
    cm.save(&normalized).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_client_credentials_info(
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<ClientCredentialsInfo, String> {
    let manager = secrets.inner().clone();
    let info = task::spawn_blocking(move || manager.get_public_info())
        .await
        .map_err(|err| format!("Failed to load client credentials info: {}", err))??;
    Ok(info)
}

#[tauri::command]
async fn has_session(secrets: tauri::State<'_, SecretsManager>) -> Result<bool, String> {
    let manager = secrets.inner().clone();
    let has_session = task::spawn_blocking(move || manager.get_session())
        .await
        .map_err(|err| format!("Failed to check session: {}", err))??
        .is_some();
    Ok(has_session)
}

#[tauri::command]
async fn exchange_code(
    code: String,
    org_id: Option<String>,
    org_type: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<bool, String> {
    let credentials = secrets
        .get_credentials()
        .map_err(|e| format!("Failed to read client credentials: {}", e))?
        .ok_or_else(|| {
            "Client credentials are missing. Configure your OAuth app credentials before logging in."
                .to_string()
        })?;

    let normalized_org_type = canonical_org_type(&org_type);
    let token_response =
        auth::exchange_code(&code, &credentials.client_id, &credentials.client_secret)
            .await
            .map_err(|err| err.to_string())?;

    secrets.save_session(
        &token_response.access_token,
        org_id.as_deref(),
        &normalized_org_type,
    )?;

    Ok(true)
}

#[tauri::command]
async fn get_issues(
    app: tauri::AppHandle,
    issue_store: tauri::State<'_, IssueStore>,
    timer: tauri::State<'_, Arc<Timer>>,
    query: Option<String>,
    filter: Option<Value>,
    scroll_id: Option<String>,
) -> Result<IssuePagePayload, String> {
    let normalized_query = query.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let filter_map = normalize_filter_map(filter);
    let has_filter = filter_map.is_some();

    let active_query = if let Some(query_value) = normalized_query {
        Some(query_value)
    } else if has_filter {
        None
    } else {
        Some(DEFAULT_ISSUE_QUERY.to_string())
    };

    log_issue_fetch_start(
        scroll_id.as_deref(),
        active_query.as_deref(),
        filter_map.as_ref(),
    );

    let search_params = IssueSearchParams::new(active_query, filter_map);

    let page = fetch_issue_page_native(&app, &search_params, scroll_id.as_deref()).await?;

    log_issue_fetch_result(
        scroll_id.as_deref(),
        page.has_more,
        page.next_scroll_id.as_deref(),
    );

    if scroll_id.is_none() {
        issue_store.set(page.issues.clone());
        let state = timer.get_state();
        if let Err(err) = update_tray_menu(&app, &page.issues, &state) {
            warn!("Failed to update tray state: {}", err);
        }
    }

    Ok(page)
}

fn normalize_filter_map(filter: Option<Value>) -> Option<JsonMap<String, Value>> {
    filter.and_then(|value| match value {
        Value::Object(map) if !map.is_empty() => Some(map),
        _ => None,
    })
}

fn describe_scroll_id(scroll_id: Option<&str>) -> String {
    match scroll_id {
        Some(id) if id.len() > 12 => format!("{}…", &id[..12]),
        Some(id) => id.to_string(),
        None => "root".to_string(),
    }
}

fn log_issue_fetch_start(
    scroll_id: Option<&str>,
    query: Option<&str>,
    filter: Option<&JsonMap<String, Value>>,
) {
    let scroll_repr = describe_scroll_id(scroll_id);
    let has_query = query
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let filter_keys = filter.map(|map| map.len()).unwrap_or(0);
    debug!(
        "tracker:get_issues start scroll={} has_query={} filter_keys={}",
        scroll_repr,
        has_query,
        filter_keys
    );
}

fn log_issue_fetch_result(
    scroll_id: Option<&str>,
    has_more: bool,
    next_scroll_id: Option<&str>,
) {
    debug!(
        "tracker:get_issues result scroll={} has_more={} next_scroll={}",
        describe_scroll_id(scroll_id),
        has_more,
        describe_scroll_id(next_scroll_id)
    );
}

async fn resolve_filter_shortcuts(
    params: &mut IssueSearchParams,
    client: &TrackerClient,
) -> Result<(), String> {
    let filter = match params.filter.as_mut() {
        Some(filter) => filter,
        None => return Ok(()),
    };

    if let Some(value) = filter.get_mut("assignee") {
        let mut cached_login: Option<String> = None;
        rewrite_me_tokens(value, client, &mut cached_login).await?;
    }

    Ok(())
}

async fn rewrite_me_tokens(
    value: &mut Value,
    client: &TrackerClient,
    cached_login: &mut Option<String>,
) -> Result<(), String> {
    match value {
        Value::String(text) => {
            if is_me_token(text) {
                let login = ensure_current_login(client, cached_login).await?;
                *text = login;
            }
        }
        Value::Array(items) => {
            let mut changed = false;
            for item in items.iter_mut() {
                if let Value::String(text) = item {
                    if is_me_token(text) {
                        let login = ensure_current_login(client, cached_login).await?;
                        *text = login.clone();
                        changed = true;
                    }
                }
            }
            if changed {
                dedupe_string_array(items);
            }
        }
        _ => {}
    }
    Ok(())
}

fn is_me_token(value: &str) -> bool {
    value.trim().eq_ignore_ascii_case("me()")
}

fn normalize_owned_string(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

async fn ensure_current_login(
    client: &TrackerClient,
    cached_login: &mut Option<String>,
) -> Result<String, String> {
    if let Some(login) = cached_login.clone() {
        return Ok(login);
    }

    let profile = client
        .get_myself()
        .await
        .map_err(|err| err.to_string())?;

    let login = normalize_owned_string(profile.login)
        .or_else(|| normalize_owned_string(profile.email))
        .ok_or_else(|| "Unable to determine current user login".to_string())?;

    *cached_login = Some(login.clone());
    Ok(login)
}

fn dedupe_string_array(items: &mut Vec<Value>) {
    let mut seen = HashSet::new();
    items.retain(|item| {
        if let Value::String(text) = item {
            if seen.contains(text) {
                return false;
            }
            seen.insert(text.clone());
        }
        true
    });
}

#[tauri::command]
async fn get_issue(
    issue_key: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<bridge::Issue, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_issue_detail_native(secrets_clone, &issue_key).await
}

#[tauri::command]
async fn get_comments(
    issue_key: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::Comment>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_comments_native(secrets_clone, &issue_key).await
}

#[tauri::command]
async fn get_issue_worklogs(
    issue_key: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::WorklogEntry>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_worklogs_native(secrets_clone, &issue_key).await
}

#[tauri::command]
async fn get_checklist(
    issue_key: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::ChecklistItem>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_checklist_native(secrets_clone, &issue_key).await
}

#[tauri::command]
async fn add_checklist_item(
    issue_key: String,
    item: bridge::ChecklistItemCreatePayload,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    add_checklist_item_native(secrets_clone, &issue_key, item).await
}

#[tauri::command]
async fn edit_checklist_item(
    issue_key: String,
    item_id: String,
    update: bridge::ChecklistItemUpdatePayload,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    edit_checklist_item_native(secrets_clone, &issue_key, &item_id, update).await
}

#[tauri::command]
async fn delete_checklist(
    issue_key: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    delete_checklist_native(secrets_clone, &issue_key).await
}

#[tauri::command]
async fn delete_checklist_item(
    issue_key: String,
    item_id: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    delete_checklist_item_native(secrets_clone, &issue_key, &item_id).await
}

#[tauri::command]
async fn add_comment(
    issue_key: String,
    text: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    add_comment_native(secrets_clone, &issue_key, &text).await
}

#[tauri::command]
async fn update_issue(
    issue_key: String,
    summary: Option<String>,
    description: Option<String>,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    update_issue_native(
        secrets_clone,
        &issue_key,
        summary.as_deref(),
        description.as_deref(),
    )
    .await
}

#[tauri::command]
async fn get_attachments(
    issue_key: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::Attachment>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_attachments_native(secrets_clone, &issue_key).await
}

#[tauri::command]
async fn get_statuses(
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_statuses_native(secrets_clone).await
}

#[tauri::command]
async fn get_resolutions(
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_resolutions_native(secrets_clone).await
}

#[tauri::command]
async fn get_queues(
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_queues_native(secrets_clone).await
}

#[tauri::command]
async fn get_projects(
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::SimpleEntity>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_projects_native(secrets_clone).await
}

#[tauri::command]
async fn get_users(
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::UserProfile>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_users_native(secrets_clone).await
}

#[tauri::command]
async fn release_scroll_context(app: tauri::AppHandle, scroll_id: String) -> Result<(), String> {
    if scroll_id.trim().is_empty() {
        return Ok(());
    }
    release_scroll_context_native(&app, &scroll_id).await
}

#[tauri::command]
async fn download_attachment(
    issue_key: String,
    attachment_id: String,
    dest_path: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    download_attachment_native(secrets_clone, &issue_key, &attachment_id, &dest_path).await
}

#[tauri::command]
async fn preview_attachment(
    issue_key: String,
    attachment_id: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<bridge::AttachmentPreview, String> {
    let secrets_clone = secrets.inner().clone();
    preview_attachment_native(secrets_clone, &issue_key, &attachment_id).await
}

#[tauri::command]
async fn preview_inline_image(
    path: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<bridge::AttachmentPreview, String> {
    let secrets_clone = secrets.inner().clone();
    preview_inline_resource_native(secrets_clone, &path).await
}

#[tauri::command]
async fn get_transitions(
    issue_key: String,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<Vec<bridge::Transition>, String> {
    let secrets_clone = secrets.inner().clone();
    fetch_transitions_native(secrets_clone, &issue_key).await
}

#[tauri::command]
async fn execute_transition(
    issue_key: String,
    transition_id: String,
    comment: Option<String>,
    resolution: Option<String>,
    secrets: tauri::State<'_, SecretsManager>,
) -> Result<(), String> {
    let secrets_clone = secrets.inner().clone();
    execute_transition_native(
        secrets_clone,
        &issue_key,
        &transition_id,
        comment.as_deref(),
        resolution.as_deref(),
    )
    .await
}

#[tauri::command]
fn start_timer(
    app: tauri::AppHandle,
    timer: tauri::State<'_, Arc<Timer>>,
    issue_store: tauri::State<'_, IssueStore>,
    issue_key: String,
    issue_summary: Option<String>,
) {
    timer.start(issue_key, issue_summary);
    broadcast_timer_state(&app, &timer, issue_store.inner());
}

#[tauri::command]
fn stop_timer(
    app: tauri::AppHandle,
    timer: tauri::State<'_, Arc<Timer>>,
    issue_store: tauri::State<'_, IssueStore>,
) -> (u64, Option<String>) {
    let result = timer.stop();
    broadcast_timer_state(&app, &timer, issue_store.inner());
    result
}

#[tauri::command]
fn get_timer_state(state: tauri::State<Arc<Timer>>) -> timer::TimerState {
    state.get_state()
}

fn emit_update_available_event(app: &tauri::AppHandle, update: &Update, automatic: bool) {
    let payload = UpdateAvailablePayload {
        version: update.version.to_string(),
        notes: update.body.clone(),
        pub_date: update.date.as_ref().map(|date| date.to_string()),
        automatic,
    };

    if let Err(err) = app.emit("updater://available", &payload) {
        warn!("Failed to emit updater event: {}", err);
    }
}

async fn check_for_updates_and_emit(
    app: tauri::AppHandle,
    automatic: bool,
) -> Result<(), UpdaterError> {
    if let Some(update) = app.updater()?.check().await? {
        emit_update_available_event(&app, &update, automatic);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .format_timestamp_millis()
    .try_init();

    info!("Starting YTracker native runtime");

    let timer = Arc::new(Timer::new());
    let timer_for_thread = timer.clone();
    let timer_for_tray_setup = timer.clone();
    let timer_for_tray_events = timer.clone();
    let timer_for_refresh_loop = timer.clone();

    let issue_store = IssueStore::default();
    let issue_store_for_setup = issue_store.clone();
    let issue_store_for_events = issue_store.clone();
    let issue_store_for_thread_loop = issue_store.clone();
    let issue_store_for_refresh_loop = issue_store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(timer.clone())
        .manage(issue_store.clone())
        .setup(move |app| {
            let app_handle = app.handle();
            let secrets_manager = SecretsManager::initialize(&app_handle)?;
            app.manage(secrets_manager);

            let startup_update_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = check_for_updates_and_emit(startup_update_handle, true).await {
                    warn!("Automatic update check failed: {}", err);
                }
            });
            let initial_issues = issue_store_for_setup.snapshot();
            let initial_state = timer_for_tray_setup.get_state();
            let initial_menu = build_tray_menu(&app_handle, &initial_issues, &initial_state)?;

            let tray_timer = timer_for_tray_events.clone();
            let tray_issue_store = issue_store_for_events.clone();

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&initial_menu)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    MENU_REFRESH_ID => {
                        let app_handle = app.clone();
                        let issue_store = tray_issue_store.clone();
                        let timer = tray_timer.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(err) =
                                refresh_issue_cache(app_handle, issue_store, timer, None).await
                            {
                                warn!("Failed to refresh issues from tray");
                                debug!("Tray refresh details: {}", redact_log_details(&err));
                            }
                        });
                    }
                    MENU_STOP_ID => {
                        let (elapsed, maybe_key) = tray_timer.stop();
                        broadcast_timer_state(app, &tray_timer, &tray_issue_store);
                        if let Some(issue_key) = maybe_key.as_deref() {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            emit_timer_stopped_event(app, issue_key, elapsed);
                            notify_timer_stopped(app, issue_key, elapsed);
                        }
                    }
                    id if id.starts_with(ISSUE_MENU_PREFIX) => {
                        let issue_key = &id[ISSUE_MENU_PREFIX.len()..];
                        let current_state = tray_timer.get_state();
                        if current_state.issue_key.as_deref() == Some(issue_key) {
                            return;
                        }

                        let summary = tray_issue_store.find(issue_key).map(|issue| issue.summary);
                        tray_timer.start(issue_key.to_string(), summary.clone());
                        broadcast_timer_state(app, &tray_timer, &tray_issue_store);
                        notify_timer_started(app, issue_key, summary.as_deref());
                    }
                    _ => {}
                })
                .build(app)?;

            let _ = update_tray_menu(&app_handle, &initial_issues, &initial_state);

            let refresh_app_handle = app_handle.clone();
            let refresh_issue_store = issue_store_for_refresh_loop.clone();
            let refresh_timer = timer_for_refresh_loop.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match has_session_from_app(&refresh_app_handle).await {
                        Ok(true) => {
                            if let Err(err) = refresh_issue_cache(
                                refresh_app_handle.clone(),
                                refresh_issue_store.clone(),
                                refresh_timer.clone(),
                                None,
                            )
                            .await
                            {
                                warn!("Background issue refresh failed");
                                debug!("Background refresh details: {}", redact_log_details(&err));
                            }
                        }
                        Ok(false) => {}
                        Err(err) => {
                            debug!("Background issue refresh skipped: {}", err);
                        }
                    }
                    sleep(std::time::Duration::from_secs(ISSUE_REFRESH_INTERVAL_SECS)).await;
                }
            });

            let event_handle = app_handle.clone();
            let notification_handle = app_handle.clone();
            let tray_update_handle = app_handle.clone();
            let thread_issue_store = issue_store_for_thread_loop.clone();
            std::thread::spawn(move || {
                let config_manager = ConfigManager::new();
                let mut last_workday_notification_day: Option<String> = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    let state = timer_for_thread.get_state();
                    if state.active {
                        let _ = event_handle.emit("timer-tick", &state);
                        if let Err(err) = update_tray_menu(
                            &tray_update_handle,
                            &thread_issue_store.snapshot(),
                            &state,
                        ) {
                            warn!("Failed to refresh tray menu: {}", err);
                        }
                    }

                    let runtime_config = config_manager.load();
                    let interval_minutes = runtime_config.timer_notification_interval.max(1);
                    if let Some(snapshot) =
                        timer_for_thread.check_notification_due(interval_minutes as u64 * 60)
                    {
                        let title = snapshot
                            .issue_key
                            .clone()
                            .unwrap_or_else(|| "Task timer".to_string());
                        let summary = snapshot
                            .issue_summary
                            .clone()
                            .unwrap_or_else(|| "Timer running".to_string());
                        let body = format!(
                            "{}\nTime spent: {}",
                            summary,
                            format_elapsed(snapshot.elapsed)
                        );

                        if let Err(err) = notification_handle
                            .notification()
                            .builder()
                            .title(title)
                            .body(body)
                            .show()
                        {
                            warn!("Failed to show notification: {}", err);
                        }
                    }

                    let now = Local::now();
                    let today_key = now.format("%Y-%m-%d").to_string();
                    let end_time = parse_workday_time(&runtime_config.workday_end_time);
                    let already_notified_today =
                        last_workday_notification_day.as_deref() == Some(today_key.as_str());

                    if !already_notified_today
                        && end_time.map(|value| now.time() >= value).unwrap_or(false)
                    {
                        last_workday_notification_day = Some(today_key);

                        let app_for_workday_notification = notification_handle.clone();
                        let issues_snapshot = thread_issue_store.snapshot();
                        let active_elapsed_seconds = if state.active { state.elapsed } else { 0 };
                        let expected_seconds = u64::from(runtime_config.workday_hours) * 3600;
                        let workday_hours = sanitize_workday_hours(runtime_config.workday_hours);

                        tauri::async_runtime::spawn(async move {
                            let logged_seconds = match fetch_today_logged_seconds_for_issues(
                                &app_for_workday_notification,
                                &issues_snapshot,
                                workday_hours,
                            )
                            .await
                            {
                                Ok(value) => value,
                                Err(err) => {
                                    debug!(
                                        "Workday end summary skipped: {}",
                                        redact_log_details(&err)
                                    );
                                    0
                                }
                            };

                            let tracked_total = logged_seconds.saturating_add(active_elapsed_seconds);

                            let (title, body) = if tracked_total < expected_seconds {
                                (
                                    "Workday wrap-up",
                                    format!(
                                        "Tracked {} of {} today. {}",
                                        format_elapsed(tracked_total),
                                        format_elapsed(expected_seconds),
                                        motivational_phrase()
                                    ),
                                )
                            } else {
                                (
                                    "Great job today!",
                                    format!(
                                        "You tracked {} today. Have a good evening!",
                                        format_elapsed(tracked_total)
                                    ),
                                )
                            };

                            if let Err(err) = app_for_workday_notification
                                .notification()
                                .builder()
                                .title(title)
                                .body(body)
                                .show()
                            {
                                warn!("Failed to show end-of-workday notification: {}", err);
                            }
                        });
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                window.hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_issues,
            get_issue,
            get_issue_worklogs,
            get_today_logged_seconds_for_issues,
            get_checklist,
            add_checklist_item,
            edit_checklist_item,
            delete_checklist,
            delete_checklist_item,
            get_comments,
            add_comment,
            update_issue,
            get_attachments,
            get_statuses,
            get_resolutions,
            get_queues,
            get_projects,
            get_users,
            release_scroll_context,
            download_attachment,
            preview_attachment,
            preview_inline_image,
            get_transitions,
            execute_transition,
            start_timer,
            stop_timer,
            get_timer_state,
            get_config,
            save_config,
            get_client_credentials_info,
            has_session,
            exchange_code,
            log_work,
            get_current_user,
            logout
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

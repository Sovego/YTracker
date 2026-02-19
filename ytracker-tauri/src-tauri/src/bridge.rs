//! Frontend-facing DTOs and conversion helpers for the Tauri bridge.
//!
//! This module defines serialized payload shapes exchanged between Rust
//! commands and TypeScript hooks.

use serde::{Deserialize, Serialize};

/// Represents an issue returned by Tracker API, including key, summary, description, status, priority and tracked time metadata.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Issue {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: Status,
    pub priority: Priority,
    pub issue_type: Option<SimpleEntity>,
    pub assignee: Option<SimpleEntity>,
    pub tags: Vec<String>,
    pub followers: Vec<SimpleEntity>,
    pub tracked_seconds: Option<u64>,
}

/// Represents a simple key/display pair for dynamic issue fields like status and priority.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Status {
    pub key: String,
    pub display: String,
}

/// Represents a simple key/display pair for dynamic issue fields like status and priority.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Priority {
    pub key: String,
    pub display: String,
}

/// Represents a simple key/display pair for dynamic issue fields like status and priority.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SimpleEntity {
    pub key: String,
    pub display: String,
}

/// Represents a simple key/display pair for dynamic issue fields like status and priority.
#[derive(Serialize, Deserialize, Debug)]
pub struct Comment {
    pub id: String,
    pub text: String,
    pub author: String,
    pub created_at: String,
}

/// Represents a simple key/display pair for dynamic issue fields like status and priority.
#[derive(Serialize, Deserialize, Debug)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub url: String,
    pub mime_type: Option<String>,
}

/// Represents a simple key/display pair for dynamic issue fields like status and priority.
#[derive(Serialize, Deserialize, Debug)]
pub struct Transition {
    pub id: String,
    pub name: String,
    pub to_status: Option<Status>,
}

/// Represents a simple key/display pair for dynamic issue fields like status and priority.
#[derive(Serialize, Deserialize, Debug)]
pub struct AttachmentPreview {
    pub mime_type: String,
    pub data_base64: String,
}

/// Represents a user profile returned by Tracker API, including display name, login, email and avatar URL.
#[derive(Serialize, Deserialize, Debug)]
pub struct UserProfile {
    pub display: Option<String>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

/// Represents a worklog entry returned by Tracker API, including id, date, duration, comment and author.
#[derive(Serialize, Deserialize, Debug)]
pub struct WorklogEntry {
    pub id: String,
    pub date: String,
    pub duration_seconds: u64,
    pub comment: String,
    pub author: String,
}

/// Checklist item DTO sent to the frontend.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub checked: bool,
    pub assignee: Option<String>,
    pub deadline: Option<String>,
    pub deadline_type: Option<String>,
    pub is_exceeded: Option<bool>,
    pub item_type: Option<String>,
}

/// Payload received from the frontend to create a checklist item.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChecklistItemCreatePayload {
    pub text: String,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub deadline_type: Option<String>,
}

/// Payload received from the frontend to update a checklist item.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChecklistItemUpdatePayload {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub deadline_type: Option<String>,
}

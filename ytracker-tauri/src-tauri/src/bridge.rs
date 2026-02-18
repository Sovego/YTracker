use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Issue {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: Status,
    pub priority: Priority,
    pub tracked_seconds: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Status {
    pub key: String,
    pub display: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Priority {
    pub key: String,
    pub display: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SimpleEntity {
    pub key: String,
    pub display: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Comment {
    pub id: String,
    pub text: String,
    pub author: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub url: String,
    pub mime_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Transition {
    pub id: String,
    pub name: String,
    pub to_status: Option<Status>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AttachmentPreview {
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UserProfile {
    pub display: Option<String>,
    pub login: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

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

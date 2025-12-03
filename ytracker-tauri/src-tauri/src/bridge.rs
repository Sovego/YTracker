use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Issue {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: Status,
    pub priority: Priority,
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

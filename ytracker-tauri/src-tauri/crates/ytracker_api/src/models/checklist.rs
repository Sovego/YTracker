//! Checklist models and request payloads for Tracker checklist endpoints.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents a single checklist item returned by the Tracker API.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: Value,
    pub text: Option<String>,
    pub text_html: Option<String>,
    pub checked: Option<bool>,
    pub assignee: Option<ChecklistAssignee>,
    pub deadline: Option<ChecklistDeadline>,
    pub checklist_item_type: Option<String>,
}

/// Assignee information embedded in a checklist item.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistAssignee {
    pub id: Option<Value>,
    pub display: Option<String>,
    pub login: Option<String>,
}

/// Deadline information embedded in a checklist item.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistDeadline {
    pub date: Option<String>,
    pub deadline_type: Option<String>,
    pub is_exceeded: Option<bool>,
}

/// Request body for creating a new checklist item (POST).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItemCreate {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<ChecklistDeadlineInput>,
}

/// Request body for editing a checklist item (PATCH).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItemUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<ChecklistDeadlineInput>,
}

/// Deadline payload for create/update requests.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistDeadlineInput {
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_type: Option<String>,
}

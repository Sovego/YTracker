//! Core issue models and dynamic field payload abstractions.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
/// Represents a Tracker issue returned by API, including dynamic field references and time tracking metadata.
pub struct Issue {
    pub key: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<IssueFieldRef>,
    #[serde(default)]
    pub priority: Option<IssueFieldRef>,
    #[serde(default, rename = "type")]
    pub issue_type: Option<IssueFieldRef>,
    #[serde(default)]
    pub assignee: Option<IssueFieldRef>,
    #[serde(default)]
    pub followers: Option<Vec<IssueFieldRef>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub spent: Option<Value>,
    #[serde(default)]
    pub time_spent: Option<Value>,
}

/// Payload for creating a new issue via `POST /v3/issues/`.
#[derive(Debug, Serialize)]
pub struct IssueCreateRequest {
    pub queue: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub issue_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(rename = "attachmentIds", skip_serializing_if = "Option::is_none")]
    pub attachment_ids: Option<Vec<i64>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
/// Represents a dynamic issue field reference which can be either a structured object with stable key/id and display values, or a simple text value.
pub enum IssueFieldRef {
    Object(IssueFieldPayload),
    Text(String),
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
/// Represents the structured payload of a dynamic issue field reference, including stable key/id, display/name and any additional metadata.
pub struct IssueFieldPayload {
    pub id: Option<String>,
    pub key: Option<String>,
    #[serde(default)]
    pub display: Option<Value>,
    #[serde(default)]
    pub name: Option<Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

impl IssueFieldRef {
    /// Returns stable key/id for dynamic issue field reference.
    pub fn key(&self) -> Option<String> {
        match self {
            IssueFieldRef::Object(payload) => payload.key.clone().or_else(|| payload.id.clone()),
            IssueFieldRef::Text(value) => Some(value.clone()),
        }
    }

    /// Returns display/name value normalized as JSON value.
    pub fn display_value(&self) -> Option<Value> {
        match self {
            IssueFieldRef::Object(payload) => {
                payload.display.clone().or_else(|| payload.name.clone())
            }
            IssueFieldRef::Text(value) => Some(Value::String(value.clone())),
        }
    }
}

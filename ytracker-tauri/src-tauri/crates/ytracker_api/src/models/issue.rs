//! Core issue models and dynamic field payload abstractions.

use serde::Deserialize;
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
    #[serde(default)]
    pub spent: Option<Value>,
    #[serde(default)]
    pub time_spent: Option<Value>,
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

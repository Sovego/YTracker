use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub key: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<IssueFieldRef>,
    #[serde(default)]
    pub priority: Option<IssueFieldRef>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum IssueFieldRef {
    Object(IssueFieldPayload),
    Text(String),
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
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
    pub fn key(&self) -> Option<String> {
        match self {
            IssueFieldRef::Object(payload) => payload.key.clone().or_else(|| payload.id.clone()),
            IssueFieldRef::Text(value) => Some(value.clone()),
        }
    }

    pub fn display_value(&self) -> Option<Value> {
        match self {
            IssueFieldRef::Object(payload) => {
                payload.display.clone().or_else(|| payload.name.clone())
            }
            IssueFieldRef::Text(value) => Some(Value::String(value.clone())),
        }
    }
}

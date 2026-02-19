//! Workflow transition models for issue state changes.

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
/// Represents a workflow transition returned by Tracker API, including destination status and metadata.
pub struct Transition {
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<Value>,
    #[serde(default)]
    pub display: Option<Value>,
    pub description: Option<String>,
    #[serde(default)]
    pub to: Option<TransitionDestination>,
    #[serde(default)]
    pub status: Option<TransitionDestination>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
/// Represents transition destination status payload with stable key/id and display/name values.
pub struct TransitionDestination {
    pub id: Option<String>,
    pub key: Option<String>,
    #[serde(default)]
    pub display: Option<Value>,
    #[serde(default)]
    pub name: Option<Value>,
    pub r#type: Option<String>,
}

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
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
pub struct TransitionDestination {
    pub id: Option<String>,
    pub key: Option<String>,
    #[serde(default)]
    pub display: Option<Value>,
    #[serde(default)]
    pub name: Option<Value>,
    pub r#type: Option<String>,
}

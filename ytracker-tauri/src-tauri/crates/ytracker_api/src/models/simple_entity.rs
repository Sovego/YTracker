use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimpleEntityRaw {
    pub id: Option<String>,
    pub key: Option<String>,
    pub name: Option<Value>,
    pub display: Option<Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

use serde::de::Deserializer;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimpleEntityRaw {
    #[serde(default, deserialize_with = "deserialize_string_field")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_field")]
    pub key: Option<String>,
    pub name: Option<Value>,
    pub display: Option<Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

fn deserialize_string_field<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(|val| match val {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Null => None,
        other => match serde_json::to_string(&other) {
            Ok(serialized) => Some(serialized),
            Err(_) => None,
        },
    }))
}

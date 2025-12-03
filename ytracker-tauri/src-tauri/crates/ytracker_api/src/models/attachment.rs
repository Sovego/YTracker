use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMetadata {
    pub id: Value,
    pub name: Option<Value>,
    pub content: Option<String>,
    pub thumbnail: Option<String>,
    pub mimetype: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub size: Option<u64>,
}

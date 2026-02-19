//! Attachment metadata models returned by Tracker issue endpoints.

use serde::Deserialize;
use serde_json::Value;

/// Represents attachment metadata returned by Tracker API, including stable id, name, content URL, thumbnail URL, mimetype and size.
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

use crate::models::{CommentAuthor, SimpleEntityRaw};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorklogEntry {
    pub id: Value,
    pub issue: Option<SimpleEntityRaw>,
    pub comment: Option<String>,
    pub created_by: Option<CommentAuthor>,
    pub created_at: Option<String>,
    pub start: Option<String>,
    pub duration: Option<String>,
}

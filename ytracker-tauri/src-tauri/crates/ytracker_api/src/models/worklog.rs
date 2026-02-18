use crate::models::CommentAuthor;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorklogEntry {
    pub id: Value,
    pub comment: Option<String>,
    pub created_by: Option<CommentAuthor>,
    pub created_at: Option<String>,
    pub start: Option<String>,
    pub duration: Option<String>,
}

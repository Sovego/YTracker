//! Comment models returned by Tracker issue discussion endpoints.

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
/// Represents a comment returned by Tracker API, including text content, author and time metadata.
pub struct Comment {
    pub id: Value,
    pub text: Option<String>,
    pub text_html: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub created_by: Option<CommentAuthor>,
    pub updated_by: Option<CommentAuthor>,
}
/// Represents the author of a comment, including display/login/email and avatar metadata.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommentAuthor {
    pub display: Option<Value>,
    pub login: Option<String>,
    pub email: Option<String>,
}

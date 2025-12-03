use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: Value,
    pub text: Option<String>,
    pub text_html: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub created_by: Option<CommentAuthor>,
    pub updated_by: Option<CommentAuthor>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommentAuthor {
    pub display: Option<Value>,
    pub login: Option<String>,
    pub email: Option<String>,
}

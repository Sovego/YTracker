use std::io;

use reqwest::StatusCode;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, TrackerError>;

#[derive(Debug, Error)]
pub enum TrackerError {
    #[error("http {status}: {message}")]
    Http {
        status: StatusCode,
        code: Option<String>,
        message: String,
    },
    #[error("authentication error: {0}")]
    Authentication(String),
    #[error("request timed out: {0}")]
    Timeout(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("serialization error: {0}")]
    Serialization(String),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("unexpected error: {0}")]
    Other(String),
}

impl TrackerError {
    pub fn http(status: StatusCode, code: Option<String>, message: impl Into<String>) -> Self {
        TrackerError::Http {
            status,
            code,
            message: message.into(),
        }
    }
}

impl From<reqwest::Error> for TrackerError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            TrackerError::Timeout(err.to_string())
        } else if err.is_status() {
            let status = err.status().unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            TrackerError::Http {
                status,
                code: None,
                message: err.to_string(),
            }
        } else if err.is_connect() {
            TrackerError::Network(err.to_string())
        } else {
            TrackerError::Other(err.to_string())
        }
    }
}

impl From<serde_json::Error> for TrackerError {
    fn from(err: serde_json::Error) -> Self {
        TrackerError::Serialization(err.to_string())
    }
}

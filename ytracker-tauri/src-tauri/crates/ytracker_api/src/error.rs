//! Error model used by Tracker API client operations.

use std::io;

use reqwest::StatusCode;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, TrackerError>;

/// Represents various error conditions that can occur during Tracker API interactions, including HTTP errors with status and message, authentication failures, timeouts, network issues, serialization problems and other unexpected errors.
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
    /// Constructs an HTTP error variant with optional API-specific code.
    pub fn http(status: StatusCode, code: Option<String>, message: impl Into<String>) -> Self {
        TrackerError::Http {
            status,
            code,
            message: message.into(),
        }
    }
}

impl From<reqwest::Error> for TrackerError {
    /// Converts reqwest errors into semantic TrackerError variants.
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
    /// Converts serde_json decode/encode failures into serialization errors.
    fn from(err: serde_json::Error) -> Self {
        TrackerError::Serialization(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::TrackerError;
    use reqwest::StatusCode;

    #[test]
    fn http_constructor_sets_status_code_and_message() {
        let err = TrackerError::http(
            StatusCode::BAD_REQUEST,
            Some("BAD_INPUT".to_string()),
            "invalid payload",
        );

        match err {
            TrackerError::Http {
                status,
                code,
                message,
            } => {
                assert_eq!(status, StatusCode::BAD_REQUEST);
                assert_eq!(code.as_deref(), Some("BAD_INPUT"));
                assert_eq!(message, "invalid payload");
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn serde_json_error_maps_to_serialization_variant() {
        let parse_err = serde_json::from_str::<serde_json::Value>("not-json").unwrap_err();
        let err = TrackerError::from(parse_err);

        match err {
            TrackerError::Serialization(message) => {
                assert!(!message.trim().is_empty());
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }
}

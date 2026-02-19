//! In-memory issue cache used to enrich timer/worklog operations.

use crate::bridge::Issue;
use std::sync::{Arc, Mutex};

/// Thread-safe in-memory store for currently loaded issues, allowing quick access to issue details without repeated API calls.
#[derive(Clone, Default)]
pub struct IssueStore {
    issues: Arc<Mutex<Vec<Issue>>>,
}

impl IssueStore {
    /// Replaces current in-memory issue snapshot.
    pub fn set(&self, items: Vec<Issue>) {
        let mut issues = self.issues.lock().unwrap();
        *issues = items;
    }

    /// Returns a cloned snapshot of currently cached issues.
    pub fn snapshot(&self) -> Vec<Issue> {
        self.issues.lock().unwrap().clone()
    }

    /// Finds an issue by key in the current in-memory cache.
    pub fn find(&self, key: &str) -> Option<Issue> {
        self.issues
            .lock()
            .unwrap()
            .iter()
            .find(|issue| issue.key == key)
            .cloned()
    }
}

use crate::bridge::Issue;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct IssueStore {
    issues: Arc<Mutex<Vec<Issue>>>,
}

impl IssueStore {
    pub fn set(&self, items: Vec<Issue>) {
        let mut issues = self.issues.lock().unwrap();
        *issues = items;
    }

    pub fn snapshot(&self) -> Vec<Issue> {
        self.issues.lock().unwrap().clone()
    }

    pub fn find(&self, key: &str) -> Option<Issue> {
        self.issues
            .lock()
            .unwrap()
            .iter()
            .find(|issue| issue.key == key)
            .cloned()
    }
}

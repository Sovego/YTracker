//! Timer state machine used for local issue time tracking.

use serde::Serialize;
use std::sync::{Arc, Mutex};

/// Represents the current state of the timer, including whether it's active, which issue is being tracked, when it started and how much time has elapsed.
#[derive(Clone, Serialize, Debug)]
pub struct TimerState {
    pub active: bool,
    pub issue_key: Option<String>,
    pub issue_summary: Option<String>,
    pub start_time: Option<u64>,
    pub elapsed: u64,
}

/// Thread-safe timer runtime storing active issue and elapsed tracking data.
pub struct Timer {
    state: Arc<Mutex<TimerState>>,
    last_notification_at: Arc<Mutex<Option<u64>>>,
}

impl Timer {
    /// Creates a new idle timer instance.
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(TimerState {
                active: false,
                issue_key: None,
                issue_summary: None,
                start_time: None,
                elapsed: 0,
            })),
            last_notification_at: Arc::new(Mutex::new(None)),
        }
    }

    /// Returns current unix timestamp in seconds.
    fn now_secs() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    /// Starts tracking time for an issue and resets elapsed counter.
    pub fn start(&self, issue_key: String, issue_summary: Option<String>) {
        let now = Self::now_secs();
        {
            let mut state = self.state.lock().unwrap();
            state.active = true;
            state.issue_key = Some(issue_key);
            state.issue_summary = issue_summary;
            state.start_time = Some(now);
            state.elapsed = 0;
        }
        let mut last_notification = self.last_notification_at.lock().unwrap();
        *last_notification = Some(now);
    }

    /// Stops timer and returns elapsed seconds with previously active issue key.
    pub fn stop(&self) -> (u64, Option<String>) {
        let mut state = self.state.lock().unwrap();
        if !state.active {
            return (0, None);
        }

        let now = Self::now_secs();
        let start = state.start_time.unwrap_or(now);
        let elapsed = now - start;
        let key = state.issue_key.clone();

        state.active = false;
        state.issue_key = None;
        state.issue_summary = None;
        state.start_time = None;
        state.elapsed = 0;

        drop(state);

        let mut last_notification = self.last_notification_at.lock().unwrap();
        *last_notification = None;

        (elapsed, key)
    }

    /// Returns a snapshot with elapsed recomputed when timer is active.
    pub fn get_state(&self) -> TimerState {
        let state = self.state.lock().unwrap();
        let mut snapshot = state.clone();
        if snapshot.active {
            let now = Self::now_secs();
            let start = snapshot.start_time.unwrap_or(now);
            snapshot.elapsed = now.saturating_sub(start);
        }
        snapshot
    }

    /// Returns timer snapshot only when periodic notification interval is due.
    pub fn check_notification_due(&self, interval_secs: u64) -> Option<TimerState> {
        if interval_secs == 0 {
            return None;
        }

        let now = Self::now_secs();
        let state = self.state.lock().unwrap();
        if !state.active {
            return None;
        }

        let start = state.start_time.unwrap_or(now);
        let mut snapshot = state.clone();
        snapshot.elapsed = now.saturating_sub(start);
        drop(state);

        let mut last_notification = self.last_notification_at.lock().unwrap();
        let last_time = last_notification.unwrap_or(start);
        if now.saturating_sub(last_time) < interval_secs {
            return None;
        }

        *last_notification = Some(now);
        Some(snapshot)
    }
}

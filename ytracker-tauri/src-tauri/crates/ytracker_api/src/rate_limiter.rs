//! Lightweight async rate limiter used for API request pacing.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use tokio::time::sleep;


/// Represents a simple async rate limiter that enforces a minimum cooldown interval between hits.
#[derive(Clone, Debug)]
pub struct RateLimiter {
    cooldown: Duration,
    last_call: Arc<Mutex<Option<Instant>>>,
}

impl RateLimiter {
    /// Creates a limiter that enforces a minimum delay between requests.
    pub fn new(cooldown: Duration) -> Self {
        Self {
            cooldown,
            last_call: Arc::new(Mutex::new(None)),
        }
    }

    /// Waits until cooldown is satisfied, then records current call timestamp.
    pub async fn hit(&self) {
        let mut guard = self.last_call.lock().await;
        if let Some(last) = *guard {
            let elapsed = last.elapsed();
            if elapsed < self.cooldown {
                sleep(self.cooldown - elapsed).await;
            }
        }
        *guard = Some(Instant::now());
    }

    /// Returns configured cooldown interval.
    pub fn cooldown(&self) -> Duration {
        self.cooldown
    }
}

#[cfg(test)]
mod tests {
    use super::RateLimiter;
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn cooldown_accessor_returns_configured_value() {
        let limiter = RateLimiter::new(Duration::from_millis(25));
        assert_eq!(limiter.cooldown(), Duration::from_millis(25));
    }

    #[tokio::test]
    async fn second_hit_waits_for_cooldown_interval() {
        let limiter = RateLimiter::new(Duration::from_millis(40));

        limiter.hit().await;
        let start = Instant::now();
        limiter.hit().await;

        assert!(start.elapsed() >= Duration::from_millis(35));
    }
}

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use tokio::time::sleep;

#[derive(Clone, Debug)]
pub struct RateLimiter {
    cooldown: Duration,
    last_call: Arc<Mutex<Option<Instant>>>,
}

impl RateLimiter {
    pub fn new(cooldown: Duration) -> Self {
        Self {
            cooldown,
            last_call: Arc::new(Mutex::new(None)),
        }
    }

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

    pub fn cooldown(&self) -> Duration {
        self.cooldown
    }
}

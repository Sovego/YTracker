## Yandex Tracker API written in Rust
This crate provides a Rust client for the Yandex Tracker API, enabling seamless integration with the Yandex Tracker service. It includes functionality for authentication, issue management, and other common operations supported by the Tracker API.
## Usage
To use this crate, add it as a dependency in your `Cargo.toml`:

```toml
[dependencies]
ytracker_api = "0.2.0"
```
Then, you can create a client instance and interact with the Tracker API:

```rust
use ytracker_api::{TrackerClient, TrackerConfig, AuthMethod};

fn main() {
    let config = TrackerConfig {
        base_url: "https://api.tracker.yandex.net".to_string(),
        auth_method: AuthMethod::Token("your_api_token".to_string()),
    };

    let client = TrackerClient::new(config);

    // Example usage: fetch issues
    let issues = client.get_issues().unwrap();
    println!("{:?}", issues);
}
```
## Features
- Authentication support (API token, OAuth).
- Issue management (create, update, delete, fetch).
- Comment management.
- Checklist item management.
- Error handling with detailed error types.

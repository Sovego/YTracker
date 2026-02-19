//! Build script for Tauri native target.

use std::env;

fn main() {
    // Load .env values (useful during development) before build-time macros read them
    let _ = dotenvy::dotenv();

    if let Ok(val) = env::var("YTRACKER_CLIENT_ID") {
        println!("cargo:rustc-env=YTRACKER_CLIENT_ID={}", val);
    }
    if let Ok(val) = env::var("YTRACKER_CLIENT_SECRET") {
        println!("cargo:rustc-env=YTRACKER_CLIENT_SECRET={}", val);
    }

    println!("cargo:rerun-if-env-changed=YTRACKER_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=YTRACKER_CLIENT_SECRET");

    tauri_build::build()
}

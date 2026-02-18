# Architecture Overview

YTracker is a single desktop application with a React frontend and a Rust native backend connected through a typed Tauri bridge.

## Layers

- **Frontend (React/Vite)**
  - Entry: `src/main.tsx`
  - App shell/state orchestration: `src/App.tsx`
  - UI components: `src/components/`
  - Bridge hooks and DTO contracts: `src/hooks/useBridge.ts`

- **Native Backend (Tauri/Rust)**
  - Runtime and command surface: `src-tauri/src/lib.rs`
  - DTO bridge conversion layer: `src-tauri/src/bridge.rs`
  - Secure token/client credential storage: `src-tauri/src/secrets.rs`
  - Timer runtime state: `src-tauri/src/timer.rs`
  - Persistent settings: `src-tauri/src/config.rs`

- **Tracker API Client Crate**
  - Crate root: `src-tauri/crates/ytracker_api/src/lib.rs`
  - HTTP client: `src-tauri/crates/ytracker_api/src/client.rs`
  - Auth exchange: `src-tauri/crates/ytracker_api/src/auth.rs`
  - API models: `src-tauri/crates/ytracker_api/src/models/`

## Data Flow

1. UI components call typed hooks from `useBridge.ts`.
2. Hooks invoke native commands exposed from `src-tauri/src/lib.rs`.
3. Native handlers call `ytracker_api::TrackerClient` and local services (timer/config/secrets).
4. Results are normalized into bridge DTOs and returned to frontend.
5. Event streams (`timer-tick`, updater events) keep long-lived UI state synchronized.

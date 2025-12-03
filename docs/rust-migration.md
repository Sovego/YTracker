# Native Rust Yandex Tracker Client Migration

## Purpose and context
- Replace the embedded Python runtime, PyO3 bridge, and `yandex_tracker_client` dependency with a first-class Rust HTTP client for Yandex Tracker.
- Reduce distribution size/complexity, simplify packaging, and remove the need to bundle CPython + site-packages.
- Provide a reference “memory” of requirements, design, and the migration plan for future contributors.

> **Status (Phase 5)**: The Rust client now drives every command. The Python modules, bundled
> runtime, PyO3 dependency, and toggle-able fallback have all been deleted from the repository.

## Responsibilities to replicate from the current Python core
1. **Authentication & credential storage**
   - OAuth 2.0 code exchange via `https://oauth.yandex.ru/token` (client id/secret flow already configured by the desktop app).
   - IAM token handling for Yandex Cloud organizations.
   - Persisting `token`, `org_id`, and `org_type` via the existing `SecretsManager` (instead of Python `keyring`).
2. **Issue lifecycle**
   - Search via Tracker query strings or filter maps (`issues.find`).
   - Fetch single issues, including transitions, attachments, comments, and metadata fields used by the UI.
   - Update issue fields (summary, description, arbitrary patch dictionaries).
   - Execute transitions (with optional resolution/comment).
3. **Collaboration extras**
   - Comments (list/create/update/delete) and attachment uploads/downloads.
   - Worklog logging with human-readable duration parsing (`1w 2d 4h 30m → P1W2DT4H30M`).
4. **Metadata catalogs**
   - Statuses, resolutions, priorities, and other enumerations surfaced in the UI (currently wrapped by `SimpleEntity`).
5. **User context**
   - `/v3/myself` fetch for displaying avatar/login and validating credentials.
6. **Caching & rate limiting**
   - 5-minute issue cache to avoid repeated list calls.
   - 350 ms global API cooldown already enforced in `lib.rs`.

## Functional requirements for the Rust implementation
- Maintain parity with every bridge API: `get_issues`, `get_issue`, `get_comments`, `add_comment`, `get_attachments`, `download_attachment`, `preview_attachment`, `preview_inline_image`, `get_transitions`, `execute_transition`, `update_issue`, `log_work`, `get_current_user`, `logout`, plus OAuth exchange.
- Support both org types (`yandex360`, `cloud`), mapping to `X-Org-ID` or `X-Cloud-Org-ID` headers.
- Provide structured error information (status code, Tracker error code) so the UI can react (401 → prompt login, 403 → toast, 429 → retry later, etc.).
- Preserve localized display handling (`Accept-Language`, `display` dictionaries) so the UI still shows clean text.

## Non-functional requirements
- **Distribution**: eliminate bundled Python and decrease installer size; no runtime dependency on system Python.
- **Performance**: continue rate limiting (≥350 ms) and consider connection pooling/reuse via `reqwest::Client`.
- **Reliability**: automatic retries/backoff for `429` or transient `5xx` responses.
- **Security**: keep tokens in `SecretsManager`, zero sensitive data in logs, honor HTTPS only.
- **Observability**: structured logging via `tracing` (request id, method, path, status, ms).
- **Testing**: support offline tests via recorded fixtures/wiremock; provide integration tests behind an env flag for real API hits.

## Target Rust architecture
### Crate layout
Create a new workspace member, e.g. `crates/ytracker_api`, exporting an async client:
```
ytracker-tauri/
├─ src-tauri/
│  └─ ...
└─ crates/
   └─ ytracker_api/
      ├─ src/
      │  ├─ lib.rs
      │  ├─ client.rs          # base HTTP client
      │  ├─ auth.rs            # OAuth + IAM helpers
      │  ├─ config.rs          # org/token configuration structs
      │  ├─ models/            # serde types: Issue, Comment, Transition, etc.
      │  ├─ services/
      │  │  ├─ issues.rs
      │  │  ├─ comments.rs
      │  │  ├─ attachments.rs
      │  │  ├─ transitions.rs
      │  │  └─ worklog.rs
      │  ├─ cache.rs           # optional caching abstraction
      │  └─ error.rs           # unified error type
      └─ Cargo.toml
```

### HTTP stack
- Use `reqwest` with `rustls` TLS for portability.
- Build a single `Client` with default headers: `Authorization`, `X-Org-ID`/`X-Cloud-Org-ID`, `Accept-Language` (configurable), `User-Agent` (e.g., `ytracker-tauri/<version>`).
- Implement middleware-style helpers for pagination, JSON serialization, and error decoding.

### Authentication module
- `OAuthAuthorizer` for exchanging codes: POST form to `/token`, parse `{access_token, expires_in}`.
- `IamAuthorizer` for Bearer tokens (optional future extension if service account flow required).
- `CredentialStore` trait implemented by `SecretsManager` binding to keep concerns separate.

### Data models & serialization
- Mirror API payloads with `serde` structs; include `#[serde(rename_all = "camelCase")]` for consistent casing.
- Provide conversion helpers to UI DTOs (`Into<bridge::Issue>` replacements).
- Implement localized display normalization (similar to `_coerce_label` and `_normalize_status_payload`) in Rust to ensure parity.

### Services
- `IssuesService`: `search(query/filter)`, `get(key, fields)`, `update(key, patch)`, `transitions(key)`, `execute_transition`.
- `CommentsService`: `list`, `create`, `update`, `delete`.
- `AttachmentsService`: metadata, download (stream to file), upload, inline preview (returns MIME + base64, reusing authenticated `reqwest` client).
- `WorklogService`: `log(issue_key, duration, comment, date)` with shared duration parser.
- `MetadataService`: statuses/resolutions/priorities caches.
- Each service returns `Result<T, TrackerError>`; errors hold HTTP status, API error body, and optional context.

### Caching & rate limiting
- Provide a `CacheBackend` trait (memory/disk). Start with an in-memory `HashMap` + TTL for issue lists; later integrate `moka` or `cached` if needed.
- Expose async rate limiter (e.g., `tokio::sync::Mutex` + `Instant` guard) so the rest of the app can await `client.cooldown().await` before issuing HTTP calls—mirrors the current `LAST_API_CALL` logic in `lib.rs`.

### Error handling
- `TrackerError` variants: `Http { status, code, message }`, `Auth`, `Timeout`, `Serialization`, `Io`, `RateLimited`.
- Implement `Display`/`std::error::Error` and `From<reqwest::Error>` conversions.
- Provide helpers to detect “retryable” cases (502/503/504/429) vs fatal (401/403/404), matching the UI’s needs.

### Testing strategy
- Unit tests per service using mock responses (via `wiremock-rs`).
- Snapshot tests for JSON (issue search, transitions) to guarantee compatibility.
- Integration tests behind `--features integration-tests` hitting real API when `YTRACKER_TEST_TOKEN` etc. are set.

## Integration strategy with the Tauri app
1. **Introduce the Rust crate**
   - Add `crates/ytracker_api` to the workspace and wire it into `src-tauri/Cargo.toml`.
   - Provide a thin `TrackerClient` wrapper accessible from `lib.rs` commands.
2. **Replace Python bridge calls incrementally**
   - Start with read-only commands (`get_current_user`, `get_issues`, metadata fetchers) to validate the new client.
   - Maintain both implementations during transition via a feature flag or runtime toggle (done temporarily via `use_native_client`; **toggle removed after Phase 5** once parity was confirmed).
3. **Remove PyO3 dependency**
   - After all commands use the Rust client, delete `bridge.rs` and `client.py` bindings, along with `initialize_python_runtime` and Python bootstrap artifacts.
   - Update `tauri.conf.json` packaging to exclude `python_modules` and runtime folders.
4. **Reuse SecretsManager**
   - Move credential storage logic from Python `AuthService` into a Rust helper that interacts with `SecretsManager` (already available in Tauri state), ensuring token persistence remains seamless.
5. **Maintain DTO compatibility**
   - Keep the TypeScript/React frontend unchanged by serializing the same JSON shape from Rust commands; add conversion layers if internal structs differ.
6. **Validation & rollout**
   - Add telemetry/logging for all new HTTP calls to confirm parity before deleting Python; gate the release behind beta testing.

## Step-by-step execution plan
1. **Scaffolding (Week 1)**
   - Create `ytracker_api` crate with `reqwest`, `serde`, `tracing`, `thiserror`, `tokio` deps.
   - Implement configuration structs, error type, and basic HTTP client with rate limiter.
2. **Authentication & user endpoint (Week 1–2)**
   - Port OAuth exchange + credential persistence.
   - Implement `/v3/myself` call; expose Tauri command using new client (feature-flagged).
3. **Issue read flows (Week 2–3)**
   - Implement issue search + detail fetch, statuses/resolutions, comments list, attachments metadata.
   - Wire `get_issues`, `get_comments`, `get_attachments`, tray refresh to the Rust client behind the flag.
4. **Mutating flows (Week 3–4)**
   - Add issue update, comment creation, transition execution, worklog logging, attachment download/upload, preview endpoints.
   - Transition the remaining commands and remove the flag once parity tests pass.
5. **Cleanup & distribution (Week 4)**
   - ✅ Delete Python modules, PyO3 bridge, bundled runtime assets, and the `build_cython` scaffolding.
   - ✅ Update build scripts, CI, documentation, and release notes to reflect the pure Rust stack.
6. **Post-migration hardening**
   - Run regression suite, add new integration tests, and monitor telemetry for API errors or rate-limit behavior.

## Risks & mitigations
| Risk | Mitigation |
| --- | --- |
| API surface differences between Python client and REST spec | Use official docs + inspect HTTP traffic from Python client to replicate semantics; add integration tests for tricky endpoints (transitions, worklogs). |
| Regression in UI expectations (JSON shape changes) | Define explicit DTO structs with serde tests ensuring backward compatibility; snapshot responses. |
| OAuth/IAM credential handling bugs | Keep old Python flow behind a feature flag until new flow proves stable; add logging (without secrets) for auth steps. |
| Rate limiting or throttling | Keep global cooldown + implement retry with exponential backoff; surface user-friendly errors on repeated 429 responses. |

## Deliverables
- `crates/ytracker_api` Rust library.
- Updated `src-tauri` commands calling the Rust client.
- Removed Python runtime assets and dependencies.
- Documentation (this file + README updates) detailing architecture and operational considerations.

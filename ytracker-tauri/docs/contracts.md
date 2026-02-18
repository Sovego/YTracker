# Frontend–Native Contracts

This document tracks the typed contract between `src/hooks/useBridge.ts` and `src-tauri/src/lib.rs`.

## Bridge Command Families

- **Auth & session**
  - `get_client_credentials_info`
  - `has_session`
  - `exchange_code`
  - `logout`
  - `get_current_user`

- **Issues & details**
  - `get_issues`, `get_issue`
  - `get_comments`, `add_comment`
  - `get_issue_worklogs`, `log_work`
  - `get_attachments`, `download_attachment`, `preview_attachment`, `preview_inline_image`
  - `update_issue`

- **Checklist**
  - `get_checklist`
  - `add_checklist_item`
  - `edit_checklist_item`
  - `delete_checklist`
  - `delete_checklist_item`

- **Reference catalogs**
  - `get_statuses`, `get_resolutions`, `get_queues`, `get_projects`, `get_users`

- **Workflow transitions**
  - `get_transitions`, `execute_transition`

- **Timer**
  - `start_timer`, `stop_timer`, `get_timer_state`

- **Config**
  - `get_config`, `save_config`

- **Pagination lifecycle**
  - `release_scroll_context`

## Event Contracts

- `timer-tick`
  - Emitted by native timer runtime.
  - Consumed by `useTimer` to update elapsed/active state.

- `updater://available`
  - Emitted by updater flow in native backend.
  - Consumed by `useUpdater` to surface available release metadata.

- `ytracker:config-updated`
  - Browser-level custom event emitted by `useConfig` after successful saves/reset.
  - Used for frontend config fan-out to multiple hook consumers.

## Contract Change Rule

When changing any command payload/return shape or event payload:
1. Update Rust handler and DTO conversion.
2. Update TypeScript interfaces and hook wrappers.
3. Update this document in the same change set.

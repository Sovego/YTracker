# Routing & Tasks Page Design

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Add React Router, top navigation bar, page-specific sidebar system, and wrap current issue view as Tasks page.

## Context

YTracker is currently a single-view app with a two-pane layout (sidebar issue list + detail pane). To support future pages (boards, timesheets, dashboard), the app needs multi-page navigation. This spec covers the first sub-project: adding routing infrastructure and evolving the current view into a proper Tasks page.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Current view fate | Evolve into Tasks page | Preserves existing work, avoids duplication |
| Navigation pattern | Top bar + page-specific collapsible sidebar | Flexible — each page controls its own sidebar content |
| Router library | React Router v7 (`react-router-dom@^7`) | Mature, supports nested routes, lazy loading, URL history |
| Router type | `HashRouter` | Simpler for Tauri webview — no SPA fallback config needed, no URL bar in desktop app |
| Timer location | Compact display in top nav bar | Always visible, saves screen real estate, no floating overlay |
| Top bar contents | Branding + page tabs + today progress + timer + settings | Consolidates app chrome into one strip |
| Implementation approach | Layered incremental (3 steps) | Each step testable independently, lower risk |

## Layout

### Desktop (>= 1024px)

```
┌──────────────────────────────────────────────────────────────┐
│ TopNavBar                                                     │
│ [YTracker]  [Tasks] [Boards] [Timesheets] [Dashboard]  ▐▐ 5h │ ● PROJ-42 0:23:15 ⏹ │ ⚙ │
├─────────────────┬────────────────────────────────────────────┤
│ Sidebar Slot    │ Page Content (<Outlet />)                  │
│ (page-specific, │                                            │
│  collapsible)   │                                            │
│                 │                                            │
│ Tasks: issue    │ Tasks: IssueDetail                         │
│ list + filters  │ Dashboard: full-width widgets              │
│                 │ Boards: board columns                      │
│                 │                                            │
└─────────────────┴────────────────────────────────────────────┘
```

### Narrow (< 1024px)

- Page tabs collapse into hamburger/dropdown menu
- Progress + timer stay visible (compact)
- Tasks page: sidebar and detail mutually exclusive (existing behavior)
- Timer hides issue key, shows only elapsed + stop button

## Route Structure

```
/            → redirect to /tasks
/tasks       → TasksPage (sidebar: issue list + filters)
/boards      → PlaceholderPage ("Coming Soon")
/timesheets  → PlaceholderPage ("Coming Soon")
/dashboard   → PlaceholderPage ("Coming Soon")
*            → redirect to /tasks (catch-all for unknown routes)
```

## Component Architecture

### New Components

All new components go in `src/components/`, following existing co-location convention (tests alongside source).

| Component | Responsibility |
|-----------|---------------|
| `AppShell.tsx` | Layout wrapper: TopNavBar + sidebar slot + `<Outlet />`. **Single owner of timer state** — calls `useTimer()` once, listens to `timer-stopped` event, owns WorkLogDialog + `pendingRestart` conflict-resolution state, settings dialog state. Passes timer state/callbacks down via Outlet context. Calls `refreshTodayProgress()` and passes progress data to TopNavBar. |
| `TopNavBar.tsx` | Branding, page tabs (NavLink), today progress (received via props), compact timer (received via props), settings button. Pure presentational — no hooks for timer/worklog/progress. |
| `CompactTimer.tsx` | Minimal timer for nav bar: issue key + elapsed time + stop button. Receives timer state and `onStop` callback via props. Idle state shows "No timer". |
| `TasksPage.tsx` | Current App.tsx body extracted: sidebar (issue list + filters) + detail pane. Owns `selectedIssue`, filter state, sidebar collapsed state, create issue dialog. Consumes `useTracker()`, `useFilterCatalogs()`, `useIssueDetails()`. Reads timer callbacks from Outlet context for IssueDetail's "start timer" button. |
| `PlaceholderPage.tsx` | Simple "Coming Soon" component for future routes. |

### Modified Components

| Component | Changes |
|-----------|---------|
| `App.tsx` | Stripped to: auth check, router setup, `<AppShell>` as layout route. Bulk of content moves to TasksPage. |
| `Timer.tsx` | Removed. Replaced by `CompactTimer.tsx`. WorkLogDialog trigger logic moves to AppShell. |

### Unchanged Components

IssueList, IssueDetail, FilterSelect, Checklist, MarkdownEditor, WorkLogDialog, SettingsDialog, CreateIssueDialog, Login, Loaders — all remain as-is.

## Data Flow & State Management

### State Ownership

| Component | State Owned |
|-----------|------------|
| `App.tsx` | `isAuthenticated`, router setup. Login screen renders outside the router — when `isAuthenticated` is false, the router unmounts entirely (naturally clearing all page state on logout). |
| `AppShell.tsx` | **Timer state** (single `useTimer()` call), `timer-stopped` event listener, WorkLogDialog open/close, `workLogData`, `pendingRestart` (conflict-resolution for timer switch), settings dialog open/close, today progress data (`refreshTodayProgress()`). Provides timer state + callbacks to children via React Router's Outlet context. |
| `TopNavBar.tsx` | No owned state — purely presentational. Receives all data (timer state, progress, callbacks) via props from AppShell. |
| `TasksPage.tsx` | `selectedIssue`, filter state, sidebar collapsed, create issue dialog. Reads timer `start`/`stop` callbacks from Outlet context for IssueDetail's timer button. Reports issue keys upward (via Outlet context callback) so AppShell can compute today progress. |

### Outlet Context Type

AppShell provides an Outlet context with this shape (defined as a TypeScript interface):

```typescript
interface AppShellContext {
  timerState: TimerState;       // from useTimer()
  startTimer: (issueKey: string, issueSummary: string) => void;
  stopTimer: () => Promise<void>;
  reportIssueKeys: (keys: string[]) => void;  // for today progress computation
  worklogSuccessCounter: number; // incremented after worklog submit — pages watch to trigger refresh
  onAuthError: () => void;       // called by pages on auth-related API errors — triggers logout
}
```

Pages access this via `useOutletContext<AppShellContext>()`.

### Sidebar Slot Mechanism

Each page renders its own sidebar content internally. AppShell provides a CSS grid layout with a sidebar area and a content area. Pages that need a sidebar render it as part of their component tree — the "slot" is a layout convention, not a React abstraction. Pages without a sidebar simply render full-width content. Sidebar collapse toggle is page-owned (TasksPage manages its own collapsed state).

### Key Principles

- **Single timer owner** — `useTimer()` is called exactly once in AppShell. Timer state and callbacks flow down via Outlet context. No duplicate event listeners.
- **useBridge.ts unchanged** — hooks are self-contained; TasksPage calls the same hooks App.tsx calls today.
- **No Rust backend changes** — all changes are frontend-only.
- **Timer stop → WorkLog flow:** CompactTimer stop button → calls `onStop` prop → AppShell's `handleStopTimer()` → opens WorkLogDialog. The `timer-stopped` Tauri event listener also lives in AppShell, handling external stops (e.g., tray, notification).
- **Timer switch (start on different issue):** IssueDetail's "start timer" button → calls `startTimer` from Outlet context → AppShell's `handleStartTimer()` → if timer active, shows conflict dialog with `pendingRestart`, stops current timer, opens WorkLogDialog, then restarts on new issue after log.
- **Logout flow:** Login screen renders outside the router. Setting `isAuthenticated = false` unmounts the entire router tree (AppShell, TasksPage, etc.), naturally clearing all component state.

## Implementation Layers

### Layer 1: Shell + Router
- Install `react-router-dom`
- Create `AppShell.tsx` (top nav bar + sidebar slot + Outlet)
- Create `TopNavBar.tsx` (branding + tabs only — no timer/progress yet)
- Add React Router with single `/tasks` route rendering current App.tsx body
- App works identically after this step

### Layer 2: Extract & Slot
- Extract sidebar + detail pane from App.tsx into `TasksPage.tsx`
- Move branding, today progress, timer, settings into `TopNavBar.tsx`
- Create `CompactTimer.tsx` for nav bar timer display
- Wire sidebar into AppShell's sidebar slot for Tasks page
- Strip App.tsx down to auth + router

### Layer 3: Placeholder Pages
- Create `PlaceholderPage.tsx`
- Add routes for `/boards`, `/timesheets`, `/dashboard`
- Navigation works end-to-end across all tabs

## Testing Strategy

### Needs Tests

| Component | Test Focus |
|-----------|-----------|
| `AppShell.tsx` | Renders TopNavBar, renders page content via Outlet, sidebar slot works |
| `TopNavBar.tsx` | Correct active tab, timer rendering, progress bar, settings button |
| `CompactTimer.tsx` | Displays issue key + elapsed, stop button works, idle state |
| `TasksPage.tsx` | Issue list + detail pane render (written from scratch — no existing App.test.tsx to migrate) |
| Routing | `/` redirects to `/tasks`, tab navigation works, unknown routes handled |

### No New Tests Needed

- Unchanged components (IssueList, IssueDetail, etc.) — already tested
- useBridge.ts hooks — unchanged
- Rust backend — no changes

### Approach

Vitest + Testing Library, same patterns as existing tests. Mock `@tauri-apps/api` via existing `src/test/setup.ts`. Use `MemoryRouter` from React Router for route testing.

## Narrow Layout Sidebar Behavior

On narrow screens (< 1024px), sidebar visibility is page-owned. TasksPage manages its own mutual-exclusion logic (sidebar vs detail) using `selectedIssue` + `isNarrowLayout`, same as the current App.tsx behavior. Pages that don't provide a sidebar are automatically full-width.

## Pages Without Sidebar

When a page does not render sidebar content (e.g., PlaceholderPage, future Dashboard), the content area takes full width. No empty sidebar column is rendered — the CSS grid adjusts via the absence of the sidebar element.

## Deferred Items

- Keyboard shortcuts for tab navigation (Ctrl+1 through Ctrl+4)
- ARIA roles and accessibility for navigation
- Create issue button could move to TopNavBar in the future (for now stays in TasksPage sidebar)

## Future Backlog

These enhancements are deferred to later versions:
- Table/grid view for issues
- Advanced filters (status, priority, type, dates, custom fields)
- Saved filters/views (presets)
- Bulk actions (multi-select + batch operations)
- Column customization
- Sort controls

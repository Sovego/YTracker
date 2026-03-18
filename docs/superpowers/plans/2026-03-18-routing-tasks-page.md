# Routing & Tasks Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add React Router, a top navigation bar, and page-specific sidebar system to evolve the single-view app into a multi-page architecture with the current view as the Tasks page.

**Architecture:** Three incremental layers — (1) install router + create shell layout, (2) extract current App.tsx body into TasksPage + move chrome into TopNavBar, (3) add placeholder pages for future routes. Each layer preserves a working app.

**Tech Stack:** React Router v7 (HashRouter), React 19, Tailwind CSS 4, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-17-routing-tasks-page-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/components/AppShell.tsx` | Layout wrapper: TopNavBar + Outlet. Single owner of timer state, WorkLogDialog, SettingsDialog, today progress. Provides Outlet context. |
| `src/components/AppShell.test.tsx` | Tests for AppShell layout, context provision, dialog triggers. |
| `src/components/TopNavBar.tsx` | Presentational nav bar: branding, page tabs, progress, timer display, settings button. |
| `src/components/TopNavBar.test.tsx` | Tests for active tab, timer rendering, progress display. |
| `src/components/CompactTimer.tsx` | Compact timer display for nav bar. Props-only, no hooks. |
| `src/components/CompactTimer.test.tsx` | Tests for active/idle states, stop button. |
| `src/components/TasksPage.tsx` | Extracted issue list sidebar + detail pane. Owns selection, filters, sidebar collapse. |
| `src/components/TasksPage.test.tsx` | Tests for issue list rendering, filter application, sidebar behavior. |
| `src/components/PlaceholderPage.tsx` | "Coming Soon" page for future routes. |
| `src/components/PlaceholderPage.test.tsx` | Simple render test. |
| `src/types/shell.ts` | Shared types: `AppShellContext` interface, exported for use by AppShell and pages. |

### Modified Files

| File | Changes |
|------|---------|
| `src/App.tsx` | Strip to: auth check, boot screen, HashRouter setup with AppShell layout route. ~100 lines down from ~842. |
| `src/App.wave3.test.tsx` | Update to test routing setup (MemoryRouter wrapping). |
| `src/components/Timer.tsx` | Deleted. Replaced by CompactTimer.tsx. |
| `src/components/Timer.test.tsx` | Deleted. Replaced by CompactTimer.test.tsx. |

### Unchanged Files

All other components, hooks, utils, CSS, and Rust backend remain untouched.

---

## Task 1: Install React Router

**Files:**
- Modify: `ytracker-tauri/package.json`

- [ ] **Step 1: Install react-router-dom**

```bash
cd ytracker-tauri && npm install react-router-dom@^7
```

- [ ] **Step 2: Verify installation**

```bash
cd ytracker-tauri && node -e "console.log(require('./node_modules/react-router-dom/package.json').version)"
```

Expected: `7.x.x`

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd ytracker-tauri && npm run test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
cd ytracker-tauri && git add package.json package-lock.json && git commit -m "deps: add react-router-dom v7"
```

---

## Task 2: Create shared types

**Files:**
- Create: `src/types/shell.ts`

- [ ] **Step 1: Create the AppShellContext type file**

```typescript
// src/types/shell.ts
import type { TimerState } from "../hooks/useBridge";

/**
 * Context provided by AppShell to child routes via React Router's Outlet context.
 */
export interface AppShellContext {
  timerState: TimerState;
  startTimer: (issueKey: string, issueSummary: string) => void;
  stopTimer: () => Promise<void>;
  reportIssueKeys: (keys: string[]) => void;
  /** Incremented after a worklog is successfully submitted. Pages watch this to trigger refresh. */
  worklogSuccessCounter: number;
  /** Called by pages when they detect an auth-related API error. Triggers logout. */
  onAuthError: () => void;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ytracker-tauri && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd ytracker-tauri && git add src/types/shell.ts && git commit -m "feat: add AppShellContext type for router outlet context"
```

---

## Task 3: Create CompactTimer component

**Files:**
- Create: `src/components/CompactTimer.tsx`
- Create: `src/components/CompactTimer.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/CompactTimer.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompactTimer } from "./CompactTimer";

describe("CompactTimer", () => {
  it("shows idle state when timer is not active", () => {
    render(
      <CompactTimer
        state={{ active: false, issue_key: null, start_time: null, elapsed: 0 }}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText("No timer")).toBeInTheDocument();
    expect(screen.queryByTitle("Stop Timer")).not.toBeInTheDocument();
  });

  it("displays issue key and elapsed time when active", () => {
    render(
      <CompactTimer
        state={{
          active: true,
          issue_key: "PROJ-42",
          issue_summary: "Fix login",
          start_time: 1,
          elapsed: 1395,
        }}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText("PROJ-42")).toBeInTheDocument();
    expect(screen.getByText("00:23")).toBeInTheDocument();
  });

  it("calls onStop when stop button is clicked", () => {
    const onStop = vi.fn();

    render(
      <CompactTimer
        state={{
          active: true,
          issue_key: "PROJ-42",
          start_time: 1,
          elapsed: 60,
        }}
        onStop={onStop}
      />
    );

    fireEvent.click(screen.getByTitle("Stop Timer"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ytracker-tauri && npx vitest run src/components/CompactTimer.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write CompactTimer implementation**

```typescript
// src/components/CompactTimer.tsx
import type { TimerState } from "../hooks/useBridge";
import { Square } from "lucide-react";
import { formatDuration } from "../utils";

interface CompactTimerProps {
  state: TimerState;
  onStop: () => void;
}

/**
 * Compact timer display for the navigation bar.
 * Shows issue key + elapsed time when active, "No timer" when idle.
 */
export function CompactTimer({ state, onStop }: CompactTimerProps) {
  if (!state.active) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-400">
        No timer
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-blue-500/15 dark:bg-blue-500/20 px-3 py-1.5 rounded-lg border border-blue-500/30">
      <span className="text-blue-500 text-xs animate-pulse">●</span>
      <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 max-w-[100px] truncate">
        {state.issue_key}
      </span>
      <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
        {formatDuration(state.elapsed)}
      </span>
      <button
        onClick={onStop}
        className="p-1 rounded hover:bg-red-500/20 text-red-500 transition-colors"
        title="Stop Timer"
      >
        <Square className="w-3 h-3 fill-current" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ytracker-tauri && npx vitest run src/components/CompactTimer.test.tsx
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ytracker-tauri && git add src/components/CompactTimer.tsx src/components/CompactTimer.test.tsx && git commit -m "feat: add CompactTimer component for nav bar"
```

---

## Task 4: Create TopNavBar component

**Files:**
- Create: `src/components/TopNavBar.tsx`
- Create: `src/components/TopNavBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/TopNavBar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TopNavBar } from "./TopNavBar";

const defaultTimer = { active: false, issue_key: null, start_time: null, elapsed: 0 };

const renderNav = (props?: Partial<Parameters<typeof TopNavBar>[0]>) =>
  render(
    <MemoryRouter initialEntries={["/tasks"]}>
      <TopNavBar
        timerState={defaultTimer}
        onStopTimer={vi.fn()}
        todayTrackedSeconds={0}
        targetTodaySeconds={28800}
        loadingTodayProgress={false}
        onSettingsClick={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );

describe("TopNavBar", () => {
  it("renders branding and page tabs", () => {
    renderNav();

    expect(screen.getByText("YTracker")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Boards")).toBeInTheDocument();
    expect(screen.getByText("Timesheets")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("highlights active tab based on route", () => {
    renderNav();

    const tasksLink = screen.getByText("Tasks").closest("a");
    expect(tasksLink?.getAttribute("aria-current")).toBe("page");
  });

  it("shows today progress", () => {
    renderNav({ todayTrackedSeconds: 18000, targetTodaySeconds: 28800 });

    expect(screen.getByText(/5h/)).toBeInTheDocument();
  });

  it("renders compact timer when active", () => {
    renderNav({
      timerState: {
        active: true,
        issue_key: "PROJ-42",
        issue_summary: "Fix login",
        start_time: 1,
        elapsed: 120,
      },
    });

    expect(screen.getByText("PROJ-42")).toBeInTheDocument();
  });

  it("calls onSettingsClick when settings button is clicked", () => {
    const onSettingsClick = vi.fn();
    renderNav({ onSettingsClick });

    fireEvent.click(screen.getByTitle("Settings"));
    expect(onSettingsClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ytracker-tauri && npx vitest run src/components/TopNavBar.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write TopNavBar implementation**

```typescript
// src/components/TopNavBar.tsx
import { NavLink } from "react-router-dom";
import { Settings2 } from "lucide-react";
import type { TimerState } from "../hooks/useBridge";
import { CompactTimer } from "./CompactTimer";
import { formatDurationHuman } from "../utils";

interface TopNavBarProps {
  timerState: TimerState;
  onStopTimer: () => void;
  todayTrackedSeconds: number;
  targetTodaySeconds: number;
  loadingTodayProgress: boolean;
  onSettingsClick: () => void;
}

const navItems = [
  { to: "/tasks", label: "Tasks" },
  { to: "/boards", label: "Boards" },
  { to: "/timesheets", label: "Timesheets" },
  { to: "/dashboard", label: "Dashboard" },
];

/**
 * Top navigation bar with branding, page tabs, progress, timer, and settings.
 * Pure presentational — all data received via props.
 */
export function TopNavBar({
  timerState,
  onStopTimer,
  todayTrackedSeconds,
  targetTodaySeconds,
  loadingTodayProgress,
  onSettingsClick,
}: TopNavBarProps) {
  const progressPercent = targetTodaySeconds > 0
    ? Math.min(100, Math.round((todayTrackedSeconds / targetTodaySeconds) * 100))
    : 0;

  return (
    <nav className="h-11 flex items-center px-4 border-b border-white/60 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm flex-shrink-0">
      {/* Branding */}
      <span className="text-sm font-bold text-blue-600 dark:text-blue-400 mr-6 select-none">
        YTracker
      </span>

      {/* Page tabs */}
      <div className="flex items-center gap-1 h-full">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `px-3 h-full flex items-center text-xs font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-blue-500 text-slate-900 dark:text-white"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Right section: progress + timer + settings */}
      <div className="ml-auto flex items-center gap-3">
        {/* Today progress */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="w-16 h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800/80 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-[width] rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {loadingTodayProgress ? "..." : formatDurationHuman(todayTrackedSeconds)}
          </span>
        </div>

        {/* Timer */}
        <CompactTimer state={timerState} onStop={onStopTimer} />

        {/* Settings */}
        <button
          onClick={onSettingsClick}
          className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800/60 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          title="Settings"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ytracker-tauri && npx vitest run src/components/TopNavBar.test.tsx
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ytracker-tauri && git add src/components/TopNavBar.tsx src/components/TopNavBar.test.tsx && git commit -m "feat: add TopNavBar component with page tabs, progress, and timer"
```

---

## Task 5: Create PlaceholderPage component

**Files:**
- Create: `src/components/PlaceholderPage.tsx`
- Create: `src/components/PlaceholderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/PlaceholderPage.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceholderPage } from "./PlaceholderPage";

describe("PlaceholderPage", () => {
  it("renders the page title and coming soon message", () => {
    render(<PlaceholderPage title="Boards" />);

    expect(screen.getByText("Boards")).toBeInTheDocument();
    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ytracker-tauri && npx vitest run src/components/PlaceholderPage.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write PlaceholderPage implementation**

```typescript
// src/components/PlaceholderPage.tsx
interface PlaceholderPageProps {
  title: string;
}

/**
 * Placeholder page for routes not yet implemented.
 */
export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 min-h-[400px]">
      <h2 className="text-xl font-semibold text-slate-600 dark:text-slate-300 mb-2">{title}</h2>
      <p className="text-sm">Coming Soon</p>
      <p className="text-xs text-slate-400 mt-2">This feature is under development.</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ytracker-tauri && npx vitest run src/components/PlaceholderPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ytracker-tauri && git add src/components/PlaceholderPage.tsx src/components/PlaceholderPage.test.tsx && git commit -m "feat: add PlaceholderPage component for future routes"
```

---

## Task 6: Create AppShell component

This is the core layout component. It owns timer state, WorkLogDialog, SettingsDialog, today progress, and provides Outlet context.

**Files:**
- Create: `src/components/AppShell.tsx`
- Create: `src/components/AppShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/AppShell.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router-dom";
import type { AppShellContext } from "../types/shell";

const shellState = vi.hoisted(() => ({
  startMock: vi.fn(),
  stopMock: vi.fn().mockResolvedValue([0, null] as [number, string | null]),
  timer: {
    active: false,
    issue_key: null,
    issue_summary: null,
    start_time: null,
    elapsed: 0,
  },
  getTodayLoggedSecondsForIssuesMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("../hooks/useBridge", () => ({
  useTimer: () => ({
    state: shellState.timer,
    start: shellState.startMock,
    stop: shellState.stopMock,
  }),
  useConfig: () => ({
    config: { timer_notification_interval: 15, workday_hours: 8 },
  }),
  useIssueDetails: () => ({
    getTodayLoggedSecondsForIssues: shellState.getTodayLoggedSecondsForIssuesMock,
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn().mockResolvedValue("cancel"),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
}));

// Test child that reads Outlet context
function TestChild() {
  const ctx = useOutletContext<AppShellContext>();
  return (
    <div>
      <span data-testid="timer-active">{String(ctx.timerState.active)}</span>
      <button onClick={() => ctx.startTimer("TEST-1", "Test issue")}>Start</button>
      <button onClick={() => void ctx.stopTimer()}>Stop</button>
    </div>
  );
}

const renderShell = (initialRoute = "/tasks") =>
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route element={<AppShellImport />}>
          <Route path="/tasks" element={<TestChild />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

// Lazy import to allow mocks to settle
let AppShellImport: typeof import("./AppShell").AppShell = null!;

beforeEach(async () => {
  const mod = await import("./AppShell");
  AppShellImport = mod.AppShell;
});

describe("AppShell", () => {
  it("renders TopNavBar and child route", async () => {
    renderShell();

    expect(screen.getByText("YTracker")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("timer-active")).toHaveTextContent("false");
    });
  });

  it("provides timer context to child routes", async () => {
    renderShell();

    await waitFor(() => {
      expect(screen.getByTestId("timer-active")).toHaveTextContent("false");
    });
  });

  it("renders settings dialog when settings button clicked", async () => {
    renderShell();

    fireEvent.click(screen.getByTitle("Settings"));
    await waitFor(() => {
      expect(screen.getByText(/Account/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ytracker-tauri && npx vitest run src/components/AppShell.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write AppShell implementation**

This component takes on the state management currently in App.tsx lines 63-65, 82-89, 184-245, 418-469, 472-538, and dialogs at lines 807-836.

```typescript
// src/components/AppShell.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Outlet } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { useTimer, useConfig, useIssueDetails } from "../hooks/useBridge";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { TopNavBar } from "./TopNavBar";
import { WorkLogDialog } from "./WorkLogDialog";
import { SettingsDialog } from "./SettingsDialog";
import { getErrorSummary } from "../utils";
import type { AppShellContext } from "../types/shell";

type TimerStoppedPayload = {
  issue_key: string;
  elapsed: number;
};

interface AppShellProps {
  onLogout: () => void;
  isAuthenticated: boolean;
}

/**
 * Application shell: top nav bar + page content via Outlet.
 * Single owner of timer state, WorkLogDialog, SettingsDialog, today progress.
 */
export function AppShell({ onLogout, isAuthenticated }: AppShellProps) {
  const { state: timerState, start: invokeStartTimer, stop: invokeStopTimer } = useTimer();
  const { config } = useConfig();
  const { getTodayLoggedSecondsForIssues } = useIssueDetails();

  const [workLogData, setWorkLogData] = useState<{ key: string; elapsed: number } | null>(null);
  const [pendingRestart, setPendingRestart] = useState<{ key: string; summary: string } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loggedTodaySeconds, setLoggedTodaySeconds] = useState(0);
  const [loadingTodayProgress, setLoadingTodayProgress] = useState(false);
  const [worklogSuccessCounter, setWorklogSuccessCounter] = useState(0);
  const [reportedIssueKeys, setReportedIssueKeys] = useState<string[]>([]);

  const progressRefreshInFlightRef = useRef(false);

  // --- Notification permission check (mirrors original App.tsx lines 350-372) ---

  useEffect(() => {
    let cancelled = false;
    const ensurePermission = async () => {
      try {
        const granted = await isPermissionGranted();
        if (!granted) {
          console.warn("Notifications are disabled; timer reminders will be muted.");
        }
      } catch (err) {
        if (!cancelled) {
          console.warn(`Unable to check notification permission (${getErrorSummary(err)})`);
        }
      }
    };
    ensurePermission();
    return () => { cancelled = true; };
  }, []);

  // --- Today progress (uses state, not ref, so effects re-trigger on key changes) ---

  const refreshTodayProgress = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!isAuthenticated || reportedIssueKeys.length === 0) {
      setLoggedTodaySeconds(0);
      setLoadingTodayProgress(false);
      return;
    }

    if (progressRefreshInFlightRef.current) return;
    progressRefreshInFlightRef.current = true;

    const showLoading = options?.showLoading ?? true;
    let loadingTimer: ReturnType<typeof setTimeout> | null = null;
    if (showLoading) {
      loadingTimer = setTimeout(() => setLoadingTodayProgress(true), 250);
    }

    try {
      const total = await getTodayLoggedSecondsForIssues(reportedIssueKeys);
      setLoggedTodaySeconds(total);
    } catch {
      // Keep previous value on transient failures
    } finally {
      if (loadingTimer) clearTimeout(loadingTimer);
      if (showLoading) setLoadingTodayProgress(false);
      progressRefreshInFlightRef.current = false;
    }
  }, [isAuthenticated, reportedIssueKeys, getTodayLoggedSecondsForIssues]);

  useEffect(() => {
    void refreshTodayProgress({ showLoading: true });
  }, [refreshTodayProgress]);

  useEffect(() => {
    if (!isAuthenticated || reportedIssueKeys.length === 0) return;
    const interval = window.setInterval(() => {
      void refreshTodayProgress({ showLoading: false });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [isAuthenticated, reportedIssueKeys.length, refreshTodayProgress]);

  const workdayHours = Math.min(24, Math.max(1, config?.workday_hours ?? 8));
  const targetTodaySeconds = workdayHours * 3600;
  const todayTrackedSeconds = loggedTodaySeconds + (timerState.active ? timerState.elapsed : 0);

  // --- WorkLog dialog ---

  const openWorkLogDialog = useCallback((key: string, elapsed: number, restartTarget?: { key: string; summary: string }) => {
    setWorkLogData({ key, elapsed });
    setPendingRestart(restartTarget ?? null);
  }, []);

  const dismissWorkLogDialog = useCallback(() => {
    setWorkLogData(null);
    if (pendingRestart) {
      void invokeStartTimer(pendingRestart.key, pendingRestart.summary).catch((err) => {
        console.error(`Failed to restart timer after logging (${getErrorSummary(err)})`);
      });
      setPendingRestart(null);
    }
  }, [pendingRestart, invokeStartTimer]);

  const handleWorkLogSuccess = useCallback(() => {
    setWorklogSuccessCounter((prev) => prev + 1);
    dismissWorkLogDialog();
    void refreshTodayProgress({ showLoading: false });
  }, [dismissWorkLogDialog, refreshTodayProgress]);

  // --- Timer-stopped event listener ---

  useEffect(() => {
    const unlisten = listen<TimerStoppedPayload>("timer-stopped", (event) => {
      if (!isAuthenticated) return;
      const payload = event.payload;
      if (!payload.issue_key || payload.elapsed <= 0) return;
      openWorkLogDialog(payload.issue_key, payload.elapsed);
    });

    return () => {
      unlisten.then((dispose) => dispose()).catch((err) => {
        console.warn(`Failed to dispose timer-stopped listener (${getErrorSummary(err)})`);
      });
    };
  }, [isAuthenticated, openWorkLogDialog]);

  // --- Timer handlers ---

  const handleStopTimer = useCallback(async () => {
    const [elapsed, key] = await invokeStopTimer();
    if (key && elapsed > 0) {
      openWorkLogDialog(key, elapsed);
    }
  }, [invokeStopTimer, openWorkLogDialog]);

  const handleStartTimer = useCallback(async (issueKey: string, issueSummary: string) => {
    if (pendingRestart) setPendingRestart(null);

    if (timerState.active && timerState.issue_key && timerState.issue_key !== issueKey) {
      try {
        const activeLabel = timerState.issue_summary || timerState.issue_key;
        const dialogResult = await message(
          `Timer is already running for ${timerState.issue_key} — ${activeLabel}.`,
          {
            title: "Timer already running",
            kind: "warning",
            buttons: { yes: "Save & Start New", no: "Discard & Start New", cancel: "Cancel" },
          }
        );

        const decision = (dialogResult || "").toLowerCase();
        if (decision.includes("cancel")) return;

        if (decision.includes("discard") || decision === "no") {
          await invokeStopTimer();
          await invokeStartTimer(issueKey, issueSummary);
          return;
        }

        if (decision.includes("save") || decision === "yes" || decision === "ok") {
          const [elapsed, previousKey] = await invokeStopTimer();
          if (previousKey && elapsed > 0) {
            openWorkLogDialog(previousKey, elapsed, { key: issueKey, summary: issueSummary });
          } else {
            await invokeStartTimer(issueKey, issueSummary);
          }
          return;
        }

        return; // Closed without response — treat as cancel
      } catch (err) {
        console.error(`Timer conflict dialog failed (${getErrorSummary(err)})`);
        return;
      }
    }

    await invokeStartTimer(issueKey, issueSummary);
  }, [pendingRestart, timerState, invokeStartTimer, invokeStopTimer, openWorkLogDialog]);

  // --- Logout ---

  const handleLogout = useCallback(() => {
    setWorkLogData(null);
    setIsSettingsOpen(false);
    onLogout();
  }, [onLogout]);

  // --- Report issue keys (called by TasksPage) ---

  const handleReportIssueKeys = useCallback((keys: string[]) => {
    setReportedIssueKeys((prev) => {
      // Avoid unnecessary re-renders if keys haven't changed
      if (prev.length === keys.length && prev.every((k, i) => k === keys[i])) return prev;
      return keys;
    });
  }, []);

  // --- Outlet context ---

  const outletContext: AppShellContext = {
    timerState,
    startTimer: handleStartTimer,
    stopTimer: handleStopTimer,
    reportIssueKeys: handleReportIssueKeys,
    worklogSuccessCounter,
    onAuthError: handleLogout,
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-950">
      <TopNavBar
        timerState={timerState}
        onStopTimer={handleStopTimer}
        todayTrackedSeconds={todayTrackedSeconds}
        targetTodaySeconds={targetTodaySeconds}
        loadingTodayProgress={loadingTodayProgress}
        onSettingsClick={() => setIsSettingsOpen(true)}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Outlet context={outletContext} />
      </div>

      {workLogData && (
        <WorkLogDialog
          issueKey={workLogData.key}
          durationSeconds={workLogData.elapsed}
          onClose={dismissWorkLogDialog}
          onSuccess={handleWorkLogSuccess}
        />
      )}

      {isSettingsOpen && (
        <SettingsDialog
          onClose={() => setIsSettingsOpen(false)}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ytracker-tauri && npx vitest run src/components/AppShell.test.tsx
```

Expected: All tests PASS. Some tests may need adjustment for mocking details — fix any failures before proceeding.

- [ ] **Step 5: Commit**

```bash
cd ytracker-tauri && git add src/components/AppShell.tsx src/components/AppShell.test.tsx && git commit -m "feat: add AppShell layout with timer state, dialogs, and outlet context"
```

---

## Task 7: Create TasksPage component

Extract the sidebar + detail pane from App.tsx into TasksPage. This component reads timer callbacks from Outlet context.

**Files:**
- Create: `src/components/TasksPage.tsx`
- Create: `src/components/TasksPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/TasksPage.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, Outlet } from "react-router-dom";
import type { AppShellContext } from "../types/shell";

const tasksState = vi.hoisted(() => ({
  issue: {
    key: "YT-1",
    summary: "Test issue",
    description: "Desc",
    status: { key: "open", display: "Open" },
    priority: { key: "major", display: "Major" },
    tracked_seconds: null,
  },
  fetchIssuesMock: vi.fn().mockResolvedValue(true),
  loadMoreMock: vi.fn(),
  refreshCatalogsMock: vi.fn(),
  getTodayLoggedMock: vi.fn().mockResolvedValue(0),
  tracker: {
    issues: [] as Array<Record<string, unknown>>,
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null as string | null,
  },
}));

tasksState.tracker.issues = [tasksState.issue] as unknown as Array<Record<string, unknown>>;

vi.mock("../hooks/useBridge", () => ({
  useTracker: () => ({
    ...tasksState.tracker,
    fetchIssues: tasksState.fetchIssuesMock,
    loadMore: tasksState.loadMoreMock,
  }),
  useFilterCatalogs: () => ({
    queues: [],
    projects: [],
    users: [],
    loading: false,
    error: null,
    refresh: tasksState.refreshCatalogsMock,
  }),
  useIssueDetails: () => ({
    getTodayLoggedSecondsForIssues: tasksState.getTodayLoggedMock,
  }),
  checkSessionExists: vi.fn().mockResolvedValue(true),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
}));

const defaultContext: AppShellContext = {
  timerState: { active: false, issue_key: null, start_time: null, elapsed: 0 },
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  reportIssueKeys: vi.fn(),
  worklogSuccessCounter: 0,
  onAuthError: vi.fn(),
};

// Shell wrapper that provides outlet context
function ShellWrapper() {
  return <Outlet context={defaultContext} />;
}

let TasksPageImport: typeof import("./TasksPage").TasksPage = null!;

beforeEach(async () => {
  const mod = await import("./TasksPage");
  TasksPageImport = mod.TasksPage;
});

const renderTasks = () =>
  render(
    <MemoryRouter initialEntries={["/tasks"]}>
      <Routes>
        <Route element={<ShellWrapper />}>
          <Route path="/tasks" element={<TasksPageImport />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

describe("TasksPage", () => {
  it("renders issue list", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByText("YT-1")).toBeInTheDocument();
    });
  });

  it("shows empty state when no issue is selected", async () => {
    renderTasks();

    await waitFor(() => {
      expect(screen.getByText("Select an issue to view details")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ytracker-tauri && npx vitest run src/components/TasksPage.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write TasksPage implementation**

Extract the sidebar (App.tsx lines 561-762) and detail pane (lines 765-803) into TasksPage. Move all filter state, issue selection, and scroll logic here. Read timer callbacks from Outlet context.

The complete component follows. This is a direct extraction from App.tsx with these changes:
- Hooks `useTracker`, `useFilterCatalogs` called here (not in App.tsx)
- Timer state/callbacks come from `useOutletContext<AppShellContext>()`
- Removed: branding section, today progress section, TimerWidget, WorkLogDialog, SettingsDialog, auth handling, refreshTodayProgress
- Added: initial fetch on mount, `reportIssueKeys` effect, `worklogSuccessCounter` watcher for refresh
- Added: `isAuthRelatedError` check to signal auth failures

```typescript
// src/components/TasksPage.tsx
import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import {
  useTracker,
  Issue,
  useFilterCatalogs,
  type IssueSearchOptions,
  type TrackerFilterPayload,
} from "../hooks/useBridge";
import { IssueList } from "./IssueList";
import { IssueDetail } from "./IssueDetail";
import { Search, RefreshCw, ChevronDown, Plus } from "lucide-react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FilterSelect, type FilterOption } from "./FilterSelect";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { IssueListSkeleton, RefreshOverlay, IssueDetailPlaceholder } from "./Loaders";
import { getErrorSummary } from "../utils";
import type { AppShellContext } from "../types/shell";

const BASE_RESOLUTION_FILTER = "empty()";
const SELF_ASSIGNEE_VALUE = "me()";

const isAuthRelatedError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("access denied") ||
    normalized.includes("not authenticated") ||
    normalized.includes("sign in again") ||
    normalized.includes("failed to load stored token")
  );
};

/**
 * Tasks page: issue list sidebar + detail pane.
 * Reads timer state/callbacks from AppShell via Outlet context.
 */
export function TasksPage() {
  const { timerState, startTimer, stopTimer, reportIssueKeys, worklogSuccessCounter, onAuthError } =
    useOutletContext<AppShellContext>();

  const { issues, loading, loadingMore, hasMore, error, fetchIssues, loadMore } = useTracker();
  const {
    queues, projects, users,
    loading: catalogsLoading,
    error: catalogsError,
    refresh: refreshCatalogs,
  } = useFilterCatalogs(true);

  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [assigneeFilters, setAssigneeFilters] = useState<string[]>([SELF_ASSIGNEE_VALUE]);
  const [queueFilters, setQueueFilters] = useState<string[]>([]);
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [textFilter, setTextFilter] = useState("");
  const [activeSearchOptions, setActiveSearchOptions] = useState<IssueSearchOptions | undefined>({
    filter: { assignee: SELF_ASSIGNEE_VALUE, resolution: BASE_RESOLUTION_FILTER },
  });
  const [isCreateIssueOpen, setIsCreateIssueOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [detailKey, setDetailKey] = useState<string>("empty");
  const [detailRefreshTrigger, setDetailRefreshTrigger] = useState(0);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const initialFetchDoneRef = useRef(false);
  const isNarrowLayout = useMediaQuery("(max-width: 1023px)");
  const showDetailPlaceholder = loading && issues.length === 0;

  // --- Initial fetch on mount (was in App.tsx initialize()) ---
  const initialSearchOptions = useMemo<IssueSearchOptions>(() => ({
    filter: { assignee: SELF_ASSIGNEE_VALUE, resolution: BASE_RESOLUTION_FILTER },
  }), []);

  useEffect(() => {
    if (initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    void fetchIssues(initialSearchOptions).then((success) => {
      if (success) setActiveSearchOptions(initialSearchOptions);
    });
  }, [fetchIssues, initialSearchOptions]);

  // --- Auth error detection (mirrors original App.tsx lines 374-383) ---
  useEffect(() => {
    if (!error) return;
    if (isAuthRelatedError(error)) onAuthError();
  }, [error, onAuthError]);

  // --- Optimistic auth recovery ---
  useEffect(() => {
    if (issues.length > 0) {
      // If we got issues, session is valid — no action needed here,
      // but this mirrors the original App.tsx optimistic pattern.
    }
  }, [issues]);

  // --- Report issue keys to AppShell for today progress ---
  useEffect(() => {
    const keys = issues.map((i) => i.key);
    reportIssueKeys(keys);
  }, [issues, reportIssueKeys]);

  // --- Auto-collapse filters on narrow layout ---
  useEffect(() => {
    setFiltersExpanded(!isNarrowLayout);
  }, [isNarrowLayout]);

  // --- Computed filter options (from App.tsx lines 103-182) ---
  const queueOptions = useMemo<FilterOption[]>(() => {
    return queues
      .filter((queue) => queue.key && queue.display)
      .map((queue) => ({ id: queue.key, label: queue.display }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [queues]);

  const projectOptions = useMemo<FilterOption[]>(() => {
    return projects
      .filter((project) => project.key && project.display)
      .map((project) => ({ id: project.key, label: project.display }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  const userOptions = useMemo<FilterOption[]>(() => {
    const mapped: FilterOption[] = [];
    users.forEach((user) => {
      const id = user.login ?? user.email ?? undefined;
      if (!id) return;
      const label = user.display ?? id;
      const description = user.email && user.email !== id ? user.email : undefined;
      mapped.push({ id, label, description });
    });
    mapped.sort((a, b) => a.label.localeCompare(b.label));
    return [
      { id: SELF_ASSIGNEE_VALUE, label: "Assigned to me", description: "Uses me()" },
      ...mapped,
    ];
  }, [users]);

  const filterPayload = useMemo<TrackerFilterPayload>(() => {
    const payload: TrackerFilterPayload = { resolution: BASE_RESOLUTION_FILTER };
    const coerce = (values: string[]) => (values.length === 1 ? values[0] : values);
    if (assigneeFilters.length > 0) payload.assignee = coerce(assigneeFilters);
    if (queueFilters.length > 0) payload.queue = coerce(queueFilters);
    if (projectFilters.length > 0) payload.project = coerce(projectFilters);
    return payload;
  }, [assigneeFilters, queueFilters, projectFilters]);

  const searchOptions = useMemo<IssueSearchOptions>(() => ({
    filter: filterPayload,
  }), [filterPayload]);

  const serializedActiveOptions = useMemo(() => JSON.stringify(activeSearchOptions ?? {}), [activeSearchOptions]);
  const serializedDraftOptions = useMemo(() => JSON.stringify(searchOptions ?? {}), [searchOptions]);
  const hasPendingFilterChanges = serializedActiveOptions !== serializedDraftOptions;

  const normalizedTextFilter = textFilter.trim().toLowerCase();
  const visibleIssues = useMemo(() => {
    if (!normalizedTextFilter) return issues;
    const tokens = normalizedTextFilter.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return issues;
    return issues.filter((issue) => {
      const haystack = [issue.key, issue.summary, issue.description, issue.status.display, issue.priority.display]
        .filter(Boolean).join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [issues, normalizedTextFilter]);

  // --- Handlers (from App.tsx) ---
  const triggerLoadMore = useCallback(() => {
    if (loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    void loadMore().finally(() => { loadMoreInFlightRef.current = false; });
  }, [loadMore]);

  const maybeTriggerLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    const container = listContainerRef.current;
    if (!container) return;
    const totalScrollable = container.scrollHeight - container.clientHeight;
    if (totalScrollable <= 0) return;
    const remaining = totalScrollable - container.scrollTop;
    const threshold = Math.max(container.clientHeight * 0.15, 160);
    if (remaining <= threshold) triggerLoadMore();
  }, [hasMore, loading, loadingMore, triggerLoadMore]);

  const handleListScroll = useCallback(() => {
    const container = listContainerRef.current;
    if (!container) return;
    const currentTop = container.scrollTop;
    const scrollingDown = currentTop > lastScrollTopRef.current;
    lastScrollTopRef.current = currentTop;
    if (!scrollingDown) return;
    maybeTriggerLoadMore();
  }, [maybeTriggerLoadMore]);

  const handleLocalSearchSubmit = (e: FormEvent) => { e.preventDefault(); };

  const handleApplyFilters = useCallback(async () => {
    const success = await fetchIssues(searchOptions);
    if (success) {
      setActiveSearchOptions(searchOptions);
      setSelectedIssue(null);
      setTextFilter("");
    }
  }, [fetchIssues, searchOptions]);

  const refreshActiveIssues = useCallback(() => {
    void fetchIssues(activeSearchOptions ?? searchOptions);
  }, [fetchIssues, activeSearchOptions, searchOptions]);

  // --- Sync selected issue with refreshed list ---
  useEffect(() => {
    if (!selectedIssue) return;
    const updated = issues.find((i) => i.key === selectedIssue.key);
    if (updated && updated !== selectedIssue) setSelectedIssue(updated);
  }, [issues, selectedIssue]);

  useEffect(() => {
    setDetailKey(selectedIssue?.key ?? "empty");
  }, [selectedIssue]);

  // --- Refresh on worklog success (counter incremented by AppShell) ---
  const prevWorklogCounterRef = useRef(worklogSuccessCounter);
  useEffect(() => {
    if (worklogSuccessCounter > prevWorklogCounterRef.current) {
      prevWorklogCounterRef.current = worklogSuccessCounter;
      refreshActiveIssues();
      setDetailRefreshTrigger((prev) => prev + 1);
    }
  }, [worklogSuccessCounter, refreshActiveIssues]);

  // --- JSX ---
  return (
    <div className="glass-panel app-shell flex w-full flex-1 overflow-visible lg:overflow-hidden">
      <div className="flex flex-1 flex-col lg:flex-row min-h-0 w-full">
        {/* Sidebar */}
        <aside className={`${isNarrowLayout && selectedIssue ? "hidden lg:flex" : "flex"} w-full lg:w-[360px] border-b lg:border-b-0 lg:border-r border-white/60 dark:border-slate-800/70 bg-gradient-to-b from-white/95 via-white/75 to-white/60 dark:from-slate-900/80 dark:via-slate-900/60 dark:to-slate-900/40 flex-col flex-shrink-0 min-h-[260px]`}>
          {/* Filters section (no branding/progress — those are in TopNavBar) */}
          <div className="px-6 py-4 border-b border-white/50 dark:border-slate-800/60 space-y-4">
            <button
              type="button"
              onClick={() => setFiltersExpanded((value) => !value)}
              className="w-full inline-flex items-center justify-between rounded-xl border border-white/60 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/40 px-4 py-3 text-sm font-semibold text-slate-600 dark:text-slate-300"
            >
              <span>Filters</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${filtersExpanded ? "rotate-180" : ""}`} />
            </button>

            {filtersExpanded && (
              <>
                <form onSubmit={handleLocalSearchSubmit} className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter within loaded issues..."
                    value={textFilter}
                    onChange={(e) => setTextFilter(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-white/60 dark:border-slate-800/70 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 shadow-inner"
                  />
                </form>

                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <div className="flex-1 min-w-[180px]">
                      <FilterSelect label="Assignees" options={userOptions} selected={assigneeFilters} onChange={setAssigneeFilters} emptyLabel="Any assignee" loading={catalogsLoading} />
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <FilterSelect label="Queues" options={queueOptions} selected={queueFilters} onChange={setQueueFilters} emptyLabel="All queues" loading={catalogsLoading} />
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <FilterSelect label="Projects" options={projectOptions} selected={projectFilters} onChange={setProjectFilters} emptyLabel="All projects" loading={catalogsLoading} />
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => void handleApplyFilters()}
                        disabled={!hasPendingFilterChanges || loading}
                        className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition ${!hasPendingFilterChanges || loading ? "bg-white/40 dark:bg-slate-900/30 border-white/40 dark:border-slate-800/40 text-slate-400" : "bg-blue-600 text-white border-blue-500 hover:bg-blue-500"}`}
                      >
                        Apply
                      </button>
                      {hasPendingFilterChanges ? (
                        <span className="text-[11px] uppercase tracking-[0.3em] text-amber-500">Pending</span>
                      ) : (
                        <span className="text-[11px] uppercase tracking-[0.3em] text-emerald-500">Synced</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Showing</p>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  {visibleIssues.length} of {issues.length} issues
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={refreshActiveIssues} className="p-3 rounded-full bg-white/80 dark:bg-slate-900/70 border border-white/60 dark:border-slate-800/80 text-slate-600 hover:text-blue-600 transition-colors" title="Refresh">
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button onClick={() => setIsCreateIssueOpen(true)} className="p-3 rounded-full bg-blue-600 hover:bg-blue-700 border border-blue-500 text-white transition-colors" title="Create issue">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {catalogsError && (
              <div className="text-xs text-amber-600 bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-3 py-2">{catalogsError}</div>
            )}
            {error && (
              <div className="text-xs text-red-500 bg-red-50/70 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-xl px-3 py-2">{error}</div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 relative" ref={listContainerRef} onScroll={handleListScroll}>
            {loading && issues.length > 0 && <RefreshOverlay />}
            {loading && issues.length === 0 ? (
              <IssueListSkeleton />
            ) : issues.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">No issues found.</div>
            ) : visibleIssues.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">No matches for &quot;{textFilter.trim()}&quot;. Try adjusting the text filter.</div>
            ) : (
              <>
                <IssueList issues={visibleIssues} selectedKey={selectedIssue?.key ?? null} onSelect={setSelectedIssue} />
                <div className="py-4 flex justify-center">
                  {loadingMore ? (
                    <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />Loading more issues…
                    </div>
                  ) : hasMore ? (
                    <button type="button" onClick={() => triggerLoadMore()} className="text-xs font-semibold text-blue-600 hover:text-blue-500">Load more issues</button>
                  ) : (
                    <p className="text-xs text-slate-400">You&apos;re all caught up.</p>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="px-6 py-4 border-t border-white/60 dark:border-slate-800/70 text-xs text-slate-400" />
        </aside>

        {/* Main Content */}
        <main className={`${isNarrowLayout && !selectedIssue ? "hidden lg:flex" : "flex-1"} relative flex flex-col bg-gradient-to-br from-white/60 via-white/30 to-transparent dark:from-slate-900/40 dark:via-slate-900/20 min-h-0 overflow-hidden`}>
          {showDetailPlaceholder ? (
            <IssueDetailPlaceholder />
          ) : (
            <>
              {isNarrowLayout && selectedIssue && (
                <div className="p-4 border-b border-white/60 dark:border-slate-800/70 flex items-center justify-between lg:hidden">
                  <button onClick={() => setSelectedIssue(null)} className="px-3 py-2 rounded-full bg-slate-200/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-100 text-sm font-semibold">← Back</button>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Details</p>
                </div>
              )}
              <div key={detailKey} className="flex-1 min-h-0 animate-fadeUp">
                {selectedIssue ? (
                  <IssueDetail
                    issue={selectedIssue}
                    timerState={timerState}
                    onStart={startTimer}
                    onStop={stopTimer}
                    onIssueUpdate={refreshActiveIssues}
                    refreshTrigger={detailRefreshTrigger}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <div className="gtk-card w-20 h-20 rounded-full flex items-center justify-center mb-6">
                      <Search className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-lg font-medium">Select an issue to view details</p>
                    <p className="text-sm text-slate-500 mt-2">Choose one from the left pane to begin.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {isCreateIssueOpen && (
        <CreateIssueDialog
          onClose={() => setIsCreateIssueOpen(false)}
          onSuccess={(issue) => {
            setIsCreateIssueOpen(false);
            setSelectedIssue(issue);
            setDetailKey(issue.key);
            void refreshActiveIssues();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ytracker-tauri && npx vitest run src/components/TasksPage.test.tsx
```

Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd ytracker-tauri && npm run test
```

Expected: All existing tests still pass. TasksPage tests pass.

- [ ] **Step 6: Commit**

```bash
cd ytracker-tauri && git add src/components/TasksPage.tsx src/components/TasksPage.test.tsx && git commit -m "feat: extract TasksPage from App.tsx with sidebar and detail pane"
```

---

## Task 8: Rewrite App.tsx with router setup

Strip App.tsx to: auth check, boot screen, HashRouter with AppShell layout route.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.wave3.test.tsx`

- [ ] **Step 1: Update App.wave3.test.tsx for new App structure**

The test file needs to verify: (a) boot screen on initial load, (b) login screen when not authenticated, (c) router renders AppShell when authenticated.

```typescript
// src/App.wave3.test.tsx — rewrite for new App structure
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  checkSessionExistsMock: vi.fn().mockResolvedValue(true),
  fetchIssuesMock: vi.fn().mockResolvedValue(true),
  loadMoreMock: vi.fn(),
  refreshCatalogsMock: vi.fn(),
}));

vi.mock("./hooks/useBridge", () => ({
  checkSessionExists: appState.checkSessionExistsMock,
  useTracker: () => ({
    issues: [],
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    fetchIssues: appState.fetchIssuesMock,
    loadMore: appState.loadMoreMock,
  }),
  useTimer: () => ({
    state: { active: false, issue_key: null, start_time: null, elapsed: 0 },
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue([0, null]),
  }),
  useConfig: () => ({
    config: { timer_notification_interval: 15, workday_hours: 8 },
  }),
  useIssueDetails: () => ({
    getTodayLoggedSecondsForIssues: vi.fn().mockResolvedValue(0),
  }),
  useFilterCatalogs: () => ({
    queues: [],
    projects: [],
    users: [],
    loading: false,
    error: null,
    refresh: appState.refreshCatalogsMock,
  }),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn().mockResolvedValue("cancel"),
}));

describe("App", () => {
  let App: typeof import("./App").default;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("./App");
    App = mod.default;
  });

  it("shows login screen when session does not exist", async () => {
    appState.checkSessionExistsMock.mockResolvedValue(false);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/verification code/i)).toBeInTheDocument();
    });
  });

  it("renders app shell with navigation when authenticated", async () => {
    appState.checkSessionExistsMock.mockResolvedValue(true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("YTracker")).toBeInTheDocument();
      expect(screen.getByText("Tasks")).toBeInTheDocument();
    });
  });

  it("redirects from / to /tasks", async () => {
    appState.checkSessionExistsMock.mockResolvedValue(true);

    render(<App />);

    await waitFor(() => {
      // HashRouter: verify Tasks tab is active (has aria-current)
      const tasksLink = screen.getByText("Tasks").closest("a");
      expect(tasksLink?.getAttribute("aria-current")).toBe("page");
    });
  });
});
```

- [ ] **Step 2: Rewrite App.tsx**

```typescript
// src/App.tsx
import { useState, useEffect, useCallback } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { checkSessionExists } from "./hooks/useBridge";
import { Login } from "./components/Login";
import { AppShell } from "./components/AppShell";
import { TasksPage } from "./components/TasksPage";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { AppBootScreen } from "./components/Loaders";
import { getErrorSummary } from "./utils";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true); // Optimistic
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Check session existence on mount — just auth, no data fetching.
  // TasksPage handles its own initial issue fetch.
  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const hasSession = await checkSessionExists();
        if (!cancelled) setIsAuthenticated(hasSession);
      } catch (err) {
        console.warn(`Session check failed (${getErrorSummary(err)})`);
        if (!cancelled) setIsAuthenticated(false);
      } finally {
        if (!cancelled) setInitialLoadDone(true);
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  if (!initialLoadDone) {
    return (
      <AppBootScreen
        title="Launching workspace"
        subtitle="YTracker"
        caption="Connecting to Tracker services"
      />
    );
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell onLogout={handleLogout} isAuthenticated={isAuthenticated} />}>
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/boards" element={<PlaceholderPage title="Boards" />} />
          <Route path="/timesheets" element={<PlaceholderPage title="Timesheets" />} />
          <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
          <Route path="/" element={<Navigate to="/tasks" replace />} />
          <Route path="*" element={<Navigate to="/tasks" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
```

- [ ] **Step 3: Run tests**

```bash
cd ytracker-tauri && npm run test
```

Expected: All tests pass. If App.wave3 tests fail, adjust mocking to match the new App structure.

- [ ] **Step 4: Delete Timer.tsx and Timer.test.tsx**

```bash
cd ytracker-tauri && rm src/components/Timer.tsx src/components/Timer.test.tsx
```

- [ ] **Step 5: Verify no import references to Timer.tsx remain**

```bash
cd ytracker-tauri && grep -r "Timer" src/ --include="*.tsx" --include="*.ts" -l
```

Expected: Only CompactTimer references and `useTimer` in useBridge.ts. No `./Timer` or `Timer.tsx` imports.

- [ ] **Step 6: Run full test suite and typecheck**

```bash
cd ytracker-tauri && npx tsc --noEmit && npm run test
```

Expected: No type errors. All tests pass.

- [ ] **Step 7: Commit**

```bash
cd ytracker-tauri && git add src/App.tsx src/App.wave3.test.tsx && git rm src/components/Timer.tsx src/components/Timer.test.tsx && git commit -m "feat: rewrite App.tsx with HashRouter, AppShell layout, and route structure

Replace monolithic App.tsx with routing-based architecture:
- App.tsx handles auth + router setup (~80 lines, down from ~842)
- AppShell owns timer, dialogs, progress, outlet context
- TasksPage contains issue list sidebar + detail pane
- PlaceholderPage for future boards/timesheets/dashboard routes
- Delete Timer.tsx (replaced by CompactTimer in nav bar)"
```

---

## Task 9: Manual smoke test

- [ ] **Step 1: Run the full application**

```bash
cd ytracker-tauri && npm run tauri dev
```

- [ ] **Step 2: Verify these flows work**

1. App boots and shows login or tasks page (depending on session)
2. Top nav bar shows: YTracker branding, Tasks/Boards/Timesheets/Dashboard tabs
3. Tasks tab is active and highlighted
4. Issue list appears in sidebar
5. Selecting an issue shows detail pane
6. Timer start/stop works from issue detail
7. Compact timer appears in nav bar when active
8. Stopping timer opens WorkLogDialog
9. Clicking Boards/Timesheets/Dashboard tabs shows "Coming Soon" pages
10. Settings button in nav bar opens SettingsDialog
11. Narrow layout (<1024px width) collapses properly
12. Timer conflict dialog works (start timer on different issue while one is running)

- [ ] **Step 3: Fix any issues found during smoke test**

- [ ] **Step 4: Run test suite with coverage**

```bash
cd ytracker-tauri && npm run test:coverage
```

Expected: Coverage thresholds met (70% lines/statements, 60% branches/functions).

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
cd ytracker-tauri && git add -A && git commit -m "fix: address smoke test issues in routing refactor"
```

---

## Task Summary

| Task | Component | Layer |
|------|-----------|-------|
| 1 | Install react-router-dom | Setup |
| 2 | Shared types (AppShellContext) | Setup |
| 3 | CompactTimer | Layer 1 |
| 4 | TopNavBar | Layer 1 |
| 5 | PlaceholderPage | Layer 3 |
| 6 | AppShell | Layer 1+2 |
| 7 | TasksPage | Layer 2 |
| 8 | Rewrite App.tsx + cleanup | Layer 2+3 |
| 9 | Manual smoke test | Verification |

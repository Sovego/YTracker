import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const bridgeState = vi.hoisted(() => ({
  issue: {
    key: "YT-1",
    summary: "Issue one",
    description: "Desc",
    status: { key: "open", display: "Open" },
    priority: { key: "major", display: "Major" },
    tracked_seconds: null,
  },
  checkSessionExistsMock: vi.fn(),
  fetchIssuesMock: vi.fn(),
  loadMoreMock: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
  getTodayLoggedSecondsForIssuesMock: vi.fn(),
  refreshCatalogsMock: vi.fn(),
  tracker: {
    issues: [] as Array<{
      key: string;
      summary: string;
      description: string;
      status: { key: string; display: string };
      priority: { key: string; display: string };
      tracked_seconds: null;
    }>,
    loading: false,
    loadingMore: false,
    hasMore: true,
    error: null as string | null,
  },
  timer: {
    active: false,
    issue_key: null,
    issue_summary: null,
    start_time: null,
    elapsed: 0,
  },
}));

bridgeState.tracker.issues = [bridgeState.issue];

vi.mock("./hooks/useBridge", () => ({
  useTracker: () => ({
    ...bridgeState.tracker,
    fetchIssues: bridgeState.fetchIssuesMock,
    loadMore: bridgeState.loadMoreMock,
  }),
  useTimer: () => ({
    state: bridgeState.timer,
    start: bridgeState.startMock,
    stop: bridgeState.stopMock,
  }),
  useConfig: () => ({
    config: {
      timer_notification_interval: 15,
      workday_hours: 8,
      workday_start_time: "09:00",
      workday_end_time: "17:00",
    },
  }),
  useIssueDetails: () => ({
    getTodayLoggedSecondsForIssues: bridgeState.getTodayLoggedSecondsForIssuesMock,
  }),
  checkSessionExists: bridgeState.checkSessionExistsMock,
  useFilterCatalogs: () => ({
    queues: [],
    projects: [],
    users: [],
    priorities: [],
    issueTypes: [],
    loading: false,
    error: null,
    refresh: bridgeState.refreshCatalogsMock,
  }),
}));

vi.mock("./hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(async () => "cancel"),
}));

vi.mock("./components/IssueList", () => ({
  IssueList: ({
    issues,
    onSelect,
  }: {
    issues: typeof bridgeState.tracker.issues;
    onSelect: (v: (typeof bridgeState.tracker.issues)[number]) => void;
  }) => (
    <div>
      {issues.map((it) => (
        <button key={it.key} onClick={() => onSelect(it)}>
          pick-{it.key}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./components/IssueDetail", () => ({
  IssueDetail: ({ issue }: { issue: { key: string } }) => <div>detail-{issue.key}</div>,
}));

vi.mock("./components/Login", () => ({
  Login: ({ onLoginSuccess }: { onLoginSuccess: () => void }) => (
    <button onClick={onLoginSuccess}>login-success</button>
  ),
}));

vi.mock("./components/Timer", () => ({
  TimerWidget: () => <div>timer-widget</div>,
}));

vi.mock("./components/WorkLogDialog", () => ({
  WorkLogDialog: ({ issueKey }: { issueKey: string }) => <div>worklog-{issueKey}</div>,
}));

vi.mock("./components/SettingsDialog", () => ({
  SettingsDialog: ({ onLogout }: { onLogout: () => void }) => (
    <button onClick={onLogout}>settings-logout</button>
  ),
}));

vi.mock("./components/Loaders", () => ({
  AppBootScreen: () => <div>boot-screen</div>,
  IssueListSkeleton: () => <div>issue-list-skeleton</div>,
  RefreshOverlay: () => <div>refresh-overlay</div>,
  IssueDetailPlaceholder: () => <div>detail-placeholder</div>,
}));

describe("App wave3", () => {
  beforeEach(() => {
    bridgeState.checkSessionExistsMock.mockReset();
    bridgeState.fetchIssuesMock.mockReset();
    bridgeState.loadMoreMock.mockReset();
    bridgeState.startMock.mockReset();
    bridgeState.stopMock.mockReset();
    bridgeState.getTodayLoggedSecondsForIssuesMock.mockReset();
    bridgeState.refreshCatalogsMock.mockReset();

    bridgeState.tracker.issues = [bridgeState.issue];
    bridgeState.tracker.loading = false;
    bridgeState.tracker.loadingMore = false;
    bridgeState.tracker.hasMore = true;
    bridgeState.tracker.error = null;

    bridgeState.getTodayLoggedSecondsForIssuesMock.mockResolvedValue(0);
    bridgeState.checkSessionExistsMock.mockResolvedValue(true);
    bridgeState.fetchIssuesMock.mockResolvedValue(true);
    bridgeState.loadMoreMock.mockResolvedValue(true);
  });

  it("shows boot screen while auth bootstrap is pending", () => {
    bridgeState.checkSessionExistsMock.mockReturnValue(new Promise<boolean>(() => {}));
    bridgeState.getTodayLoggedSecondsForIssuesMock.mockReturnValue(new Promise<number>(() => {}));
    render(<App />);
    expect(screen.getByText("boot-screen")).toBeInTheDocument();
  });

  it("shows login when no session is available", async () => {
    bridgeState.checkSessionExistsMock.mockResolvedValue(false);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("login-success")).toBeInTheDocument();
    });
  });

  it("renders authenticated shell and supports selection/settings/load-more", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("YTracker")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("pick-YT-1"));
    expect(screen.getByText("detail-YT-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Settings"));
    expect(screen.getByText("settings-logout")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Load more issues"));
    expect(bridgeState.loadMoreMock).toHaveBeenCalledTimes(1);
  });
});

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
    useAuth: () => ({
        exchangeCode: vi.fn().mockResolvedValue(true),
        loading: false,
        error: null,
    }),
    useClientCredentials: () => ({
        info: { client_id: "test-client-id", has_client_secret: true },
        loading: false,
        error: null,
    }),
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
            expect(screen.getAllByText(/verification code/i).length).toBeGreaterThan(0);
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

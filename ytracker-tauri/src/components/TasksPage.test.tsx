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

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
        save: vi.fn(),
    }),
    useIssueDetails: () => ({
        getTodayLoggedSecondsForIssues: shellState.getTodayLoggedSecondsForIssuesMock,
    }),
    useAccount: () => ({
        profile: { display: "Test User", login: "testuser", email: "test@example.com" },
        loading: false,
        error: null,
        logout: vi.fn().mockResolvedValue(undefined),
    }),
    useUpdater: () => ({
        available: null,
        checking: false,
        installing: false,
        progress: null,
        lastCheckedAt: null,
        upToDate: false,
        error: null,
        installedVersion: null,
        checkForUpdates: vi.fn(),
        installUpdate: vi.fn(),
    }),
    useWorkLog: () => ({
        logWork: vi.fn().mockResolvedValue(true),
        loading: false,
        error: null,
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
                <Route element={<AppShellImport onLogout={vi.fn()} isAuthenticated={true} />}>
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
            // SettingsDialog renders "Account" as a section label and "Settings" as the heading
            expect(screen.getByText("Settings")).toBeInTheDocument();
            expect(screen.getAllByText(/Account/i).length).toBeGreaterThan(0);
        });
    });
});

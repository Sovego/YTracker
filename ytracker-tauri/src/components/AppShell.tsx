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

    // --- Notification permission check ---
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

    // --- Today progress ---
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

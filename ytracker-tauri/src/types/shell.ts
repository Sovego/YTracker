import type { TimerState } from "../hooks/useBridge";

/**
 * Context provided by AppShell to child routes via React Router's Outlet context.
 */
export interface AppShellContext {
    timerState: TimerState;
    startTimer: (issueKey: string, issueSummary: string) => Promise<void>;
    stopTimer: () => Promise<void>;
    reportIssueKeys: (keys: string[]) => void;
    /** Incremented after a worklog is successfully submitted. Pages watch this to trigger refresh. */
    worklogSuccessCounter: number;
    /** Called by pages when they detect an auth-related API error. Triggers logout. */
    onAuthError: () => void;
}

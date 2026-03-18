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
                aria-label="Stop Timer"
            >
                <Square className="w-3 h-3 fill-current" />
            </button>
        </div>
    );
}

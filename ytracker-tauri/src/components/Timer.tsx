import { TimerState } from "../hooks/useBridge";
import { Square, Clock } from "lucide-react";
import { formatDuration } from "../utils";

interface TimerWidgetProps {
    state: TimerState;
    onStop: () => void;
}

export function TimerWidget({ state, onStop }: TimerWidgetProps) {
    if (!state.active) {
        return null;
    }

    const issueLabel = state.issue_summary || state.issue_key;

    return (
        <div className="fixed bottom-6 right-6 glass-panel border border-white/70 dark:border-slate-800/70 shadow-2xl px-5 py-4 flex items-center gap-4 z-50">
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-500/20 flex items-center justify-center animate-pulse">
                    <Clock className="w-5 h-5" />
                </div>
                <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">
                        Tracking
                    </div>
                    <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-white">
                        {formatDuration(state.elapsed)}
                    </div>
                    {issueLabel && (
                        <div className="text-xs text-slate-500 dark:text-slate-300 max-w-[220px] truncate">
                            {issueLabel}
                        </div>
                    )}
                </div>
            </div>

            <button
                onClick={onStop}
                className="h-11 w-11 rounded-full bg-red-500/15 text-red-600 border border-red-500/30 flex items-center justify-center hover:bg-red-500/25"
                title="Stop Timer"
            >
                <Square className="w-5 h-5 fill-current" />
            </button>
        </div>
    );
}

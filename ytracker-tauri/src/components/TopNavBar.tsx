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

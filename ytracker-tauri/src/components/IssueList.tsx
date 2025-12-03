import type { ReactNode } from "react";
import { Issue } from "../hooks/useBridge";
import { cn } from "../utils";
import { AlertCircle, ArrowUp, ArrowDown, ArrowRight } from "lucide-react";

const STATUS_META: Record<string, { bar: string; pill: string; dot: string; text: string }> = {
    open: {
        bar: "bg-[#9e9e9e]/70",
        pill: "bg-[#9e9e9e]/10 text-slate-600",
        dot: "status-open",
        text: "Open"
    },
    inProgress: {
        bar: "bg-[#3584e4]/80",
        pill: "bg-[#3584e4]/15 text-[#1f5fbf]",
        dot: "status-inProgress",
        text: "In Progress"
    },
    inReview: {
        bar: "bg-[#f6d32d]/80",
        pill: "bg-[#f6d32d]/15 text-[#9a7b05]",
        dot: "status-inReview",
        text: "In Review"
    },
    needInfo: {
        bar: "bg-[#9141ac]/70",
        pill: "bg-[#9141ac]/15 text-[#6c2d7f]",
        dot: "status-needInfo",
        text: "Need Info"
    },
    readyForTest: {
        bar: "bg-[#ff7800]/70",
        pill: "bg-[#ff7800]/15 text-[#b95000]",
        dot: "status-readyForTest",
        text: "Ready for Test"
    },
    closed: {
        bar: "bg-[#2ec27e]/80",
        pill: "bg-[#2ec27e]/15 text-[#1f7f54]",
        dot: "status-closed",
        text: "Closed"
    },
    resolved: {
        bar: "bg-[#2ec27e]/80",
        pill: "bg-[#2ec27e]/15 text-[#1f7f54]",
        dot: "status-closed",
        text: "Resolved"
    },
    default: {
        bar: "bg-slate-300/70",
        pill: "bg-slate-200 text-slate-600",
        dot: "status-open",
        text: "Open"
    }
};

function getStatusMeta(key?: string) {
    if (!key) return STATUS_META.default;
    return STATUS_META[key as keyof typeof STATUS_META] || STATUS_META.default;
}

const PRIORITY_META: Record<string, { icon: ReactNode; wrapper: string; label: string }> = {
    critical: {
        icon: <AlertCircle className="w-4 h-4 priority-critical" />,
        wrapper: "priority-critical",
        label: "Critical"
    },
    blocker: {
        icon: <AlertCircle className="w-4 h-4 priority-critical" />,
        wrapper: "priority-critical",
        label: "Blocker"
    },
    major: {
        icon: <ArrowUp className="w-4 h-4 priority-major" />,
        wrapper: "priority-major",
        label: "Major"
    },
    minor: {
        icon: <ArrowDown className="w-4 h-4 text-green-500" />,
        wrapper: "text-green-500",
        label: "Minor"
    },
    trivial: {
        icon: <ArrowDown className="w-4 h-4 text-slate-400" />,
        wrapper: "text-slate-400",
        label: "Trivial"
    },
    default: {
        icon: <ArrowRight className="w-4 h-4 text-slate-400" />,
        wrapper: "text-slate-400",
        label: "Normal"
    }
};

function getPriorityMeta(key?: string) {
    if (!key) return PRIORITY_META.default;
    return PRIORITY_META[key as keyof typeof PRIORITY_META] || PRIORITY_META.default;
}

interface IssueListProps {
    issues: Issue[];
    selectedKey: string | null;
    onSelect: (issue: Issue) => void;
}

export function IssueList({ issues, selectedKey, onSelect }: IssueListProps) {
    return (
        <div className="space-y-3">
            {issues.map((issue) => {
                const status = getStatusMeta(issue.status?.key);
                const priority = getPriorityMeta(issue.priority?.key);
                return (
                    <button
                        key={issue.key}
                        onClick={() => onSelect(issue)}
                        className={cn(
                            "w-full text-left flex gap-4 p-4 rounded-2xl border transition-all duration-200",
                            "bg-white/80 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900",
                            selectedKey === issue.key
                                ? "border-blue-400/60 shadow-[0_15px_30px_rgba(37,99,235,0.15)]"
                                : "border-white/60 dark:border-slate-800/60 hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
                        )}
                    >
                        <div className={cn("w-1 rounded-full", status.bar)}></div>
                        <div className="flex-1">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    <span className={priority.wrapper}>{priority.icon}</span>
                                    {issue.key}
                                </div>
                                <span className={cn("status-pill", status.pill)}>
                                    <span className={cn("status-dot", status.dot)}></span>
                                    {issue.status.display}
                                </span>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mt-2">
                                {issue.summary}
                            </p>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}


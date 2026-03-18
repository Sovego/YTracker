import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import {
    useTracker,
    Issue,
    useFilterCatalogs,
    type IssueSearchOptions,
    type TrackerFilterPayload,
} from "../hooks/useBridge";
import { IssueList } from "./IssueList";
import { IssueDetail } from "./IssueDetail";
import { Search, RefreshCw, ChevronDown, Plus } from "lucide-react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FilterSelect, type FilterOption } from "./FilterSelect";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { IssueListSkeleton, RefreshOverlay, IssueDetailPlaceholder } from "./Loaders";
import type { AppShellContext } from "../types/shell";

const BASE_RESOLUTION_FILTER = "empty()";
const SELF_ASSIGNEE_VALUE = "me()";

const isAuthRelatedError = (message: string) => {
    const normalized = message.toLowerCase();
    return (
        normalized.includes("unauthorized") ||
        normalized.includes("forbidden") ||
        normalized.includes("access denied") ||
        normalized.includes("not authenticated") ||
        normalized.includes("sign in again") ||
        normalized.includes("failed to load stored token")
    );
};

/**
 * Tasks page: issue list sidebar + detail pane.
 * Reads timer state/callbacks from AppShell via Outlet context.
 */
export function TasksPage() {
    const { timerState, startTimer, stopTimer, reportIssueKeys, worklogSuccessCounter, onAuthError } =
        useOutletContext<AppShellContext>();

    const { issues, loading, loadingMore, hasMore, error, fetchIssues, loadMore } = useTracker();
    const {
        queues, projects, users,
        loading: catalogsLoading,
        error: catalogsError,
    } = useFilterCatalogs(true);

    const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
    const [assigneeFilters, setAssigneeFilters] = useState<string[]>([SELF_ASSIGNEE_VALUE]);
    const [queueFilters, setQueueFilters] = useState<string[]>([]);
    const [projectFilters, setProjectFilters] = useState<string[]>([]);
    const [textFilter, setTextFilter] = useState("");
    const [activeSearchOptions, setActiveSearchOptions] = useState<IssueSearchOptions | undefined>({
        filter: { assignee: SELF_ASSIGNEE_VALUE, resolution: BASE_RESOLUTION_FILTER },
    });
    const [isCreateIssueOpen, setIsCreateIssueOpen] = useState(false);
    const [filtersExpanded, setFiltersExpanded] = useState(false);
    const [detailKey, setDetailKey] = useState<string>("empty");
    const [detailRefreshTrigger, setDetailRefreshTrigger] = useState(0);
    const listContainerRef = useRef<HTMLDivElement | null>(null);
    const loadMoreInFlightRef = useRef(false);
    const lastScrollTopRef = useRef(0);
    const initialFetchDoneRef = useRef(false);
    const isNarrowLayout = useMediaQuery("(max-width: 1023px)");
    const showDetailPlaceholder = loading && issues.length === 0;

    // --- Initial fetch on mount ---
    const initialSearchOptions = useMemo<IssueSearchOptions>(() => ({
        filter: { assignee: SELF_ASSIGNEE_VALUE, resolution: BASE_RESOLUTION_FILTER },
    }), []);

    useEffect(() => {
        if (initialFetchDoneRef.current) return;
        initialFetchDoneRef.current = true;
        void fetchIssues(initialSearchOptions).then((success) => {
            if (success) setActiveSearchOptions(initialSearchOptions);
        });
    }, [fetchIssues, initialSearchOptions]);

    // --- Auth error detection ---
    useEffect(() => {
        if (!error) return;
        if (isAuthRelatedError(error)) onAuthError();
    }, [error, onAuthError]);

    // --- Report issue keys to AppShell for today progress ---
    useEffect(() => {
        const keys = issues.map((i) => i.key);
        reportIssueKeys(keys);
    }, [issues, reportIssueKeys]);

    // --- Auto-collapse filters on narrow layout ---
    useEffect(() => {
        setFiltersExpanded(!isNarrowLayout);
    }, [isNarrowLayout]);

    // --- Computed filter options ---
    const queueOptions = useMemo<FilterOption[]>(() => {
        return queues
            .filter((queue) => queue.key && queue.display)
            .map((queue) => ({ id: queue.key, label: queue.display }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [queues]);

    const projectOptions = useMemo<FilterOption[]>(() => {
        return projects
            .filter((project) => project.key && project.display)
            .map((project) => ({ id: project.key, label: project.display }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [projects]);

    const userOptions = useMemo<FilterOption[]>(() => {
        const mapped: FilterOption[] = [];
        users.forEach((user) => {
            const id = user.login ?? user.email ?? undefined;
            if (!id) return;
            const label = user.display ?? id;
            const description = user.email && user.email !== id ? user.email : undefined;
            mapped.push({ id, label, description });
        });
        mapped.sort((a, b) => a.label.localeCompare(b.label));
        return [
            { id: SELF_ASSIGNEE_VALUE, label: "Assigned to me", description: "Uses me()" },
            ...mapped,
        ];
    }, [users]);

    const filterPayload = useMemo<TrackerFilterPayload>(() => {
        const payload: TrackerFilterPayload = { resolution: BASE_RESOLUTION_FILTER };
        const coerce = (values: string[]) => (values.length === 1 ? values[0] : values);
        if (assigneeFilters.length > 0) payload.assignee = coerce(assigneeFilters);
        if (queueFilters.length > 0) payload.queue = coerce(queueFilters);
        if (projectFilters.length > 0) payload.project = coerce(projectFilters);
        return payload;
    }, [assigneeFilters, queueFilters, projectFilters]);

    const searchOptions = useMemo<IssueSearchOptions>(() => ({
        filter: filterPayload,
    }), [filterPayload]);

    const serializedActiveOptions = useMemo(() => JSON.stringify(activeSearchOptions ?? {}), [activeSearchOptions]);
    const serializedDraftOptions = useMemo(() => JSON.stringify(searchOptions ?? {}), [searchOptions]);
    const hasPendingFilterChanges = serializedActiveOptions !== serializedDraftOptions;

    const normalizedTextFilter = textFilter.trim().toLowerCase();
    const visibleIssues = useMemo(() => {
        if (!normalizedTextFilter) return issues;
        const tokens = normalizedTextFilter.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return issues;
        return issues.filter((issue) => {
            const haystack = [issue.key, issue.summary, issue.description, issue.status.display, issue.priority.display]
                .filter(Boolean).join(" ").toLowerCase();
            return tokens.every((token) => haystack.includes(token));
        });
    }, [issues, normalizedTextFilter]);

    // --- Handlers ---
    const triggerLoadMore = useCallback(() => {
        if (loadMoreInFlightRef.current) return;
        loadMoreInFlightRef.current = true;
        void loadMore().finally(() => { loadMoreInFlightRef.current = false; });
    }, [loadMore]);

    const maybeTriggerLoadMore = useCallback(() => {
        if (!hasMore || loading || loadingMore) return;
        const container = listContainerRef.current;
        if (!container) return;
        const totalScrollable = container.scrollHeight - container.clientHeight;
        if (totalScrollable <= 0) return;
        const remaining = totalScrollable - container.scrollTop;
        const threshold = Math.max(container.clientHeight * 0.15, 160);
        if (remaining <= threshold) triggerLoadMore();
    }, [hasMore, loading, loadingMore, triggerLoadMore]);

    const handleListScroll = useCallback(() => {
        const container = listContainerRef.current;
        if (!container) return;
        const currentTop = container.scrollTop;
        const scrollingDown = currentTop > lastScrollTopRef.current;
        lastScrollTopRef.current = currentTop;
        if (!scrollingDown) return;
        maybeTriggerLoadMore();
    }, [maybeTriggerLoadMore]);

    const handleLocalSearchSubmit = (e: FormEvent) => { e.preventDefault(); };

    const handleApplyFilters = useCallback(async () => {
        const success = await fetchIssues(searchOptions);
        if (success) {
            setActiveSearchOptions(searchOptions);
            setSelectedIssue(null);
            setTextFilter("");
        }
    }, [fetchIssues, searchOptions]);

    const refreshActiveIssues = useCallback(() => {
        void fetchIssues(activeSearchOptions ?? searchOptions);
    }, [fetchIssues, activeSearchOptions, searchOptions]);

    // --- Sync selected issue with refreshed list ---
    useEffect(() => {
        if (!selectedIssue) return;
        const updated = issues.find((i) => i.key === selectedIssue.key);
        if (updated && updated !== selectedIssue) setSelectedIssue(updated);
    }, [issues, selectedIssue]);

    useEffect(() => {
        setDetailKey(selectedIssue?.key ?? "empty");
    }, [selectedIssue]);

    // --- Refresh on worklog success (counter incremented by AppShell) ---
    const prevWorklogCounterRef = useRef(worklogSuccessCounter);
    useEffect(() => {
        if (worklogSuccessCounter > prevWorklogCounterRef.current) {
            prevWorklogCounterRef.current = worklogSuccessCounter;
            refreshActiveIssues();
            setDetailRefreshTrigger((prev) => prev + 1);
        }
    }, [worklogSuccessCounter, refreshActiveIssues]);

    // --- JSX ---
    return (
        <div className="glass-panel app-shell flex w-full flex-1 overflow-visible lg:overflow-hidden">
            <div className="flex flex-1 flex-col lg:flex-row min-h-0 w-full">
                {/* Sidebar */}
                <aside className={`${isNarrowLayout && selectedIssue ? "hidden lg:flex" : "flex"} w-full lg:w-[360px] border-b lg:border-b-0 lg:border-r border-white/60 dark:border-slate-800/70 bg-gradient-to-b from-white/95 via-white/75 to-white/60 dark:from-slate-900/80 dark:via-slate-900/60 dark:to-slate-900/40 flex-col flex-shrink-0 min-h-[260px]`}>
                    {/* Filters section */}
                    <div className="px-6 py-4 border-b border-white/50 dark:border-slate-800/60 space-y-4">
                        <button
                            type="button"
                            onClick={() => setFiltersExpanded((value) => !value)}
                            className="w-full inline-flex items-center justify-between rounded-xl border border-white/60 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/40 px-4 py-3 text-sm font-semibold text-slate-600 dark:text-slate-300"
                        >
                            <span>Filters</span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${filtersExpanded ? "rotate-180" : ""}`} />
                        </button>

                        {filtersExpanded && (
                            <>
                                <form onSubmit={handleLocalSearchSubmit} className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Filter within loaded issues..."
                                        value={textFilter}
                                        onChange={(e) => setTextFilter(e.target.value)}
                                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-white/60 dark:border-slate-800/70 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 shadow-inner"
                                    />
                                </form>

                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-3">
                                        <div className="flex-1 min-w-[180px]">
                                            <FilterSelect label="Assignees" options={userOptions} selected={assigneeFilters} onChange={setAssigneeFilters} emptyLabel="Any assignee" loading={catalogsLoading} />
                                        </div>
                                        <div className="flex-1 min-w-[160px]">
                                            <FilterSelect label="Queues" options={queueOptions} selected={queueFilters} onChange={setQueueFilters} emptyLabel="All queues" loading={catalogsLoading} />
                                        </div>
                                        <div className="flex-1 min-w-[160px]">
                                            <FilterSelect label="Projects" options={projectOptions} selected={projectFilters} onChange={setProjectFilters} emptyLabel="All projects" loading={catalogsLoading} />
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                                            <button
                                                type="button"
                                                onClick={() => void handleApplyFilters()}
                                                disabled={!hasPendingFilterChanges || loading}
                                                className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition ${!hasPendingFilterChanges || loading ? "bg-white/40 dark:bg-slate-900/30 border-white/40 dark:border-slate-800/40 text-slate-400" : "bg-blue-600 text-white border-blue-500 hover:bg-blue-500"}`}
                                            >
                                                Apply
                                            </button>
                                            {hasPendingFilterChanges ? (
                                                <span className="text-[11px] uppercase tracking-[0.3em] text-amber-500">Pending</span>
                                            ) : (
                                                <span className="text-[11px] uppercase tracking-[0.3em] text-emerald-500">Synced</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Showing</p>
                                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                                    {visibleIssues.length} of {issues.length} issues
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={refreshActiveIssues} className="p-3 rounded-full bg-white/80 dark:bg-slate-900/70 border border-white/60 dark:border-slate-800/80 text-slate-600 hover:text-blue-600 transition-colors" title="Refresh">
                                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                                </button>
                                <button onClick={() => setIsCreateIssueOpen(true)} className="p-3 rounded-full bg-blue-600 hover:bg-blue-700 border border-blue-500 text-white transition-colors" title="Create issue">
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {catalogsError && (
                            <div className="text-xs text-amber-600 bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-3 py-2">{catalogsError}</div>
                        )}
                        {error && (
                            <div className="text-xs text-red-500 bg-red-50/70 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-xl px-3 py-2">{error}</div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-4 relative" ref={listContainerRef} onScroll={handleListScroll}>
                        {loading && issues.length > 0 && <RefreshOverlay />}
                        {loading && issues.length === 0 ? (
                            <IssueListSkeleton />
                        ) : issues.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">No issues found.</div>
                        ) : visibleIssues.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">No matches for &quot;{textFilter.trim()}&quot;. Try adjusting the text filter.</div>
                        ) : (
                            <>
                                <IssueList issues={visibleIssues} selectedKey={selectedIssue?.key ?? null} onSelect={setSelectedIssue} />
                                <div className="py-4 flex justify-center">
                                    {loadingMore ? (
                                        <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                                            <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />Loading more issues…
                                        </div>
                                    ) : hasMore ? (
                                        <button type="button" onClick={() => triggerLoadMore()} className="text-xs font-semibold text-blue-600 hover:text-blue-500">Load more issues</button>
                                    ) : (
                                        <p className="text-xs text-slate-400">You&apos;re all caught up.</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="px-6 py-4 border-t border-white/60 dark:border-slate-800/70 text-xs text-slate-400" />
                </aside>

                {/* Main Content */}
                <main className={`${isNarrowLayout && !selectedIssue ? "hidden lg:flex" : "flex-1"} relative flex flex-col bg-gradient-to-br from-white/60 via-white/30 to-transparent dark:from-slate-900/40 dark:via-slate-900/20 min-h-0 overflow-hidden`}>
                    {showDetailPlaceholder ? (
                        <IssueDetailPlaceholder />
                    ) : (
                        <>
                            {isNarrowLayout && selectedIssue && (
                                <div className="p-4 border-b border-white/60 dark:border-slate-800/70 flex items-center justify-between lg:hidden">
                                    <button onClick={() => setSelectedIssue(null)} className="px-3 py-2 rounded-full bg-slate-200/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-100 text-sm font-semibold">← Back</button>
                                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Details</p>
                                </div>
                            )}
                            <div key={detailKey} className="flex-1 min-h-0 animate-fadeUp">
                                {selectedIssue ? (
                                    <IssueDetail
                                        issue={selectedIssue}
                                        timerState={timerState}
                                        onStart={startTimer}
                                        onStop={stopTimer}
                                        onIssueUpdate={refreshActiveIssues}
                                        refreshTrigger={detailRefreshTrigger}
                                    />
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                        <div className="gtk-card w-20 h-20 rounded-full flex items-center justify-center mb-6">
                                            <Search className="w-8 h-8 text-slate-400" />
                                        </div>
                                        <p className="text-lg font-medium">Select an issue to view details</p>
                                        <p className="text-sm text-slate-500 mt-2">Choose one from the left pane to begin.</p>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </main>
            </div>

            {isCreateIssueOpen && (
                <CreateIssueDialog
                    onClose={() => setIsCreateIssueOpen(false)}
                    onSuccess={(issue) => {
                        setIsCreateIssueOpen(false);
                        setSelectedIssue(issue);
                        setDetailKey(issue.key);
                        void refreshActiveIssues();
                    }}
                />
            )}
        </div>
    );
}

/**
 * Main application shell for YTracker desktop client.
 *
 * Coordinates authentication bootstrap, issue list paging, selection state,
 * timer lifecycle, and modal/dialog surfaces for the UI.
 */
import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from "react";
import {
  useTracker,
  Issue,
  useTimer,
  useConfig,
  useIssueDetails,
  checkSessionExists,
  useFilterCatalogs,
  type IssueSearchOptions,
  type TrackerFilterPayload,
} from "./hooks/useBridge";
import { IssueList } from "./components/IssueList";
import { IssueDetail } from "./components/IssueDetail";
import { Login } from "./components/Login";
import { TimerWidget } from "./components/Timer";
import { WorkLogDialog } from "./components/WorkLogDialog";
import { Search, RefreshCw, Settings2, ChevronDown } from "lucide-react";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { SettingsDialog } from "./components/SettingsDialog";
import { message } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { AppBootScreen, IssueListSkeleton, RefreshOverlay, IssueDetailPlaceholder } from "./components/Loaders";
import { FilterSelect, type FilterOption } from "./components/FilterSelect";
import { formatDurationHuman, getErrorSummary } from "./utils";

/** Default resolution filter that hides resolved/closed issues in main list. */
const BASE_RESOLUTION_FILTER = "empty()";
/** Shortcut token resolved by backend to currently authenticated user. */
const SELF_ASSIGNEE_VALUE = "me()";

type TimerStoppedPayload = {
  issue_key: string;
  elapsed: number;
};

/** Detects auth/session-related errors that should trigger re-auth UX. */
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

/** Root UI component orchestrating auth, issue list, details, and timer flows. */
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true); // Start optimistic
  const [authChecked, setAuthChecked] = useState(false);
  const { issues, loading, loadingMore, hasMore, error, fetchIssues, loadMore } = useTracker();
  const { state: timerState, start: invokeStartTimer, stop: invokeStopTimer } = useTimer();
  const { config } = useConfig();
  const { getTodayLoggedSecondsForIssues } = useIssueDetails();
  const {
    queues,
    projects,
    users,
    loading: catalogsLoading,
    error: catalogsError,
    refresh: refreshCatalogs,
  } = useFilterCatalogs(authChecked && isAuthenticated);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [assigneeFilters, setAssigneeFilters] = useState<string[]>([SELF_ASSIGNEE_VALUE]);
  const [queueFilters, setQueueFilters] = useState<string[]>([]);
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [textFilter, setTextFilter] = useState("");
  const [activeSearchOptions, setActiveSearchOptions] = useState<IssueSearchOptions | undefined>({
    filter: { assignee: SELF_ASSIGNEE_VALUE, resolution: BASE_RESOLUTION_FILTER },
  });
  const [workLogData, setWorkLogData] = useState<{ key: string, elapsed: number } | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [loggedTodaySeconds, setLoggedTodaySeconds] = useState(0);
  const [loadingTodayProgress, setLoadingTodayProgress] = useState(false);
  const [pendingRestart, setPendingRestart] = useState<{ key: string; summary: string } | null>(null);
  const [detailKey, setDetailKey] = useState<string>("empty");
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const progressRefreshInFlightRef = useRef(false);
  const isNarrowLayout = useMediaQuery("(max-width: 1023px)");
  const showDetailPlaceholder = loading && issues.length === 0;

  useEffect(() => {
    setFiltersExpanded(!isNarrowLayout);
  }, [isNarrowLayout]);

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
      if (!id) {
        return;
      }
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
    if (assigneeFilters.length > 0) {
      payload.assignee = coerce(assigneeFilters);
    }
    if (queueFilters.length > 0) {
      payload.queue = coerce(queueFilters);
    }
    if (projectFilters.length > 0) {
      payload.project = coerce(projectFilters);
    }
    return payload;
  }, [assigneeFilters, queueFilters, projectFilters]);

  const searchOptions = useMemo<IssueSearchOptions>(() => ({
    filter: filterPayload,
  }), [filterPayload]);

  const initialSearchOptionsRef = useRef<IssueSearchOptions>(searchOptions);

  const serializedActiveOptions = useMemo(() => JSON.stringify(activeSearchOptions ?? {}), [activeSearchOptions]);
  const serializedDraftOptions = useMemo(() => JSON.stringify(searchOptions ?? {}), [searchOptions]);
  const hasPendingFilterChanges = serializedActiveOptions !== serializedDraftOptions;

  const normalizedTextFilter = textFilter.trim().toLowerCase();
  const visibleIssues = useMemo(() => {
    if (!normalizedTextFilter) {
      return issues;
    }
    const tokens = normalizedTextFilter.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return issues;
    }
    return issues.filter((issue) => {
      const haystack = [
        issue.key,
        issue.summary,
        issue.description,
        issue.status.display,
        issue.priority.display,
      ]
        .filter((value) => Boolean(value))
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [issues, normalizedTextFilter]);

  const refreshTodayProgress = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!isAuthenticated || issues.length === 0) {
      setLoggedTodaySeconds(0);
      setLoadingTodayProgress(false);
      return;
    }

    if (progressRefreshInFlightRef.current) {
      return;
    }

    progressRefreshInFlightRef.current = true;

    const showLoading = options?.showLoading ?? true;
    let loadingTimer: ReturnType<typeof setTimeout> | null = null;
    if (showLoading) {
      loadingTimer = setTimeout(() => {
        setLoadingTodayProgress(true);
      }, 250);
    }

    const keys = Array.from(new Set(issues.map((issue) => issue.key)));
    try {
      const total = await getTodayLoggedSecondsForIssues(keys);
      setLoggedTodaySeconds(total);
    } catch {
      // Keep previous value on transient failures instead of dropping to zero.
    } finally {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
      }
      if (showLoading) {
        setLoadingTodayProgress(false);
      }
      progressRefreshInFlightRef.current = false;
    }
  }, [isAuthenticated, issues, getTodayLoggedSecondsForIssues]);

  useEffect(() => {
    void refreshTodayProgress({ showLoading: true });
  }, [refreshTodayProgress]);

  useEffect(() => {
    if (!isAuthenticated || issues.length === 0 || typeof window === "undefined") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshTodayProgress({ showLoading: false });
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isAuthenticated, issues.length, refreshTodayProgress]);

  const workdayHours = Math.min(24, Math.max(1, config?.workday_hours ?? 8));
  const targetTodaySeconds = workdayHours * 3600;
  const todayTrackedSeconds = loggedTodaySeconds + (timerState.active ? timerState.elapsed : 0);
  const todayTrackedPercent = targetTodaySeconds > 0
    ? Math.min(100, Math.round((todayTrackedSeconds / targetTodaySeconds) * 100))
    : 0;

  // Initial check - ensure we have a session before fetching issues.
  useEffect(() => {
    let cancelled = false;

    /** Performs auth-first bootstrap before initial issue fetch. */
    const initialize = async () => {
      try {
        const hasSession = await checkSessionExists();
        if (!hasSession) {
          if (!cancelled) {
            setIsAuthenticated(false);
          }
          return;
        }

        const success = await fetchIssues(initialSearchOptionsRef.current);
        if (!cancelled) {
          setIsAuthenticated(success);
          if (success) {
            setActiveSearchOptions(initialSearchOptionsRef.current);
          }
        }
      } catch (err) {
        console.warn(`Initial issue load failed (${getErrorSummary(err)})`);
        if (!cancelled) {
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
          setInitialLoadDone(true);
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (issues.length > 0) {
      setIsAuthenticated(true);
    }
  }, [issues]);

  useEffect(() => {
    setDetailKey(selectedIssue?.key ?? "empty");
  }, [selectedIssue]);

  /** Starts guarded load-more operation and prevents concurrent pagination calls. */
  const triggerLoadMore = useCallback(() => {
    if (loadMoreInFlightRef.current) {
      return;
    }
    loadMoreInFlightRef.current = true;
    void loadMore().finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, [loadMore]);

  /** Triggers pagination when list scroll approaches bottom threshold. */
  const maybeTriggerLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    const container = listContainerRef.current;
    if (!container) return;
    const totalScrollable = container.scrollHeight - container.clientHeight;
    if (totalScrollable <= 0) {
      return;
    }
    const remaining = totalScrollable - container.scrollTop;
    const threshold = Math.max(container.clientHeight * 0.15, 160);
    if (remaining <= threshold) {
      triggerLoadMore();
    }
  }, [hasMore, loading, loadingMore, triggerLoadMore]);

  /** Scroll handler that only evaluates load-more when user scrolls downward. */
  const handleListScroll = useCallback(() => {
    const container = listContainerRef.current;
    if (!container) {
      return;
    }
    const currentTop = container.scrollTop;
    const scrollingDown = currentTop > lastScrollTopRef.current;
    lastScrollTopRef.current = currentTop;
    if (!scrollingDown) {
      return;
    }
    maybeTriggerLoadMore();
  }, [maybeTriggerLoadMore]);

  useEffect(() => {
    let cancelled = false;

    /** Checks notification permission used by timer reminder workflow. */
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

    return () => {
      cancelled = true;
    };
  }, []);

  // If we have a specific auth error, we should probably set isAuthenticated(false)
  useEffect(() => {
    if (!error) {
      return;
    }

    if (isAuthRelatedError(error)) {
      setIsAuthenticated(false);
    }
  }, [error]);

  /** Prevents native form submit; filtering is applied explicitly via controls. */
  const handleLocalSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  /** Applies current filter state to issue query and resets selected issue context. */
  const handleApplyFilters = useCallback(async () => {
    const success = await fetchIssues(searchOptions);
    if (success) {
      setActiveSearchOptions(searchOptions);
      setSelectedIssue(null);
      setTextFilter("");
    }
  }, [fetchIssues, searchOptions]);

  /** Handles post-login rehydration of catalogs and active issue query state. */
  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setAuthChecked(true);
    setActiveSearchOptions(searchOptions);
    setTextFilter("");
    void refreshCatalogs().catch((err) => {
      console.warn(`Catalog refresh after login failed (${getErrorSummary(err)})`);
      // Login flow still proceeds; catalog error is already handled in hook state/UI.
    });
    void fetchIssues(searchOptions);
  };

  /** Refreshes issue list using current active search options. */
  const refreshActiveIssues = useCallback(() => {
    void fetchIssues(activeSearchOptions ?? searchOptions);
  }, [fetchIssues, activeSearchOptions, searchOptions]);

  /** Opens worklog modal and optionally stores pending timer restart target. */
  const openWorkLogDialog = useCallback((key: string, elapsed: number, restartTarget?: { key: string; summary: string }) => {
    setWorkLogData({ key, elapsed });
    setPendingRestart(restartTarget ?? null);
  }, []);

  useEffect(() => {
    const unlisten = listen<TimerStoppedPayload>("timer-stopped", (event) => {
      if (!isAuthenticated) {
        return;
      }

      const payload = event.payload;
      if (!payload.issue_key || payload.elapsed <= 0) {
        return;
      }

      openWorkLogDialog(payload.issue_key, payload.elapsed);
    });

    return () => {
      unlisten.then((dispose) => dispose()).catch((err) => {
        console.warn(`Failed to dispose timer-stopped listener (${getErrorSummary(err)})`);
      });
    };
  }, [isAuthenticated, openWorkLogDialog]);

  /** Closes worklog modal and resumes pending timer when requested. */
  const dismissWorkLogDialog = () => {
    setWorkLogData(null);
    if (pendingRestart) {
      void invokeStartTimer(pendingRestart.key, pendingRestart.summary).catch((err) => {
        console.error(`Failed to restart timer after logging (${getErrorSummary(err)})`);
      });
      setPendingRestart(null);
    }
  };

  /** Refreshes active issues after successful worklog submission. */
  const handleWorkLogSuccess = () => {
    refreshActiveIssues();
    dismissWorkLogDialog();
  };

  /** Stops active timer and opens worklog dialog for captured duration. */
  const handleStopTimer = async () => {
    const [elapsed, key] = await invokeStopTimer();
    if (key && elapsed > 0) {
      openWorkLogDialog(key, elapsed);
    }
  };

  /** Starts timer for selected issue with conflict-resolution flow when already active. */
  const handleStartTimer = async (issueKey: string, issueSummary: string) => {
    if (pendingRestart) {
      setPendingRestart(null);
    }

    if (timerState.active && timerState.issue_key && timerState.issue_key !== issueKey) {
      try {
        const activeLabel = timerState.issue_summary || timerState.issue_key;
        const dialogResult = await message(
          `Timer is already running for ${timerState.issue_key} — ${activeLabel}.`,
          {
            title: "Timer already running",
            kind: "warning",
            buttons: {
              yes: "Save & Start New",
              no: "Discard & Start New",
              cancel: "Cancel"
            }
          }
        );

        const decision = (dialogResult || "").toLowerCase();

        if (decision.includes("cancel")) {
          return;
        }

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

        // If closed without a response, treat as cancel
        return;
      } catch (err) {
        console.error(`Timer conflict dialog failed (${getErrorSummary(err)})`);
        // As a fallback, do nothing to avoid losing data
        return;
      }
    }

    await invokeStartTimer(issueKey, issueSummary);
  };

  /** Resets UI/session state after logout callback from settings/account flow. */
  const handleLogout = () => {
    setIsAuthenticated(false);
    setSelectedIssue(null);
    setWorkLogData(null);
    setIsSettingsOpen(false);
    setAssigneeFilters([SELF_ASSIGNEE_VALUE]);
    setQueueFilters([]);
    setProjectFilters([]);
    setTextFilter("");
    setActiveSearchOptions({ filter: { assignee: SELF_ASSIGNEE_VALUE, resolution: BASE_RESOLUTION_FILTER } });
  };

  // Show loading screen on initial load
  if (!initialLoadDone) {
    return (
      <AppBootScreen
        title="Launching workspace"
        subtitle="YTracker"
        caption="Connecting to Tracker services"
      />
    );
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // If we are loading and have no data, show loading
  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <div className="glass-panel app-shell flex w-full min-h-screen lg:h-screen overflow-visible lg:overflow-hidden">
        <div className="flex flex-1 flex-col lg:flex-row min-h-0 w-full">
          {/* Sidebar */}
          <aside className={`${isNarrowLayout && selectedIssue ? "hidden lg:flex" : "flex"} w-full lg:w-[360px] border-b lg:border-b-0 lg:border-r border-white/60 dark:border-slate-800/70 bg-gradient-to-b from-white/95 via-white/75 to-white/60 dark:from-slate-900/80 dark:via-slate-900/60 dark:to-slate-900/40 flex-col flex-shrink-0 min-h-[260px]`}>
            <div className="px-6 pt-8 pb-6 border-b border-white/60 dark:border-slate-800/70">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.45em] uppercase text-slate-400 mb-2">
                    Tracker
                  </p>
                  <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">YTracker</h1>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="p-3 rounded-full bg-white/70 dark:bg-slate-900/60 border border-white/70 dark:border-slate-800/70 text-slate-500 hover:text-blue-600 transition"
                  title="Settings"
                >
                  <Settings2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-b border-white/50 dark:border-slate-800/60 space-y-4">
              <div className="rounded-2xl border border-white/60 dark:border-slate-800/60 bg-white/60 dark:bg-slate-900/40 px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Today Progress</p>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                    {formatDurationHuman(todayTrackedSeconds)} / {formatDurationHuman(targetTodaySeconds)}
                  </span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-200/80 dark:bg-slate-800/80 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-[width]"
                    style={{ width: `${todayTrackedPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {loadingTodayProgress ? "Updating tracked time..." : `Goal: ${workdayHours}h workday`}
                </p>
              </div>

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
                        <FilterSelect
                          label="Assignees"
                          options={userOptions}
                          selected={assigneeFilters}
                          onChange={setAssigneeFilters}
                          emptyLabel="Any assignee"
                          loading={catalogsLoading}
                        />
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <FilterSelect
                          label="Queues"
                          options={queueOptions}
                          selected={queueFilters}
                          onChange={setQueueFilters}
                          emptyLabel="All queues"
                          loading={catalogsLoading}
                        />
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <FilterSelect
                          label="Projects"
                          options={projectOptions}
                          selected={projectFilters}
                          onChange={setProjectFilters}
                          emptyLabel="All projects"
                          loading={catalogsLoading}
                        />
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => void handleApplyFilters()}
                          disabled={!hasPendingFilterChanges || loading}
                          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition ${!hasPendingFilterChanges || loading
                            ? "bg-white/40 dark:bg-slate-900/30 border-white/40 dark:border-slate-800/40 text-slate-400"
                            : "bg-blue-600 text-white border-blue-500 hover:bg-blue-500"
                            }`}
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
                <button
                  onClick={refreshActiveIssues}
                  className="p-3 rounded-full bg-white/80 dark:bg-slate-900/70 border border-white/60 dark:border-slate-800/80 text-slate-600 hover:text-blue-600 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {catalogsError && (
                <div className="text-xs text-amber-600 bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-3 py-2">
                  {catalogsError}
                </div>
              )}

              {error && (
                <div className="text-xs text-red-500 bg-red-50/70 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            <div
              className="flex-1 overflow-y-auto px-4 py-4 relative"
              ref={listContainerRef}
              onScroll={handleListScroll}
            >
              {loading && issues.length > 0 && <RefreshOverlay />}
              {loading && issues.length === 0 ? (
                <IssueListSkeleton />
              ) : issues.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">
                  No issues found.
                </div>
              ) : visibleIssues.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">
                  No matches for "{textFilter.trim()}". Try adjusting the text filter.
                </div>
              ) : (
                <>
                  <IssueList
                    issues={visibleIssues}
                    selectedKey={selectedIssue?.key ?? null}
                    onSelect={setSelectedIssue}
                  />
                  <div className="py-4 flex justify-center">
                    {loadingMore ? (
                      <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                        Loading more issues…
                      </div>
                    ) : hasMore ? (
                      <button
                        type="button"
                        onClick={() => triggerLoadMore()}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-500"
                      >
                        Load more issues
                      </button>
                    ) : (
                      <p className="text-xs text-slate-400">You&apos;re all caught up.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/60 dark:border-slate-800/70 text-xs text-slate-400">
            </div>
          </aside>

          {/* Main Content */}
          <main className={`${isNarrowLayout && !selectedIssue ? "hidden lg:flex" : "flex-1"} relative flex flex-col bg-gradient-to-br from-white/60 via-white/30 to-transparent dark:from-slate-900/40 dark:via-slate-900/20 min-h-0 overflow-hidden`}>
            {showDetailPlaceholder ? (
              <IssueDetailPlaceholder />
            ) : (
              <>
                {isNarrowLayout && selectedIssue && (
                  <div className="p-4 border-b border-white/60 dark:border-slate-800/70 flex items-center justify-between lg:hidden">
                    <button
                      onClick={() => setSelectedIssue(null)}
                      className="px-3 py-2 rounded-full bg-slate-200/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-100 text-sm font-semibold"
                    >
                      ← Back
                    </button>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Details</p>
                  </div>
                )}
                <div key={detailKey} className="flex-1 min-h-0 animate-fadeUp">
                {selectedIssue ? (
                  <IssueDetail
                    issue={selectedIssue}
                    timerState={timerState}
                    onStart={handleStartTimer}
                    onStop={handleStopTimer}
                    onIssueUpdate={refreshActiveIssues}
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
      </div>

      <TimerWidget state={timerState} onStop={handleStopTimer} />

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

export default App;

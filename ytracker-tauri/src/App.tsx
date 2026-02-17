import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from "react";
import {
  useTracker,
  Issue,
  useTimer,
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
import { Search, RefreshCw, Settings2 } from "lucide-react";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { SettingsDialog } from "./components/SettingsDialog";
import { message } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { AppBootScreen, IssueListSkeleton, RefreshOverlay, IssueDetailPlaceholder } from "./components/Loaders";
import { FilterSelect, type FilterOption } from "./components/FilterSelect";

const BASE_RESOLUTION_FILTER = "empty()";
const SELF_ASSIGNEE_VALUE = "me()";

type TimerStoppedPayload = {
  issue_key: string;
  elapsed: number;
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true); // Start optimistic
  const [authChecked, setAuthChecked] = useState(false);
  const { issues, loading, loadingMore, hasMore, error, fetchIssues, loadMore } = useTracker();
  const { state: timerState, start: invokeStartTimer, stop: invokeStopTimer } = useTimer();
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
  const [pendingRestart, setPendingRestart] = useState<{ key: string; summary: string } | null>(null);
  const [detailKey, setDetailKey] = useState<string>("empty");
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const isNarrowLayout = useMediaQuery("(max-width: 1023px)");
  const showDetailPlaceholder = loading && issues.length === 0;

  const showDetailOverlay = isNarrowLayout && !!selectedIssue;

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

  useEffect(() => {
    if (!showDetailOverlay || typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [showDetailOverlay]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const originalOverflow = document.documentElement.style.overflow;
    if (showDetailOverlay) {
      document.documentElement.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
    }

    return () => {
      document.documentElement.style.overflow = originalOverflow;
    };
  }, [showDetailOverlay]);

  // Initial check - ensure we have a session before fetching issues.
  useEffect(() => {
    let cancelled = false;

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
        console.warn("Initial issue load failed", err);
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

  const triggerLoadMore = useCallback(() => {
    if (loadMoreInFlightRef.current) {
      return;
    }
    loadMoreInFlightRef.current = true;
    void loadMore().finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, [loadMore]);

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

    const ensurePermission = async () => {
      try {
        const granted = await isPermissionGranted();
        if (!granted) {
          console.warn("Notifications are disabled; timer reminders will be muted.");
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("Unable to check notification permission", err);
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

    const normalizedError = error.toLowerCase();
    if (
      normalizedError.includes("auth") ||
      normalizedError.includes("token") ||
      normalizedError.includes("unauthorized") ||
      normalizedError.includes("not authenticated") ||
      normalizedError.includes("sign in again")
    ) {
      setIsAuthenticated(false);
    }
  }, [error]);

  const handleLocalSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  const handleApplyFilters = useCallback(async () => {
    const success = await fetchIssues(searchOptions);
    if (success) {
      setActiveSearchOptions(searchOptions);
      setSelectedIssue(null);
      setTextFilter("");
    }
  }, [fetchIssues, searchOptions]);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setAuthChecked(true);
    setActiveSearchOptions(searchOptions);
    setTextFilter("");
    void refreshCatalogs(true).catch(() => {
      // Login flow still proceeds; catalog error is already handled in hook state/UI.
    });
    void fetchIssues(searchOptions);
  };

  const refreshActiveIssues = useCallback(() => {
    void fetchIssues(activeSearchOptions ?? searchOptions);
  }, [fetchIssues, activeSearchOptions, searchOptions]);

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
        console.warn("Failed to dispose timer-stopped listener", err);
      });
    };
  }, [isAuthenticated, openWorkLogDialog]);

  const dismissWorkLogDialog = () => {
    setWorkLogData(null);
    if (pendingRestart) {
      void invokeStartTimer(pendingRestart.key, pendingRestart.summary).catch((err) => {
        console.error("Failed to restart timer after logging", err);
      });
      setPendingRestart(null);
    }
  };

  const handleStopTimer = async () => {
    const [elapsed, key] = await invokeStopTimer();
    if (key && elapsed > 0) {
      openWorkLogDialog(key, elapsed);
    }
  };

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
        console.error("Timer conflict dialog failed", err);
        // As a fallback, do nothing to avoid losing data
        return;
      }
    }

    await invokeStartTimer(issueKey, issueSummary);
  };

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
          <aside className="w-full lg:w-[360px] border-b lg:border-b-0 lg:border-r border-white/60 dark:border-slate-800/70 bg-gradient-to-b from-white/95 via-white/75 to-white/60 dark:from-slate-900/80 dark:via-slate-900/60 dark:to-slate-900/40 flex flex-col flex-shrink-0 min-h-[260px]">
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
          <main className={`${isNarrowLayout && !selectedIssue ? "hidden lg:block" : "flex-1"} relative bg-gradient-to-br from-white/60 via-white/30 to-transparent dark:from-slate-900/40 dark:via-slate-900/20 min-h-0 ${showDetailOverlay ? "overflow-hidden" : "overflow-auto lg:overflow-hidden"}`}>
            {showDetailPlaceholder ? (
              <IssueDetailPlaceholder />
            ) : (!isNarrowLayout || !selectedIssue) && (
              <div key={detailKey} className="h-full animate-fadeUp">
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
            )}

            {showDetailOverlay && selectedIssue && (
              <div className="fixed inset-0 z-50 bg-gradient-to-br from-white/95 via-white/90 to-white/85 dark:from-slate-950/95 dark:via-slate-950/90 dark:to-slate-950/85 backdrop-blur-2xl lg:hidden animate-fadeUp">
                <div className="h-full flex flex-col">
                  <div className="p-4 border-b border-white/60 dark:border-slate-800/70 flex items-center justify-between">
                    <button
                      onClick={() => setSelectedIssue(null)}
                      className="px-3 py-2 rounded-full bg-slate-200/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-100 text-sm font-semibold"
                    >
                      ← Back
                    </button>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Details</p>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <IssueDetail
                      issue={selectedIssue}
                      timerState={timerState}
                      onStart={handleStartTimer}
                      onStop={handleStopTimer}
                      onIssueUpdate={refreshActiveIssues}
                    />
                  </div>
                </div>
              </div>
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
          onSuccess={dismissWorkLogDialog}
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

import { useState, useEffect, type FormEvent } from "react";
import { useTracker, Issue, useTimer, checkSessionExists } from "./hooks/useBridge";
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
import { AppBootScreen, IssueListSkeleton, RefreshOverlay, IssueDetailPlaceholder } from "./components/Loaders";

function App() {
  const { issues, loading, error, fetchIssues } = useTracker();
  const { state: timerState, start: invokeStartTimer, stop: invokeStopTimer } = useTimer();
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(true); // Start optimistic
  const [workLogData, setWorkLogData] = useState<{ key: string, elapsed: number } | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pendingRestart, setPendingRestart] = useState<{ key: string; summary: string } | null>(null);
  const [detailKey, setDetailKey] = useState<string>("empty");
  const isNarrowLayout = useMediaQuery("(max-width: 1023px)");
  const showDetailPlaceholder = loading && issues.length === 0;

  const showDetailOverlay = isNarrowLayout && !!selectedIssue;

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

        const success = await fetchIssues();
        if (!cancelled) {
          setIsAuthenticated(success);
        }
      } catch (err) {
        console.warn("Initial issue load failed", err);
        if (!cancelled) {
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
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
    if (error && (error.toLowerCase().includes("auth") || error.toLowerCase().includes("token"))) {
      setIsAuthenticated(false);
    }
  }, [error]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    fetchIssues(searchQuery || undefined);
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    fetchIssues();
  };

  const openWorkLogDialog = (key: string, elapsed: number, restartTarget?: { key: string; summary: string }) => {
    setWorkLogData({ key, elapsed });
    setPendingRestart(restartTarget ?? null);
  };

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
              <p className="text-[11px] font-semibold tracking-[0.45em] uppercase text-slate-400 mb-2">
                Tracker
              </p>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">YTracker</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Adwaita-inspired desktop board
              </p>
            </div>

            <div className="px-6 py-4 border-b border-white/50 dark:border-slate-800/60 space-y-3">
              <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search issues, queues, keys..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-white/60 dark:border-slate-800/70 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 shadow-inner"
                />
              </form>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">My Queue</p>
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Assignee: me()</p>
                </div>
                <button
                  onClick={() => fetchIssues(searchQuery || undefined)}
                  className="p-3 rounded-full bg-white/80 dark:bg-slate-900/70 border border-white/60 dark:border-slate-800/80 text-slate-600 hover:text-blue-600 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white/80 dark:bg-slate-900/60 border border-white/60 dark:border-slate-800/70 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 transition"
              >
                <Settings2 className="w-4 h-4" /> Settings
              </button>
              {error && (
                <div className="text-xs text-red-500 bg-red-50/70 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 relative">
              {loading && issues.length > 0 && <RefreshOverlay />}
              {loading && issues.length === 0 ? (
                <IssueListSkeleton />
              ) : issues.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">
                  No issues found.
                </div>
              ) : (
                <IssueList
                  issues={issues}
                  selectedKey={selectedIssue?.key ?? null}
                  onSelect={setSelectedIssue}
                />
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/60 dark:border-slate-800/70 text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span>YTracker v2.0</span>
                <span className="text-slate-500">Tauri Edition</span>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className={`flex-1 relative bg-gradient-to-br from-white/60 via-white/30 to-transparent dark:from-slate-900/40 dark:via-slate-900/20 min-h-0 ${showDetailOverlay ? "overflow-hidden" : "overflow-auto lg:overflow-hidden"}`}>
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
                    onIssueUpdate={() => fetchIssues(searchQuery || undefined)}
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
                      onIssueUpdate={() => fetchIssues(searchQuery || undefined)}
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

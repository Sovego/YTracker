/**
 * Reusable loading and skeleton states for app bootstrap and settings flows.
 */
import { KeyRound, RefreshCw, Settings2 } from "lucide-react";

interface AppBootScreenProps {
    title?: string;
    subtitle?: string;
    caption?: string;
}

/**
 * Full-screen app bootstrap loading state.
 */
export function AppBootScreen({
    title = "Warming up workspaces…",
    subtitle = "YTracker",
    caption = "Authenticating & syncing issues",
}: AppBootScreenProps) {
    return (
        <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
            <div className="absolute inset-0 opacity-60" aria-hidden>
                <div className="absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-500/40 blur-[140px]"></div>
                <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-indigo-500/30 blur-[160px]"></div>
                <div className="absolute bottom-10 right-1/4 h-64 w-64 rounded-full bg-sky-400/30 blur-[140px]"></div>
            </div>
            <div className="relative flex flex-col items-center gap-6 text-center">
                <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-white/20 bg-white/5 backdrop-blur">
                    <KeyRound className="h-10 w-10 text-blue-200" />
                    <span className="absolute inset-0 rounded-3xl bg-blue-400/20 blur-2xl" aria-hidden></span>
                </div>
                <div>
                    <p className="text-sm uppercase tracking-[0.4em] text-slate-300">{subtitle}</p>
                    <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-300">
                    <RefreshCw className="h-4 w-4 animate-spin text-blue-300" />
                    {caption}
                </div>
            </div>
        </div>
    );
}

/**
 * Placeholder rows for issue list loading state.
 */
export function IssueListSkeleton({ rows = 6 }: { rows?: number }) {
    return (
        <div className="space-y-3" aria-label="Loading issues">
            {Array.from({ length: rows }).map((_, idx) => (
                <div
                    key={idx}
                    className="h-20 rounded-2xl border border-white/50 dark:border-slate-800/60 bg-gradient-to-r from-white/70 via-white/90 to-white/70 dark:from-slate-900/60 dark:via-slate-900/20 dark:to-slate-900/60 bg-[length:200%_100%] animate-shimmer"
                />
            ))}
        </div>
    );
}

/**
 * Overlay shown while background issue refresh is in progress.
 */
export function RefreshOverlay({ label = "Refreshing issues" }: { label?: string }) {
    return (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-12">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/70 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 shadow-lg animate-pop dark:border-slate-800/60 dark:bg-slate-900/80 dark:text-slate-200">
                <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                {label}
            </div>
        </div>
    );
}

/**
 * Placeholder shown when no issue is selected in desktop layout.
 */
export function IssueDetailPlaceholder() {
    return (
        <div className="h-full flex flex-col items-center justify-center text-slate-500 animate-fadeUp">
            <div className="gtk-card w-full max-w-xl mx-auto p-10 flex flex-col items-center gap-4 text-center">
                <div className="relative">
                    <div className="h-16 w-16 rounded-full border-2 border-transparent bg-gradient-to-br from-blue-500/20 via-blue-400/10 to-purple-500/20 flex items-center justify-center">
                        <RefreshCw className="h-8 w-8 text-blue-500 animate-spin" />
                    </div>
                    <span className="absolute inset-0 rounded-full bg-blue-400/10 blur-2xl" aria-hidden></span>
                </div>
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Preparing issue workspace…</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                    Loading your queue for the first time. This usually takes just a moment.
                </p>
                <div className="w-full space-y-3 mt-4">
                    {Array.from({ length: 3 }).map((_, idx) => (
                        <div
                            key={idx}
                            className="h-4 rounded-full bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 bg-[length:200%_100%] animate-shimmer"
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

/**
 * Skeleton card used while loading settings data.
 */
export function SettingsCardSkeleton({ title = "Loading preferences" }: { title?: string }) {
    return (
        <section className="gtk-card p-6 space-y-4 animate-fadeUp">
            <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-slate-200/60 dark:bg-slate-800/60 flex items-center justify-center">
                    <Settings2 className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1">
                    <div className="h-3 w-32 rounded-full bg-slate-200/80 dark:bg-slate-800/80 animate-shimmer bg-[length:200%_100%]"></div>
                    <div className="h-3 w-48 rounded-full bg-slate-200/60 dark:bg-slate-800/60 mt-2 animate-shimmer bg-[length:200%_100%]"></div>
                </div>
            </div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">{title}</p>
            <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-10 rounded-2xl bg-gradient-to-r from-slate-200/70 via-white to-slate-200/70 dark:from-slate-800/60 dark:via-slate-900/60 dark:to-slate-800/60 bg-[length:200%_100%] animate-shimmer"></div>
                ))}
            </div>
        </section>
    );
}

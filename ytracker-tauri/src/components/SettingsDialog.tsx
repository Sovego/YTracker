import { useEffect, useMemo, useState } from "react";
import { LogOut, X, Clock, Loader2, Shield, UserRound, RefreshCcw, DownloadCloud, CheckCircle2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { useAccount, useConfig, useUpdater } from "../hooks/useBridge";
import { SettingsCardSkeleton } from "./Loaders";

interface SettingsDialogProps {
    onClose: () => void;
    onLogout: () => void;
}

const INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 45, 60];

const formatBytes = (value: number) => {
    if (!value || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / Math.pow(1024, exponent);
    return `${amount.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

export function SettingsDialog({ onClose, onLogout }: SettingsDialogProps) {
    const { profile, loading: accountLoading, error: accountError, logout } = useAccount();
    const { config, save } = useConfig();
    const {
        available,
        checking,
        installing,
        progress,
        lastCheckedAt,
        upToDate,
        error: updaterError,
        installedVersion,
        checkForUpdates,
        installUpdate,
    } = useUpdater();

    const [interval, setInterval] = useState<number>(15);
    const [savingInterval, setSavingInterval] = useState(false);
    const [logoutLoading, setLogoutLoading] = useState(false);
    const [logoutError, setLogoutError] = useState<string | null>(null);
    const [intervalError, setIntervalError] = useState<string | null>(null);

    const progressPercent = progress?.total
        ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
        : progress
            ? 0
            : null;

    useEffect(() => {
        if (config?.timer_notification_interval) {
            setInterval(config.timer_notification_interval);
        }
    }, [config?.timer_notification_interval]);

    useEffect(() => {
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeydown);
        return () => document.removeEventListener("keydown", handleKeydown);
    }, [onClose]);

    const handleIntervalChange = async (value: number) => {
        if (!config || value === interval) return;
        setInterval(value);
        setIntervalError(null);
        setSavingInterval(true);
        try {
            await save({ ...config, timer_notification_interval: value });
        } catch {
            console.error("Failed to save settings");
            setIntervalError("Unable to save timer interval. Please try again.");
            setInterval(config.timer_notification_interval);
        } finally {
            setSavingInterval(false);
        }
    };

    const handleLogout = async () => {
        setLogoutLoading(true);
        setLogoutError(null);
        try {
            await logout();
            onLogout();
            onClose();
        } catch (err) {
            console.error("Failed to logout");
            setLogoutError(String(err));
        } finally {
            setLogoutLoading(false);
        }
    };

    const accountSubtitle = useMemo(() => {
        if (profile?.login) return profile.login;
        if (profile?.email) return profile.email;
        return "";
    }, [profile]);

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center px-4 motion-safe:animate-fadeUp" onClick={onClose}>
            <div
                className="w-full max-w-3xl bg-white/95 dark:bg-slate-950/95 rounded-3xl shadow-2xl border border-white/60 dark:border-slate-800/70 overflow-hidden motion-safe:animate-pop"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/60 dark:border-slate-800/60">
                    <div>
                        <p className="text-[11px] uppercase tracking-[0.4em] text-slate-400">Preferences</p>
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Settings</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-11 w-11 rounded-full bg-slate-100 dark:bg-slate-900 border border-white/70 dark:border-slate-800/60 text-slate-500 flex items-center justify-center"
                        aria-label="Close settings"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                    {accountLoading && !profile ? (
                        <SettingsCardSkeleton title="Loading account" />
                    ) : (
                        <section className="gtk-card p-5 space-y-5">
                            <div className="flex items-center gap-3">
                                <div className="h-12 w-12 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center border border-blue-500/20">
                                    <UserRound className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Account</p>
                                    {accountLoading ? (
                                        <div className="flex items-center gap-2 text-sm text-slate-500">
                                            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                                        </div>
                                    ) : (
                                        <>
                                            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                                {profile?.display || "Unknown user"}
                                            </p>
                                            {accountSubtitle && (
                                                <p className="text-sm text-slate-500">{accountSubtitle}</p>
                                            )}
                                        </>
                                    )}
                                    {accountError && (
                                        <p className="text-xs text-red-500 mt-2">{accountError}</p>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-white/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-900/40 p-4">
                                <p className="text-xs uppercase tracking-[0.35em] text-slate-400 mb-2 flex items-center gap-2">
                                    <Clock className="w-4 h-4" /> Timer reminders
                                </p>
                                <p className="text-sm text-slate-500 mb-4">
                                    Choose how often the app should remind you about an active timer.
                                </p>
                                <div className="grid grid-cols-3 gap-3">
                                    {INTERVAL_OPTIONS.map((value) => (
                                        <button
                                            key={value}
                                            disabled={!config || savingInterval}
                                            onClick={() => handleIntervalChange(value)}
                                            className={clsx(
                                                "px-3 py-2 rounded-2xl text-sm font-semibold border transition-colors",
                                                interval === value
                                                    ? "bg-blue-500 text-white border-blue-500 shadow"
                                                    : "bg-white/70 dark:bg-slate-900/40 text-slate-600 dark:text-slate-300 border-white/70 dark:border-slate-800/60"
                                            )}
                                        >
                                            {value} min
                                        </button>
                                    ))}
                                </div>
                                {savingInterval && (
                                    <p className="text-xs text-slate-400 mt-3 flex items-center gap-2">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving interval...
                                    </p>
                                )}
                                {intervalError && (
                                    <p className="text-xs text-red-500 mt-2">{intervalError}</p>
                                )}
                            </div>
                        </section>
                    )}

                    {config ? (
                        <section className="gtk-card p-5 space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="h-12 w-12 rounded-2xl bg-green-500/10 text-green-600 flex items-center justify-center border border-green-500/20">
                                    <Shield className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Session</p>
                                    <p className="text-sm text-slate-500">Sign out to switch accounts or re-authenticate.</p>
                                </div>
                            </div>
                            {logoutError && (
                                <div className="text-xs text-red-500 bg-red-50/70 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-2xl px-4 py-3">
                                    {logoutError}
                                </div>
                            )}
                            <button
                                onClick={handleLogout}
                                disabled={logoutLoading}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-red-600 text-white font-semibold shadow-md disabled:opacity-60"
                            >
                                {logoutLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                                Logout
                            </button>
                            <p className="text-xs text-slate-400">
                                Logging out clears your local token store. You will need to authenticate again to continue tracking time.
                            </p>
                        </section>
                    ) : (
                        <SettingsCardSkeleton title="Preparing preferences" />
                    )}

                    <section className="gtk-card p-5 space-y-5 col-span-1 lg:col-span-2">
                        <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center border border-indigo-500/20">
                                <RefreshCcw className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Updates</p>
                                <p className="text-sm text-slate-500">
                                    Updates are delivered via GitHub Releases and verified with Tauri signatures.
                                </p>
                            </div>
                        </div>

                        {available ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-900/10 p-4">
                                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4" /> Update {available.version} available
                                </p>
                                <p className="text-xs text-amber-700 dark:text-amber-200 mt-2">
                                    {available.automatic
                                        ? "Detected automatically at startup."
                                        : "Found via manual check."}
                                </p>
                                {available.notes && (
                                    <p className="text-sm text-slate-700 dark:text-slate-200 mt-2 whitespace-pre-line">
                                        {available.notes}
                                    </p>
                                )}
                            </div>
                        ) : upToDate && lastCheckedAt ? (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-900/10 p-4 flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-200">
                                <CheckCircle2 className="w-4 h-4" />
                                Up to date as of {new Date(lastCheckedAt).toLocaleString()}.
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-300">
                                The updater checks automatically at launch. Use the button below to trigger a manual check.
                            </div>
                        )}

                        {progressPercent !== null && (
                            <div className="space-y-2">
                                <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 transition-[width]"
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                    <span>Downloading update…</span>
                                    <span>
                                        {progress ? formatBytes(progress.downloaded) : "0 B"}
                                        {progress?.total ? ` / ${formatBytes(progress.total)}` : ""}
                                    </span>
                                </p>
                            </div>
                        )}

                        {updaterError && (
                            <div className="text-xs text-red-500 bg-red-50/70 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-2xl px-4 py-3">
                                {updaterError}
                            </div>
                        )}

                        {installedVersion && (
                            <div className="text-xs text-emerald-600 dark:text-emerald-300 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4" />
                                Update {installedVersion} installed. Relaunching now…
                            </div>
                        )}

                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => void checkForUpdates()}
                                disabled={checking || installing}
                                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-100 bg-white/70 dark:bg-slate-900/40 disabled:opacity-60"
                            >
                                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                                {checking ? "Checking…" : "Check for updates"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void installUpdate()}
                                disabled={!available || installing}
                                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-indigo-600 text-white font-semibold shadow disabled:opacity-60"
                            >
                                {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
                                {installing ? "Installing…" : "Install & Restart"}
                            </button>
                        </div>

                        <p className="text-xs text-slate-400">
                            Latest release metadata is fetched from GitHub. Pre-release or draft tags are ignored.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}

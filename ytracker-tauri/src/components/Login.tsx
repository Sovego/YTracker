import { useState, type FormEvent } from "react";
import { useAuth, useClientCredentials } from "../hooks/useBridge";
import { KeyRound, Loader2, ChevronDown, ShieldAlert } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

export function Login({ onLoginSuccess }: { onLoginSuccess: () => void }) {
    const { exchangeCode, loading, error } = useAuth();
    const {
        info: credentialsInfo,
        loading: credentialsLoading,
        error: credentialsError,
    } = useClientCredentials();
    const [code, setCode] = useState("");
    const [orgId, setOrgId] = useState("");
    const [orgType, setOrgType] = useState("yandex360");
    const [statusBanner, setStatusBanner] = useState<
        { variant: "success" | "error"; message: string } | null
    >(null);

    const clientId = credentialsInfo?.client_id ?? "";
    const secretAvailable = Boolean(credentialsInfo?.has_client_secret);
    const credentialsReady = Boolean(clientId && secretAvailable);
    const credentialsResolved = !credentialsLoading;
    const showMissingCredentialsWarning =
        credentialsResolved && !credentialsError && Boolean(credentialsInfo) && !credentialsReady;

    const ensureCredentialsReady = () => {
        if (credentialsLoading) {
            return false;
        }

        if (!clientId) {
            return false;
        }

        if (!secretAvailable) {
            return false;
        }

        return true;
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!code) return;
        if (!ensureCredentialsReady()) {
            return;
        }

        const success = await exchangeCode(code, orgId, orgType);
        if (success) {
            onLoginSuccess();
        }
    };

    const handleGetCode = async () => {
        setStatusBanner(null);
        if (!ensureCredentialsReady()) {
            return;
        }
        const url = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${encodeURIComponent(
            clientId
        )}&display=popup`;
        await openUrl(url);
        setStatusBanner({
            variant: "success",
            message: "Browser window opened. Complete Yandex OAuth to receive the verification code.",
        });
    };

    const oauthButtonDisabled = credentialsLoading || !credentialsReady;
    const signInDisabled = loading || !code || credentialsLoading || !credentialsReady;
    const credentialBanner =
        statusBanner ??
        (credentialsError ? { variant: "error" as const, message: credentialsError } : null);

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-slate-50 dark:bg-slate-950 p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-lg shadow-xl p-8 border border-slate-200 dark:border-slate-800">
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-4">
                        <KeyRound className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">YTracker Login</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-center mt-2">
                        Please enter your OAuth verification code to continue.
                    </p>
                </div>

                <section className="w-full mb-6">
                    <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/60 dark:bg-slate-900/30">
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                                {showMissingCredentialsWarning && (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                        <ShieldAlert className="w-3.5 h-3.5" />
                                        Attention
                                    </span>
                                )}
                            </div>
                            {showMissingCredentialsWarning && (
                                <p className="text-xs text-amber-700 dark:text-amber-200 flex items-center gap-2">
                                    <ShieldAlert className="w-4 h-4" /> OAuth secrets are missing. Please configure ENV variables before building.
                                </p>
                            )}
                            {credentialBanner && (
                                <div
                                    className={`mt-2 rounded-md border px-3 py-2 text-sm ${credentialBanner.variant === "success"
                                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200"
                                        : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
                                        }`}
                                >
                                    {credentialBanner.message}
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <div className="mb-6">
                    <button
                        type="button"
                        onClick={handleGetCode}
                        disabled={oauthButtonDisabled}
                        className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md font-medium transition-colors border border-slate-300 dark:border-slate-700 mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        1. Get Verification Code
                    </button>
                    <p className="text-xs text-center text-slate-500">
                        Click above to open Yandex OAuth in your browser.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="code" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            2. Verification Code
                        </label>
                        <input
                            id="code"
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition-colors"
                            placeholder="Enter code from browser..."
                            autoFocus
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="orgType" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Org Type
                            </label>
                            <div className="relative">
                                <select
                                    id="orgType"
                                    value={orgType}
                                    onChange={(e) => setOrgType(e.target.value)}
                                    className="w-full appearance-none px-4 py-2 pr-10 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                                >
                                    <option value="yandex360">Yandex 360</option>
                                    <option value="cloud">Yandex Cloud</option>
                                </select>
                                <ChevronDown className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-slate-500 dark:text-slate-400" />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="orgId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Org ID
                            </label>
                            <input
                                id="orgId"
                                type="text"
                                value={orgId}
                                onChange={(e) => setOrgId(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition-colors"
                                placeholder="Organization ID"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-600 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}


                    <button
                        type="submit"
                        disabled={signInDisabled}
                        className="w-full flex items-center justify-center py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Authenticating...
                            </>
                        ) : (
                            "Sign In"
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center text-sm text-slate-500">
                    <p>The browser window should have opened automatically.</p>
                </div>
            </div>
        </div>
    );
}

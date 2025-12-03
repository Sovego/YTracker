import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface Issue {
    key: string;
    summary: string;
    description: string;
    status: { key: string; display: string };
    priority: { key: string; display: string };
}

export interface TimerState {
    active: boolean;
    issue_key: string | null;
    issue_summary?: string | null;
    start_time: number | null;
    elapsed: number;
}

export interface Config {
    timer_notification_interval: number;
}

export interface ClientCredentialsInfo {
    client_id?: string | null;
    has_client_secret: boolean;
}

export interface Comment {
    id: string;
    text: string;
    author: string;
    created_at: string;
}

export interface Attachment {
    id: string;
    name: string;
    url: string;
    mime_type?: string;
}

export interface Transition {
    id: string;
    name: string;
    to_status: { key: string; display: string } | null;
}

export interface AttachmentPreview {
    mime_type: string;
    data_base64: string;
}

export interface UserProfile {
    display?: string | null;
    login?: string | null;
    email?: string | null;
    avatar_url?: string | null;
}

export interface SimpleEntity {
    key: string;
    display: string;
}

export interface UpdateAvailableEvent {
    version: string;
    notes?: string | null;
    pub_date?: string | null;
    automatic: boolean;
}

export interface UpdateProgressState {
    downloaded: number;
    total?: number | null;
}

type DownloadEvent =
    | { event: "Started"; data?: { contentLength?: number } }
    | { event: "Progress"; data?: { chunkLength?: number; contentLength?: number } }
    | { event: "Finished"; data?: { contentLength?: number } }
    | { event: string; data?: { chunkLength?: number; contentLength?: number } };

let cachedProfile: UserProfile | null = null;
let profilePromise: Promise<UserProfile> | null = null;

let cachedConfig: Config | null = null;
let configPromise: Promise<Config> | null = null;

const normalizeConfig = (data: Config): Config => ({
    timer_notification_interval: data.timer_notification_interval,
});

const fetchConfigCached = async (force = false): Promise<Config> => {
    if (!force && cachedConfig) {
        return cachedConfig;
    }
    if (!force && configPromise) {
        return configPromise;
    }
    const promise = invoke<Config>("get_config")
        .then((data) => {
            const normalized = normalizeConfig(data);
            cachedConfig = normalized;
            return normalized;
        })
        .finally(() => {
            if (configPromise === promise) {
                configPromise = null;
            }
        });
    configPromise = promise;
    return promise;
};

const fetchProfileCached = async (force = false): Promise<UserProfile> => {
    if (!force && cachedProfile) {
        return cachedProfile;
    }
    if (!force && profilePromise) {
        return profilePromise;
    }
    const promise = invoke<UserProfile>("get_current_user")
        .then((data) => {
            cachedProfile = data;
            return data;
        })
        .finally(() => {
            if (profilePromise === promise) {
                profilePromise = null;
            }
        });
    profilePromise = promise;
    return promise;
};

const CACHE_TTL_MS = 300 * 1000; // 5 minute cache

type CacheEntry<T> = { data: T; timestamp: number };

const detailCache = {
    comments: new Map<string, CacheEntry<Comment[]>>(),
    attachments: new Map<string, CacheEntry<Attachment[]>>(),
    transitions: new Map<string, CacheEntry<Transition[]>>()
};

let cachedStatuses: SimpleEntity[] | null = null;
let statusesPromise: Promise<SimpleEntity[]> | null = null;
let cachedResolutions: SimpleEntity[] | null = null;
let resolutionsPromise: Promise<SimpleEntity[]> | null = null;

const isFresh = <T>(entry?: CacheEntry<T> | null) => {
    if (!entry) return false;
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
};

const getFreshCache = <T>(map: Map<string, CacheEntry<T>>, key: string) => {
    const entry = map.get(key);
    if (entry && isFresh(entry)) {
        return entry.data;
    }
    if (entry && !isFresh(entry)) {
        map.delete(key);
    }
    return null;
};

const setCache = <T>(map: Map<string, CacheEntry<T>>, key: string, data: T) => {
    map.set(key, { data, timestamp: Date.now() });
};

const invalidateCache = (issueKey: string, type: "comments" | "attachments" | "transitions" | "all") => {
    if (type === "comments" || type === "all") detailCache.comments.delete(issueKey);
    if (type === "attachments" || type === "all") detailCache.attachments.delete(issueKey);
    if (type === "transitions" || type === "all") detailCache.transitions.delete(issueKey);
};

const fetchWithCache = async <T>(
    map: Map<string, CacheEntry<T>>,
    issueKey: string,
    fetcher: () => Promise<T>,
    forceRefresh?: boolean
) => {
    if (!forceRefresh) {
        const cached = getFreshCache(map, issueKey);
        if (cached) {
            return cached;
        }
    }
    const data = await fetcher();
    setCache(map, issueKey, data);
    return data;
};

const getCachedDetails = (issueKey: string) => ({
    comments: getFreshCache(detailCache.comments, issueKey) ?? null,
    attachments: getFreshCache(detailCache.attachments, issueKey) ?? null,
    transitions: getFreshCache(detailCache.transitions, issueKey) ?? null,
});

export function useIssueDetails() {
    const getIssue = async (issueKey: string) => {
        return invoke<Issue>("get_issue", { issueKey });
    };

    const getComments = async (issueKey: string, options?: { forceRefresh?: boolean }) => {
        return fetchWithCache(
            detailCache.comments,
            issueKey,
            () => invoke<Comment[]>("get_comments", { issueKey }),
            options?.forceRefresh
        );
    };

    const addComment = async (issueKey: string, text: string) => {
        const result = await invoke("add_comment", { issueKey, text });
        invalidateCache(issueKey, "comments");
        return result;
    };

    const updateIssue = async (issueKey: string, summary?: string, description?: string) => {
        return invoke("update_issue", { issueKey, summary, description });
    };

    const getAttachments = async (issueKey: string, options?: { forceRefresh?: boolean }) => {
        return fetchWithCache(
            detailCache.attachments,
            issueKey,
            () => invoke<Attachment[]>("get_attachments", { issueKey }),
            options?.forceRefresh
        );
    };

    const downloadAttachment = async (issueKey: string, attachmentId: string, destPath: string) => {
        return invoke("download_attachment", {
            issueKey,
            attachmentId,
            destPath,
        });
    };

    const getTransitions = async (issueKey: string, options?: { forceRefresh?: boolean }) => {
        return fetchWithCache(
            detailCache.transitions,
            issueKey,
            () => invoke<Transition[]>("get_transitions", { issueKey }),
            options?.forceRefresh
        );
    };

    const executeTransition = async (issueKey: string, transitionId: string) => {
        const result = await invoke("execute_transition", { issueKey, transitionId });
        invalidateCache(issueKey, "transitions");
        return result;
    };

    const previewAttachment = async (issueKey: string, attachmentId: string) => {
        return invoke<AttachmentPreview>("preview_attachment", { issueKey, attachmentId });
    };

    const previewInlineImage = async (path: string) => {
        return invoke<AttachmentPreview>("preview_inline_image", { path });
    };

    const clearIssueCache = (issueKey: string) => invalidateCache(issueKey, "all");

    const getStatuses = async () => {
        if (cachedStatuses) return cachedStatuses;
        if (!statusesPromise) {
            statusesPromise = invoke<SimpleEntity[]>("get_statuses")
                .then((data) => {
                    cachedStatuses = data;
                    return data;
                })
                .finally(() => {
                    statusesPromise = null;
                });
        }
        return statusesPromise;
    };

    const getResolutions = async () => {
        if (cachedResolutions) return cachedResolutions;
        if (!resolutionsPromise) {
            resolutionsPromise = invoke<SimpleEntity[]>("get_resolutions")
                .then((data) => {
                    cachedResolutions = data;
                    return data;
                })
                .finally(() => {
                    resolutionsPromise = null;
                });
        }
        return resolutionsPromise;
    };

    return {
        getIssue,
        getComments,
        addComment,
        updateIssue,
        getAttachments,
        downloadAttachment,
        previewAttachment,
        previewInlineImage,
        getTransitions,
        executeTransition,
        getCachedDetails,
        clearIssueCache,
        getStatuses,
        getResolutions,
    };
}

export function useTracker() {
    const [issues, setIssues] = useState<Issue[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchIssues = async (query?: string): Promise<boolean> => {
        setLoading(true);
        setError(null);
        try {
            const data = await invoke<Issue[]>("get_issues", { query });
            setIssues(data);
            return true;
        } catch (err) {
            setError(String(err));
            return false;
        } finally {
            setLoading(false);
        }
    };

    return { issues, loading, error, fetchIssues };
}

export function useTimer() {
    const [state, setState] = useState<TimerState>({
        active: false,
        issue_key: null,
        start_time: null,
        elapsed: 0,
    });

    useEffect(() => {
        // Initial state
        invoke<TimerState>("get_timer_state").then(setState);

        // Listen for ticks
        const unlisten = listen<TimerState>("timer-tick", (event) => {
            setState(event.payload);
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, []);

    const start = async (issueKey: string, issueSummary?: string) => {
        await invoke("start_timer", { issueKey, issueSummary: issueSummary ?? null });
        const newState = await invoke<TimerState>("get_timer_state");
        setState(newState);
    };

    const stop = async () => {
        const result = await invoke<[number, string | null]>("stop_timer");
        const newState = await invoke<TimerState>("get_timer_state");
        setState(newState);
        return result;
    };

    return { state, start, stop };
}

export function useWorkLog() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const logWork = async (issueKey: string, duration: string, comment: string) => {
        setLoading(true);
        setError(null);
        try {
            await invoke("log_work", { issueKey, duration, comment });
            return true;
        } catch (err) {
            setError(String(err));
            return false;
        } finally {
            setLoading(false);
        }
    };

    return { logWork, loading, error };
}

export function useClientCredentials() {
    const [info, setInfo] = useState<ClientCredentialsInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await invoke<ClientCredentialsInfo>("get_client_credentials_info");
            setInfo(data);
            return data;
        } catch (err) {
            const message = String(err);
            setError(message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { info, loading, error, refresh };
}

export const checkSessionExists = async (): Promise<boolean> => {
    try {
        return await invoke<boolean>("has_session");
    } catch (err) {
        console.warn("Session check failed", err);
        return false;
    }
};

export function useConfig() {
    const [config, setConfig] = useState<Config | null>(cachedConfig);

    useEffect(() => {
        let cancelled = false;
        fetchConfigCached(!cachedConfig)
            .then((data) => {
                if (!cancelled) setConfig(data);
            })
            .catch((err) => {
                console.warn("Failed to load config", err);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const save = async (newConfig: Config) => {
        const normalized = normalizeConfig(newConfig);
        await invoke("save_config", { config: normalized });
        cachedConfig = normalized;
        setConfig(normalized);
    };

    const refresh = async (force = false) => {
        const data = await fetchConfigCached(force);
        setConfig(data);
    };

    return { config, save, refresh };
}

export function useAuth() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const exchangeCode = async (code: string, orgId: string, orgType: string): Promise<boolean> => {
        setLoading(true);
        setError(null);
        try {
            await invoke("exchange_code", { code, orgId: orgId || null, orgType });
            return true;
        } catch (err) {
            setError(String(err));
            return false;
        } finally {
            setLoading(false);
        }
    };

    return { exchangeCode, loading, error };
}

export function useAccount() {
    const [profile, setProfile] = useState<UserProfile | null>(cachedProfile);
    const [loading, setLoading] = useState(!cachedProfile);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async (force = false) => {
        if (!force && cachedProfile) {
            setProfile(cachedProfile);
            setError(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const data = await fetchProfileCached(force);
            setProfile(data);
        } catch (err) {
            setProfile(null);
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh(!cachedProfile);
    }, [refresh]);

    const logout = useCallback(async () => {
        try {
            await invoke("logout");
            setProfile(null);
            cachedProfile = null;
            profilePromise = null;
            cachedConfig = null;
            configPromise = null;
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, []);

    return { profile, loading, error, refresh, logout };
}

export function useUpdater() {
    const [available, setAvailable] = useState<UpdateAvailableEvent | null>(null);
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState<UpdateProgressState | null>(null);
    const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
    const [upToDate, setUpToDate] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [installedVersion, setInstalledVersion] = useState<string | null>(null);

    useEffect(() => {
        const unlistenPromise = listen<UpdateAvailableEvent>("updater://available", (event) => {
            setAvailable(event.payload);
            setInstalledVersion(null);
            setUpToDate(false);
        });

        return () => {
            unlistenPromise.then((unlisten) => unlisten());
        };
    }, []);

    const checkForUpdates = useCallback(async () => {
        setChecking(true);
        setError(null);
        setProgress(null);
        setLastCheckedAt(Date.now());
        try {
            const update = await check();
            if (update) {
                const rawDate = update.date;
                const pubDate = rawDate ? new Date(rawDate).toISOString() : null;
                setAvailable({
                    version: update.version,
                    notes: update.body ?? null,
                    pub_date: pubDate,
                    automatic: false,
                });
                setUpToDate(false);
                return true;
            } else {
                setAvailable(null);
                setUpToDate(true);
                return false;
            }
        } catch (err) {
            const message = String(err);
            setError(message);
            setUpToDate(false);
            throw err;
        } finally {
            setChecking(false);
        }
    }, []);

    const installUpdate = useCallback(
        async (options: { restart?: boolean } = { restart: true }) => {
            setInstalling(true);
            setError(null);
            setProgress(null);
            try {
                const update = await check();
                if (!update) {
                    setAvailable(null);
                    setUpToDate(true);
                    return false;
                }

                let downloaded = 0;
                await update.downloadAndInstall((event: DownloadEvent) => {
                    switch (event.event) {
                        case "Started":
                            downloaded = 0;
                            setProgress({ downloaded: 0, total: event.data?.contentLength ?? null });
                            break;
                        case "Progress":
                            downloaded += event.data?.chunkLength ?? 0;
                            setProgress({
                                downloaded,
                                total: event.data?.contentLength ?? null,
                            });
                            break;
                        case "Finished":
                            setProgress({
                                downloaded,
                                total: event.data?.contentLength ?? downloaded,
                            });
                            break;
                        default:
                            break;
                    }
                });

                setInstalledVersion(update.version);
                setAvailable(null);
                setUpToDate(true);

                if (options.restart !== false) {
                    await relaunch();
                }
                return true;
            } catch (err) {
                const message = String(err);
                setError(message);
                throw err;
            } finally {
                setInstalling(false);
                setProgress(null);
            }
        },
        []
    );

    return {
        available,
        checking,
        installing,
        progress,
        lastCheckedAt,
        upToDate,
        error,
        installedVersion,
        checkForUpdates,
        installUpdate,
    };
}

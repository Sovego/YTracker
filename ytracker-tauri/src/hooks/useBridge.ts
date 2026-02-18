/**
 * Typed frontend bridge to Tauri native commands/events.
 *
 * Centralizes DTO contracts, command wrappers, cache/de-duplication behavior,
 * and feature-oriented React hooks consumed by UI components.
 */
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getErrorSummary } from "../utils";

/**
 * Lightweight issue row used by list and summary views.
 */
export interface Issue {
    key: string;
    summary: string;
    description: string;
    status: { key: string; display: string };
    priority: { key: string; display: string };
    tracked_seconds?: number | null;
}

type IssuePageResponse = {
    issues: Issue[];
    next_scroll_id?: string | null;
    total_count?: number | null;
    has_more: boolean;
};

/**
 * Normalized issue page returned by paginated/scroll issue search.
 */
export interface IssuePage {
    issues: Issue[];
    nextScrollId: string | null;
    totalCount: number | null;
    hasMore: boolean;
}

/**
 * Dynamic filter payload forwarded to backend issue search command.
 */
export type TrackerFilterPayload = Record<string, unknown>;

/**
 * Optional issue search criteria used by issue list queries.
 */
export interface IssueSearchOptions {
    query?: string | null;
    filter?: TrackerFilterPayload | null;
}

/**
 * Current timer snapshot emitted by native timer state.
 */
export interface TimerState {
    active: boolean;
    issue_key: string | null;
    issue_summary?: string | null;
    start_time: number | null;
    elapsed: number;
}

/**
 * Persisted desktop configuration synchronized with native config manager.
 */
export interface Config {
    timer_notification_interval: number;
    workday_hours: number;
    workday_start_time: string;
    workday_end_time: string;
}

/**
 * Public client credentials status used by login/settings forms.
 */
export interface ClientCredentialsInfo {
    client_id?: string | null;
    has_client_secret: boolean;
}

/**
 * Simplified issue comment model used in issue details view.
 */
export interface Comment {
    id: string;
    text: string;
    author: string;
    created_at: string;
}

/**
 * Simplified issue attachment metadata for list/download interactions.
 */
export interface Attachment {
    id: string;
    name: string;
    url: string;
    mime_type?: string;
}

/**
 * Worklog entry DTO rendered in issue details and history UI.
 */
export interface WorklogEntry {
    id: string;
    date: string;
    duration_seconds: number;
    comment: string;
    author: string;
}

/**
 * Checklist item representation exposed to the UI layer.
 */
export interface ChecklistItem {
    id: string;
    text: string;
    checked: boolean;
    assignee?: string | null;
    deadline?: string | null;
    deadline_type?: string | null;
    is_exceeded?: boolean | null;
    item_type?: string | null;
}

/**
 * Payload used when creating a new checklist item.
 */
export interface ChecklistItemCreatePayload {
    text: string;
    checked?: boolean;
    assignee?: string | null;
    deadline?: string | null;
    deadline_type?: string | null;
}

/**
 * Partial payload used for checklist item edits.
 */
export interface ChecklistItemUpdatePayload {
    text?: string;
    checked?: boolean;
    assignee?: string | null;
    deadline?: string | null;
    deadline_type?: string | null;
}

/**
 * Issue transition option returned by Tracker workflow endpoints.
 */
export interface Transition {
    id: string;
    name: string;
    to_status: { key: string; display: string } | null;
}

/**
 * Binary attachment preview payload with base64-encoded bytes.
 */
export interface AttachmentPreview {
    mime_type: string;
    data_base64: string;
}

/**
 * Current user profile surfaced in settings/account UI.
 */
export interface UserProfile {
    display?: string | null;
    login?: string | null;
    email?: string | null;
    avatar_url?: string | null;
}

/**
 * Common key/display pair for catalog entities (queues, statuses, etc.).
 */
export interface SimpleEntity {
    key: string;
    display: string;
}

/**
 * Updater available-event payload (mirrors `updater://available`).
 */
export interface UpdateAvailableEvent {
    version: string;
    notes?: string | null;
    pub_date?: string | null;
    automatic: boolean;
}

/**
 * Incremental updater download progress state.
 */
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
// Browser event used to fan out config mutations to all active hook consumers.
const CONFIG_UPDATED_EVENT = "ytracker:config-updated";

/** Normalizes config payload shape from backend before storing in cache/state. */
const normalizeConfig = (data: Config): Config => ({
    timer_notification_interval: data.timer_notification_interval,
    workday_hours: data.workday_hours,
    workday_start_time: data.workday_start_time,
    workday_end_time: data.workday_end_time,
});

/** Loads config with in-flight promise coalescing and optional cache bypass. */
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

/** Loads current user profile with in-flight promise coalescing and cache support. */
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
    transitions: new Map<string, CacheEntry<Transition[]>>(),
    worklogs: new Map<string, CacheEntry<WorklogEntry[]>>(),
    checklist: new Map<string, CacheEntry<ChecklistItem[]>>()
};

const DEFAULT_ISSUE_QUERY_KEY = "__default__";
const DEFAULT_FILTER_KEY = "__nofilter__";
const SCROLL_ROOT_KEY = "__scroll_root__";
const issueFetchPromises = new Map<string, Promise<IssuePage>>();

/**
 * Stable serializer used to derive deterministic cache/de-duplication keys
 * from nested filter payloads.
 */
const stableSerialize = (value: unknown): string => {
    if (value === null || value === undefined) {
        return "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries
            .map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
};

/** Removes nullable/undefined filter entries before sending to backend. */
const normalizeFilterPayload = (filter?: TrackerFilterPayload | null) => {
    if (!filter) return undefined;
    const normalizedEntries = Object.entries(filter).filter(([, value]) => value !== undefined && value !== null);
    if (normalizedEntries.length === 0) {
        return undefined;
    }
    return normalizedEntries.reduce<TrackerFilterPayload>((acc, [key, value]) => {
        acc[key] = value as unknown;
        return acc;
    }, {});
};

/** Canonicalizes issue search options and drops empty query/filter combinations. */
const normalizeIssueOptions = (options?: IssueSearchOptions | null): IssueSearchOptions | undefined => {
    if (!options) return undefined;
    const query = options.query?.trim();
    const filter = normalizeFilterPayload(options.filter);
    if (!query && !filter) {
        return undefined;
    }
    return {
        query: query || undefined,
        filter,
    };
};

/** Builds a unique key for request de-duplication across query/filter/scroll state. */
const getIssueFetchKey = (options?: IssueSearchOptions, scrollId?: string | null) => {
    const queryKey = options?.query || DEFAULT_ISSUE_QUERY_KEY;
    const filterKey = options?.filter ? stableSerialize(options.filter) : DEFAULT_FILTER_KEY;
    const normalizedScroll = scrollId?.trim() || SCROLL_ROOT_KEY;
    return `${queryKey}::${filterKey}::${normalizedScroll}`;
};

/** Converts snake_case backend page payload into frontend IssuePage contract. */
const normalizeIssuePage = (payload: IssuePageResponse): IssuePage => ({
    issues: payload.issues ?? [],
    nextScrollId: payload.next_scroll_id ?? null,
    totalCount: payload.total_count ?? null,
    hasMore: payload.has_more ?? false,
});

/** Requests one issue page with promise coalescing for identical in-flight queries. */
const requestIssuePage = async (options?: IssueSearchOptions, scrollId?: string | null) => {
    const key = getIssueFetchKey(options, scrollId);
    let existing = issueFetchPromises.get(key);
    if (!existing) {
        const promise = invoke<IssuePageResponse>("get_issues", {
            query: options?.query ?? null,
            filter: options?.filter ?? null,
            scroll_id: scrollId ?? null,
        })
            .then(normalizeIssuePage)
            .finally(() => {
                if (issueFetchPromises.get(key) === promise) {
                    issueFetchPromises.delete(key);
                }
            });
        issueFetchPromises.set(key, promise);
        existing = promise;
    }
    return existing;
};

/** Merges incoming issue pages into current list while preserving stable ordering. */
const mergeIssueLists = (current: Issue[], incoming: Issue[]): Issue[] => {
    if (incoming.length === 0) {
        return current;
    }

    const indexMap = new Map<string, number>();
    current.forEach((issue, index) => {
        indexMap.set(issue.key, index);
    });

    const next = current.slice();
    incoming.forEach((issue) => {
        const existingIndex = indexMap.get(issue.key);
        if (existingIndex !== undefined) {
            next[existingIndex] = issue;
        } else {
            indexMap.set(issue.key, next.length);
            next.push(issue);
        }
    });

    return next;
};

let cachedStatuses: SimpleEntity[] | null = null;
let statusesPromise: Promise<SimpleEntity[]> | null = null;
let cachedResolutions: SimpleEntity[] | null = null;
let resolutionsPromise: Promise<SimpleEntity[]> | null = null;
let cachedQueuesDirectory: SimpleEntity[] | null = null;
let queuesDirectoryPromise: Promise<SimpleEntity[]> | null = null;
let cachedProjectsDirectory: SimpleEntity[] | null = null;
let projectsDirectoryPromise: Promise<SimpleEntity[]> | null = null;
let cachedUsersDirectory: UserProfile[] | null = null;
let usersDirectoryPromise: Promise<UserProfile[]> | null = null;

/** Loads queue directory values with cache reuse and promise coalescing. */
const fetchQueuesDirectory = async (force = false): Promise<SimpleEntity[]> => {
    if (!force && cachedQueuesDirectory) return cachedQueuesDirectory;
    if (!force && queuesDirectoryPromise) return queuesDirectoryPromise;
    const promise = invoke<SimpleEntity[]>("get_queues")
        .then((data) => {
            cachedQueuesDirectory = data;
            return data;
        })
        .finally(() => {
            if (queuesDirectoryPromise === promise) {
                queuesDirectoryPromise = null;
            }
        });
    queuesDirectoryPromise = promise;
    return promise;
};

/** Loads project directory values with cache reuse and promise coalescing. */
const fetchProjectsDirectory = async (force = false): Promise<SimpleEntity[]> => {
    if (!force && cachedProjectsDirectory) return cachedProjectsDirectory;
    if (!force && projectsDirectoryPromise) return projectsDirectoryPromise;
    const promise = invoke<SimpleEntity[]>("get_projects")
        .then((data) => {
            cachedProjectsDirectory = data;
            return data;
        })
        .finally(() => {
            if (projectsDirectoryPromise === promise) {
                projectsDirectoryPromise = null;
            }
        });
    projectsDirectoryPromise = promise;
    return promise;
};

/** Loads user directory values with cache reuse and promise coalescing. */
const fetchUsersDirectory = async (force = false): Promise<UserProfile[]> => {
    if (!force && cachedUsersDirectory) return cachedUsersDirectory;
    if (!force && usersDirectoryPromise) return usersDirectoryPromise;
    const promise = invoke<UserProfile[]>("get_users")
        .then((data) => {
            cachedUsersDirectory = data;
            return data;
        })
        .finally(() => {
            if (usersDirectoryPromise === promise) {
                usersDirectoryPromise = null;
            }
        });
    usersDirectoryPromise = promise;
    return promise;
};

/** Returns whether a cache entry is still valid by TTL. */
const isFresh = <T>(entry?: CacheEntry<T> | null) => {
    if (!entry) return false;
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
};

/** Reads fresh cached value for an issue key and drops stale entries. */
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

/** Stores data into per-issue cache with current timestamp. */
const setCache = <T>(map: Map<string, CacheEntry<T>>, key: string, data: T) => {
    map.set(key, { data, timestamp: Date.now() });
};

/** Invalidates one or all detail caches for a specific issue key. */
const invalidateCache = (issueKey: string, type: "comments" | "attachments" | "transitions" | "worklogs" | "checklist" | "all") => {
    if (type === "comments" || type === "all") detailCache.comments.delete(issueKey);
    if (type === "attachments" || type === "all") detailCache.attachments.delete(issueKey);
    if (type === "transitions" || type === "all") detailCache.transitions.delete(issueKey);
    if (type === "worklogs" || type === "all") detailCache.worklogs.delete(issueKey);
    if (type === "checklist" || type === "all") detailCache.checklist.delete(issueKey);
};

/** Generic cache-aware fetch wrapper for issue detail resources. */
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

/** Returns currently cached detail slices for optimistic UI updates. */
const getCachedDetails = (issueKey: string) => ({
    comments: getFreshCache(detailCache.comments, issueKey) ?? null,
    attachments: getFreshCache(detailCache.attachments, issueKey) ?? null,
    transitions: getFreshCache(detailCache.transitions, issueKey) ?? null,
    worklogs: getFreshCache(detailCache.worklogs, issueKey) ?? null,
    checklist: getFreshCache(detailCache.checklist, issueKey) ?? null,
});

/**
 * Hook that manages issue-related detail endpoints with TTL cache support.
 */
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

    const getIssueWorklogs = async (issueKey: string, options?: { forceRefresh?: boolean }) => {
        return fetchWithCache(
            detailCache.worklogs,
            issueKey,
            () => invoke<WorklogEntry[]>("get_issue_worklogs", { issueKey }),
            options?.forceRefresh
        );
    };

    const getTodayLoggedSecondsForIssues = useCallback(async (issueKeys: string[]) => {
        return invoke<number>("get_today_logged_seconds_for_issues", { issueKeys });
    }, []);

    const executeTransition = async (issueKey: string, transitionId: string, comment?: string, resolution?: string) => {
        const result = await invoke("execute_transition", { issueKey, transitionId, comment, resolution });
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

    const getChecklist = async (issueKey: string, options?: { forceRefresh?: boolean }) => {
        return fetchWithCache(
            detailCache.checklist,
            issueKey,
            () => invoke<ChecklistItem[]>("get_checklist", { issueKey }),
            options?.forceRefresh
        );
    };

    const addChecklistItem = async (issueKey: string, item: ChecklistItemCreatePayload) => {
        await invoke("add_checklist_item", { issueKey, item });
        invalidateCache(issueKey, "checklist");
    };

    const editChecklistItem = async (issueKey: string, itemId: string, update: ChecklistItemUpdatePayload) => {
        await invoke("edit_checklist_item", { issueKey, itemId, update });
        invalidateCache(issueKey, "checklist");
    };

    const deleteChecklist = async (issueKey: string) => {
        await invoke("delete_checklist", { issueKey });
        invalidateCache(issueKey, "checklist");
    };

    const deleteChecklistItem = async (issueKey: string, itemId: string) => {
        await invoke("delete_checklist_item", { issueKey, itemId });
        invalidateCache(issueKey, "checklist");
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
        getIssueWorklogs,
        getTodayLoggedSecondsForIssues,
        executeTransition,
        getCachedDetails,
        clearIssueCache,
        getStatuses,
        getResolutions,
        getChecklist,
        addChecklistItem,
        editChecklistItem,
        deleteChecklist,
        deleteChecklistItem,
    };
}

/**
 * Primary hook for issue search, pagination, and refresh operations.
 */
export function useTracker() {
    const [issues, setIssues] = useState<Issue[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    const currentOptionsRef = useRef<IssueSearchOptions | undefined>(undefined);
    const nextScrollIdRef = useRef<string | null>(null);

    const releaseScrollSnapshot = useCallback((targetId?: string | null) => {
        const scrollId = targetId ?? nextScrollIdRef.current;
        if (!scrollId) {
            return;
        }
        nextScrollIdRef.current = null;
        void invoke("release_scroll_context", { scroll_id: scrollId }).catch((err) => {
            console.warn(`Failed to release scroll context (${getErrorSummary(err)})`);
        });
    }, []);

    useEffect(() => {
        return () => {
            releaseScrollSnapshot();
        };
    }, [releaseScrollSnapshot]);

    const fetchIssues = useCallback(async (options?: IssueSearchOptions): Promise<boolean> => {
        setLoading(true);
        setError(null);

        const resolvedOptions = options === undefined ? currentOptionsRef.current : normalizeIssueOptions(options);
        currentOptionsRef.current = resolvedOptions;

        if (nextScrollIdRef.current) {
            releaseScrollSnapshot();
        }

        try {
            const page = await requestIssuePage(resolvedOptions, null);
            nextScrollIdRef.current = page.nextScrollId;
            setIssues(page.issues);
            setHasMore(page.hasMore);
            return true;
        } catch (err) {
            setIssues([]);
            setHasMore(false);
            setError(String(err));
            return false;
        } finally {
            setLoading(false);
        }
    }, [releaseScrollSnapshot]);

    const loadMore = useCallback(async (): Promise<boolean> => {
        if (loading || loadingMore) {
            return false;
        }
        const scrollId = nextScrollIdRef.current;
        if (!scrollId) {
            return false;
        }

        setLoadingMore(true);
        setError(null);

        try {
            const page = await requestIssuePage(currentOptionsRef.current, scrollId);
            nextScrollIdRef.current = page.nextScrollId;
            setHasMore(page.hasMore);
            setIssues((prev) => mergeIssueLists(prev, page.issues));
            return page.issues.length > 0;
        } catch (err) {
            setError(String(err));
            return false;
        } finally {
            setLoadingMore(false);
        }
    }, [loading, loadingMore]);

    return { issues, loading, loadingMore, hasMore, error, fetchIssues, loadMore };
}

/**
 * Fetches directory catalogs used to build advanced issue filters.
 */
export function useFilterCatalogs(enabled = true) {
    const [queues, setQueues] = useState<SimpleEntity[]>(cachedQueuesDirectory ?? []);
    const [projects, setProjects] = useState<SimpleEntity[]>(cachedProjectsDirectory ?? []);
    const [users, setUsers] = useState<UserProfile[]>(cachedUsersDirectory ?? []);
    const [loading, setLoading] = useState(
        enabled && (!cachedQueuesDirectory || !cachedProjectsDirectory || !cachedUsersDirectory)
    );
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async (force = false) => {
        setLoading(true);
        setError(null);
        try {
            const [queueData, projectData, userData] = await Promise.all([
                fetchQueuesDirectory(force),
                fetchProjectsDirectory(force),
                fetchUsersDirectory(force),
            ]);
            setQueues(queueData);
            setProjects(projectData);
            setUsers(userData);
            return { queueData, projectData, userData };
        } catch (err) {
            const message = String(err);
            setError(message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            setError(null);
            return;
        }

        if (!cachedQueuesDirectory || !cachedProjectsDirectory || !cachedUsersDirectory) {
            setError(null);
            void refresh();
        } else {
            setLoading(false);
            setError(null);
        }
    }, [enabled, refresh]);

    return { queues, projects, users, loading, error, refresh };
}

/**
 * Subscribes to the native timer event stream and exposes timer commands.
 */
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

        // Native event contract: `timer-tick` emitted by backend timer service.
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

/**
 * Worklog command wrapper for creating issue worklog entries.
 */
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

/**
 * Reads and updates OAuth client credentials stored in the native layer.
 */
export function useClientCredentials() {
    const [info, setInfo] = useState<ClientCredentialsInfo | null>(null);
    const [loading, setLoading] = useState(true);
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

/** Checks whether backend currently has an active persisted auth session. */
export const checkSessionExists = async (): Promise<boolean> => {
    try {
        return await invoke<boolean>("has_session");
    } catch (err) {
        console.warn(`Session check failed (${getErrorSummary(err)})`);
        return false;
    }
};

/**
 * Reads and persists app configuration via native config commands/events.
 */
export function useConfig() {
    const [config, setConfig] = useState<Config | null>(cachedConfig);

    useEffect(() => {
        let cancelled = false;
        fetchConfigCached(!cachedConfig)
            .then((data) => {
                if (!cancelled) setConfig(data);
            })
            .catch((err) => {
                console.warn(`Failed to load config (${getErrorSummary(err)})`);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const handleConfigUpdated = (event: Event) => {
            const customEvent = event as CustomEvent<Config | null>;
            if (customEvent.detail === null) {
                setConfig(null);
                return;
            }
            if (customEvent.detail) {
                setConfig(customEvent.detail);
            }
        };

        window.addEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated as EventListener);
        return () => {
            window.removeEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated as EventListener);
        };
    }, []);

    const save = async (newConfig: Config) => {
        const normalized = normalizeConfig(newConfig);
        await invoke("save_config", { config: normalized });
        cachedConfig = normalized;
        setConfig(normalized);
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent<Config>(CONFIG_UPDATED_EVENT, { detail: normalized }));
        }
    };

    const refresh = async (force = false) => {
        const data = await fetchConfigCached(force);
        setConfig(data);
    };

    return { config, save, refresh };
}

/**
 * Authentication helpers for OAuth exchange and session lifecycle checks.
 */
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

/**
 * Account-oriented helpers for current user profile and logout.
 */
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
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent<Config | null>(CONFIG_UPDATED_EVENT, { detail: null }));
            }
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, []);

    return { profile, loading, error, refresh, logout };
}

/**
 * Auto-update orchestration hook for checking/downloading/installing updates.
 */
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
        // Native updater event contract: `updater://available`.
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

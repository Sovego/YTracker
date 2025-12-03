import { Issue, TimerState, useIssueDetails, Comment, Attachment, Transition, SimpleEntity } from "../hooks/useBridge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Play, Square, Edit2, Save, X, Download, MessageSquare, Paperclip, ChevronDown, Send, Eye, Loader2 } from "lucide-react";
import { useState, useEffect, useRef, useCallback, ImgHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { formatDurationHuman } from "../utils";

const STATUS_CHIPS: Record<string, { dot: string; pill: string; glow: string }> = {
    open: {
        dot: "status-open",
        pill: "bg-slate-100/80 text-slate-600",
        glow: "from-[#f8fafc] via-[#eef2ff] to-[#e2e8f0]"
    },
    inProgress: {
        dot: "status-inProgress",
        pill: "bg-[#3584e4]/15 text-[#1f5fbf]",
        glow: "from-[#dbeafe] via-[#bfdbfe] to-[#d9f0ff]"
    },
    inReview: {
        dot: "status-inReview",
        pill: "bg-[#f6d32d]/15 text-[#9a7b05]",
        glow: "from-[#fff4ce] via-[#fde68a] to-[#fef9c3]"
    },
    needInfo: {
        dot: "status-needInfo",
        pill: "bg-[#9141ac]/15 text-[#6c2d7f]",
        glow: "from-[#f5e1ff] via-[#e9d5ff] to-[#f3e8ff]"
    },
    readyForTest: {
        dot: "status-readyForTest",
        pill: "bg-[#ff7800]/15 text-[#b95000]",
        glow: "from-[#ffe7d6] via-[#ffd3ba] to-[#ffe5c2]"
    },
    closed: {
        dot: "status-closed",
        pill: "bg-[#2ec27e]/15 text-[#1f7f54]",
        glow: "from-[#d1fae5] via-[#bbf7d0] to-[#ccfbf1]"
    },
    resolved: {
        dot: "status-closed",
        pill: "bg-[#2ec27e]/15 text-[#1f7f54]",
        glow: "from-[#d1fae5] via-[#bbf7d0] to-[#ccfbf1]"
    },
    default: {
        dot: "status-open",
        pill: "bg-slate-100 text-slate-600",
        glow: "from-[#f8fafc] via-[#eef2ff] to-[#e2e8f0]"
    }
};

function getStatusChip(key?: string) {
    if (!key) return STATUS_CHIPS.default;
    return STATUS_CHIPS[key as keyof typeof STATUS_CHIPS] || STATUS_CHIPS.default;
}

const markdownPlugins = [remarkGfm];

type InlineImageEntry = {
    status: "loading" | "ready" | "error";
    dataUrl?: string;
    error?: string;
};

const mergeClassNames = (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" ");

const IMAGE_SIZE_SPEC = /\s+=\s*\d+\s*x\s*\d+\s*$/i;
const ATTACHMENT_ID_REGEX = /\/attachments\/([\w-]+)/i;

const normalizeImageSource = (raw?: string | null) => {
    if (!raw) return null;
    let source = raw.trim();
    if (!source) return null;

    if (IMAGE_SIZE_SPEC.test(source)) {
        source = source.replace(IMAGE_SIZE_SPEC, "").trim();
    }

    if (source.startsWith("attachment:")) {
        const id = source.slice("attachment:".length).trim();
        if (id) {
            source = `/ajax/v2/attachments/${id}?inline=true`;
        }
    }

    if (!source.startsWith("/") && source.startsWith("ajax/")) {
        source = `/${source}`;
    }

    return source || null;
};

const shouldProxyImage = (src: string) => {
    if (!src) return false;
    if (src.startsWith("data:")) return false;
    if (/^https?:\/\//i.test(src)) return false;
    if (src.startsWith("//")) return false;
    return src.startsWith("/") || src.startsWith("ajax/");
};

const extractAttachmentIdFromSource = (src: string) => {
    const match = ATTACHMENT_ID_REGEX.exec(src);
    return match ? match[1] : null;
};

const stripImageSizeSyntax = (markdown: string) =>
    markdown.replace(/(!\[[^\]]*\]\([^)]*?)(\s+=\s*\d+\s*x\s*\d+\s*)(\))/gi, "$1$3");

const prepareMarkdownText = (text?: string | null) => {
    if (!text) return "";
    return stripImageSizeSyntax(text);
};

interface IssueDetailProps {
    issue: Issue | null;
    timerState: TimerState;
    onStart: (key: string, summary: string) => Promise<void> | void;
    onStop: () => Promise<void> | void;
    onIssueUpdate: () => void;
}

export function IssueDetail({ issue, timerState, onStart, onStop, onIssueUpdate }: IssueDetailProps) {
    const { getIssue, getComments, addComment, updateIssue, getAttachments, downloadAttachment, previewAttachment, previewInlineImage, getTransitions, executeTransition, getResolutions } = useIssueDetails();

    const [comments, setComments] = useState<Comment[]>([]);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [transitions, setTransitions] = useState<Transition[]>([]);
    const [resolutions, setResolutions] = useState<SimpleEntity[]>([]);
    const [issueDetails, setIssueDetails] = useState<Issue | null>(null);
    const [newComment, setNewComment] = useState("");
    const [inlineImages, setInlineImages] = useState<Record<string, InlineImageEntry>>({});

    const [transitionDialog, setTransitionDialog] = useState<{
        isOpen: boolean;
        transition: Transition | null;
        comment: string;
        resolution: string;
    }>({ isOpen: false, transition: null, comment: "", resolution: "" });

    const [isEditing, setIsEditing] = useState(false);
    const [editSummary, setEditSummary] = useState("");
    const [editDescription, setEditDescription] = useState("");

    const [loadingDetails, setLoadingDetails] = useState(false);
    const [previewAttachmentData, setPreviewAttachmentData] = useState<{ attachment: Attachment; dataUrl: string } | null>(null);
    const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
    const [statusMenuPosition, setStatusMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
    const statusMenuRef = useRef<HTMLDivElement | null>(null);
    const statusButtonRef = useRef<HTMLButtonElement | null>(null);
    const inlineImageRequests = useRef<Set<string>>(new Set());
    const activeIssue = issueDetails ?? issue;

    const closeStatusMenu = useCallback(() => {
        setIsStatusMenuOpen(false);
        setStatusMenuPosition(null);
    }, []);

    const updateStatusMenuPosition = useCallback(() => {
        const button = statusButtonRef.current;
        if (!button) return;

        const rect = button.getBoundingClientRect();
        const minWidth = 220;
        const width = Math.max(rect.width, minWidth);
        const margin = 12;
        let left = rect.right - width;
        if (left < margin) {
            left = margin;
        }
        if (left + width > window.innerWidth - margin) {
            left = Math.max(margin, window.innerWidth - width - margin);
        }
        const top = rect.bottom + 8;

        setStatusMenuPosition({ top, left, width });
    }, []);

    const handleStatusButtonClick = () => {
        if (isStatusMenuOpen) {
            closeStatusMenu();
        } else {
            updateStatusMenuPosition();
            setIsStatusMenuOpen(true);
        }
    };

    const loadDetails = async (key: string) => {
        setLoadingDetails(true);
        try {
            const [detail, c, a, t] = await Promise.all([
                getIssue(key).catch((err) => {
                    console.error("Failed to fetch issue detail", err);
                    return null;
                }),
                getComments(key),
                getAttachments(key),
                getTransitions(key)
            ]);

            if (!issue || issue.key !== key) {
                return;
            }

            if (detail) {
                setIssueDetails(detail);
            }
            setComments(c);
            setAttachments(a);
            setTransitions(t);
        } catch (e) {
            console.error("Failed to load details", e);
            if (issue && issue.key === key) {
                setComments([]);
                setAttachments([]);
                setTransitions([]);
            }
        } finally {
            setLoadingDetails(false);
        }
    };

    useEffect(() => {
        if (issue) {
            setIssueDetails(issue);
            setEditSummary(issue.summary);
            setEditDescription(issue.description);
            setIsEditing(false);
            closeStatusMenu();
            // Load details asynchronously without blocking render
            loadDetails(issue.key).catch(console.error);
            getResolutions().then(setResolutions).catch(console.error);
        } else {
            setIssueDetails(null);
            setComments([]);
            setAttachments([]);
            setTransitions([]);
        }
    }, [issue?.key, closeStatusMenu]); // Only re-run when issue key changes

    useEffect(() => {
        setInlineImages({});
        inlineImageRequests.current.clear();
    }, [issue?.key]);

    useEffect(() => {
        if (!isStatusMenuOpen) return;

        updateStatusMenuPosition();

        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (statusMenuRef.current?.contains(target)) return;
            if (statusButtonRef.current?.contains(target)) return;
            closeStatusMenu();
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeStatusMenu();
            }
        };

        const handleScrollOrResize = () => {
            updateStatusMenuPosition();
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("touchstart", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        window.addEventListener("scroll", handleScrollOrResize, true);
        window.addEventListener("resize", handleScrollOrResize);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("touchstart", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
            window.removeEventListener("scroll", handleScrollOrResize, true);
            window.removeEventListener("resize", handleScrollOrResize);
        };
    }, [isStatusMenuOpen, closeStatusMenu, updateStatusMenuPosition]);

    const handleSave = async () => {
        if (!activeIssue) return;
        try {
            await updateIssue(activeIssue.key, editSummary, editDescription);
            setIsEditing(false);
            onIssueUpdate(); // Refresh parent
        } catch (e) {
            console.error("Failed to update issue", e);
            alert("Failed to update issue");
        }
    };

    const handleAddComment = async () => {
        if (!activeIssue || !newComment.trim()) return;
        try {
            await addComment(activeIssue.key, newComment);
            setNewComment("");
            const c = await getComments(activeIssue.key);
            setComments(c);
        } catch (e) {
            console.error("Failed to add comment", e);
            alert("Failed to add comment");
        }
    };

    const handleTransition = (transitionId: string) => {
        const transition = transitions.find(t => t.id === transitionId);
        if (!transition) return;

        setTransitionDialog({
            isOpen: true,
            transition,
            comment: "",
            resolution: ""
        });
        closeStatusMenu();
    };

    const confirmTransition = async () => {
        if (!activeIssue || !transitionDialog.transition) return;

        try {
            await executeTransition(
                activeIssue.key,
                transitionDialog.transition.id,
                transitionDialog.comment || undefined,
                transitionDialog.resolution || undefined
            );
            onIssueUpdate();
            loadDetails(activeIssue.key);
            setTransitionDialog(prev => ({ ...prev, isOpen: false }));
        } catch (e) {
            console.error("Failed to transition", e);
            alert("Failed to transition");
        }
    };

    const handleDownload = async (att: Attachment) => {
        if (!activeIssue) return;
        const filename = prompt("Save as (filename for Downloads, or full path):", att.name);
        if (filename) {
            try {
                await downloadAttachment(activeIssue.key, att.id, filename);
                alert(`Downloaded to ${filename} (check Downloads folder if you provided just a name)`);
            } catch (e) {
                alert("Download failed: " + e);
            }
        }
    };

    const supportsInlinePreview = (att: Attachment) => {
        if (att.mime_type) {
            return att.mime_type.toLowerCase().startsWith("image/");
        }
        return /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(att.name);
    };

    const requestInlineImage = useCallback((source: string, options?: { force?: boolean }) => {
        if (!source || !shouldProxyImage(source)) {
            return;
        }

        const existing = inlineImages[source];
        if (!options?.force) {
            if (existing?.status === "loading" || existing?.status === "ready") {
                return;
            }
            if (inlineImageRequests.current.has(source)) {
                return;
            }
        }

        inlineImageRequests.current.add(source);
        setInlineImages(prev => ({
            ...prev,
            [source]: { status: "loading" },
        }));

        previewInlineImage(source)
            .catch(async (primaryError) => {
                if (activeIssue) {
                    const attachmentId = extractAttachmentIdFromSource(source);
                    if (attachmentId) {
                        try {
                            return await previewAttachment(activeIssue.key, attachmentId);
                        } catch (fallbackError) {
                            console.error("Fallback attachment preview failed", fallbackError);
                            throw fallbackError;
                        }
                    }
                }
                throw primaryError;
            })
            .then(preview => {
                const mime = preview.mime_type.toLowerCase();
                if (!mime.startsWith("image/")) {
                    throw new Error("Inline resource is not an image");
                }
                setInlineImages(prev => ({
                    ...prev,
                    [source]: {
                        status: "ready",
                        dataUrl: `data:${preview.mime_type};base64,${preview.data_base64}`,
                    },
                }));
            })
            .catch(err => {
                console.error(`Failed to load inline image ${source}`, err);
                setInlineImages(prev => ({
                    ...prev,
                    [source]: {
                        status: "error",
                        error: err instanceof Error ? err.message : String(err),
                    },
                }));
            })
            .finally(() => {
                inlineImageRequests.current.delete(source);
            });
    }, [inlineImages, activeIssue, previewAttachment, previewInlineImage]);

    const handlePreview = async (att: Attachment) => {
        if (!activeIssue) return;

        if (!supportsInlinePreview(att)) {
            setPreviewAttachmentData(null);
            setPreviewLoadingId(null);
            setPreviewError("Preview is available only for image attachments.");
            return;
        }

        setPreviewAttachmentData(null);
        setPreviewError(null);
        setPreviewLoadingId(att.id);
        try {
            const preview = await previewAttachment(activeIssue.key, att.id);
            if (!preview.mime_type.toLowerCase().startsWith("image/")) {
                setPreviewError("Preview is available only for image attachments.");
                return;
            }
            setPreviewAttachmentData({
                attachment: att,
                dataUrl: `data:${preview.mime_type};base64,${preview.data_base64}`,
            });
        } catch (e) {
            console.error("Failed to preview attachment", e);
            setPreviewError("Failed to load preview. Please try downloading instead.");
        } finally {
            setPreviewLoadingId(null);
        }
    };

    const closePreview = () => {
        setPreviewAttachmentData(null);
        setPreviewLoadingId(null);
        setPreviewError(null);
    };

    if (!issue) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                Select an issue to view details
            </div>
        );
    }

    if (!activeIssue) {
        return null;
    }

    const isTimerActive = timerState.active && timerState.issue_key === activeIssue.key;
    const statusChip = getStatusChip(activeIssue.status?.key);

    const statusMenuPortal = (isStatusMenuOpen && statusMenuPosition && typeof document !== "undefined")
        ? createPortal(
            <div
                ref={statusMenuRef}
                role="listbox"
                className="fixed z-[200] flex flex-col bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md"
                style={{
                    top: statusMenuPosition.top,
                    left: statusMenuPosition.left,
                    minWidth: statusMenuPosition.width
                }}
            >
                {transitions.map(t => (
                    <button
                        key={t.id}
                        onClick={() => handleTransition(t.id)}
                        className="text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70"
                    >
                        {t.name}
                    </button>
                ))}
                {transitions.length === 0 && (
                    <div className="px-4 py-2 text-sm text-slate-400">
                        No transitions available
                    </div>
                )}
            </div>,
            document.body
        )
        : null;

    return (
        <div className="relative h-full overflow-hidden">
            {loadingDetails && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 dark:bg-slate-950/70 backdrop-blur">
                    <div className="h-10 w-10 rounded-full border-2 border-blue-500 border-b-transparent animate-spin" />
                </div>
            )}

            <div className="absolute inset-0 pointer-events-none opacity-40 dark:opacity-30" style={{
                backgroundImage:
                    "radial-gradient(circle at 20% 20%, rgba(59,130,246,0.12), transparent 45%), radial-gradient(circle at 80% 0%, rgba(16,185,129,0.12), transparent 40%)"
            }}></div>

            <div className="relative h-full overflow-y-auto px-6 lg:px-12 py-10">
                <div className="max-w-5xl mx-auto space-y-8 pb-24">
                    <section className="gtk-card p-8 relative overflow-visible">
                        <div className={`absolute inset-0 bg-gradient-to-br ${statusChip.glow} opacity-80 pointer-events-none rounded-2xl`}></div>
                        <div className="relative flex flex-col gap-6">
                            <div className="flex flex-wrap items-start justify-between gap-6">
                                <div className="space-y-3">
                                    <p className="gtk-section-title text-slate-500">Issue</p>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <h1 className="text-4xl font-semibold text-slate-900 dark:text-white tracking-tight">
                                            {activeIssue.key}
                                        </h1>
                                        <span className={`status-pill shadow-sm backdrop-blur ${statusChip.pill}`}>
                                            <span className={`status-dot ${statusChip.dot}`}></span>
                                            {activeIssue.status.display}
                                        </span>
                                    </div>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editSummary}
                                            onChange={e => setEditSummary(e.target.value)}
                                            className="w-full rounded-2xl border border-white/70 dark:border-slate-800/70 bg-white/70 dark:bg-slate-900/60 px-4 py-3 text-lg font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    ) : (
                                        <h2 className="text-xl text-slate-700 dark:text-slate-200 max-w-3xl">
                                            {activeIssue.summary}
                                        </h2>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-3">
                                    <div className="relative">
                                        <button
                                            type="button"
                                            ref={statusButtonRef}
                                            onClick={handleStatusButtonClick}
                                            aria-haspopup="listbox"
                                            aria-expanded={isStatusMenuOpen}
                                            className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-white/70 dark:border-slate-800/70 text-sm font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                        >
                                            Change Status
                                            <ChevronDown className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
                                        className="h-11 w-11 rounded-full bg-white/85 dark:bg-slate-900/70 border border-white/70 dark:border-slate-800/70 text-slate-600 dark:text-slate-300 flex items-center justify-center shadow-sm"
                                        title={isEditing ? "Save changes" : "Edit issue"}
                                    >
                                        {isEditing ? <Save className="w-5 h-5" /> : <Edit2 className="w-5 h-5" />}
                                    </button>
                                    {isEditing && (
                                        <button
                                            onClick={() => {
                                                setIsEditing(false);
                                                setEditSummary(activeIssue.summary);
                                                setEditDescription(activeIssue.description);
                                            }}
                                            className="h-11 w-11 rounded-full bg-white/60 dark:bg-slate-900/60 border border-white/50 dark:border-slate-800/60 text-slate-500 flex items-center justify-center"
                                            title="Discard changes"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => (isTimerActive ? onStop() : onStart(activeIssue.key, activeIssue.summary))}
                                        className={`h-11 w-11 rounded-full flex items-center justify-center shadow-md border transition-colors ${isTimerActive
                                            ? "bg-red-500/15 border-red-500/30 text-red-500"
                                            : "bg-blue-500/15 border-blue-500/30 text-blue-600"}`}
                                        title={isTimerActive ? "Stop timer" : "Start timer"}
                                    >
                                        {isTimerActive ? (
                                            <Square className="w-5 h-5 fill-current" />
                                        ) : (
                                            <Play className="w-5 h-5 fill-current" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="gtk-card p-5">
                            <p className="gtk-section-title mb-2">Status</p>
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                <span className={`status-dot ${statusChip.dot}`}></span>
                                {activeIssue.status.display}
                            </div>
                            <p className="text-xs text-slate-500 mt-2">{transitions.length} transitions available</p>
                        </div>
                        <div className="gtk-card p-5">
                            <p className="gtk-section-title mb-2">Priority</p>
                            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                {activeIssue.priority.display}
                            </div>
                            <p className="text-xs text-slate-500 mt-2">Key: {activeIssue.priority.key}</p>
                        </div>
                        <div className="gtk-card p-5">
                            <p className="gtk-section-title mb-2">Timer</p>
                            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                {isTimerActive ? "Tracking" : "Idle"}
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                                Elapsed: {formatDurationHuman(timerState.elapsed)}
                            </p>
                        </div>
                    </section>

                    <section className="gtk-card p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="gtk-section-title mb-0">Description</h3>
                            {isEditing && (
                                <span className="text-xs text-slate-400">Editing mode</span>
                            )}
                        </div>
                        {isEditing ? (
                            <textarea
                                value={editDescription}
                                onChange={e => setEditDescription(e.target.value)}
                                className="w-full h-64 rounded-2xl border border-white/60 dark:border-slate-800/70 bg-white/80 dark:bg-slate-900/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        ) : (
                            <div className="prose prose-slate max-w-none dark:prose-invert">
                                <ReactMarkdown remarkPlugins={markdownPlugins}>
                                    {prepareMarkdownText(activeIssue.description)}
                                </ReactMarkdown>
                            </div>
                        )}
                    </section>

                    {attachments.length > 0 && (
                        <section className="gtk-card p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                                    <Paperclip className="w-4 h-4" /> Attachments
                                </h3>
                                <span className="text-xs text-slate-400">{attachments.length} files</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {attachments.map(att => (
                                    <div key={att.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-white/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-900/50">
                                        <div className="min-w-0">
                                            <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={att.name}>{att.name}</span>
                                            {att.mime_type && (
                                                <span className="text-xs text-slate-500 dark:text-slate-400">{att.mime_type}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {supportsInlinePreview(att) && (
                                                <button
                                                    onClick={() => handlePreview(att)}
                                                    className="h-9 w-9 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center"
                                                    title="Preview attachment"
                                                >
                                                    {previewLoadingId === att.id ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <Eye className="w-4 h-4" />
                                                    )}
                                                </button>
                                            )}
                                            <button onClick={() => handleDownload(att)} className="h-9 w-9 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center" title="Download attachment">
                                                <Download className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className="gtk-card p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                                <MessageSquare className="w-4 h-4" /> Comments
                            </h3>
                            <span className="text-xs text-slate-400">{comments.length || 0} entries</span>
                        </div>

                        <div className="space-y-4 mb-6">
                            {comments.map(comment => (
                                <div key={comment.id} className="border border-white/60 dark:border-slate-800/60 rounded-2xl p-4 bg-white/70 dark:bg-slate-900/50">
                                    <div className="flex items-baseline gap-3 mb-2">
                                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{comment.author}</span>
                                        <span className="text-xs text-slate-400">
                                            {new Date(comment.created_at).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="prose prose-slate max-w-none text-sm text-slate-600 dark:text-slate-300 break-words dark:prose-invert">
                                        <ReactMarkdown
                                            remarkPlugins={markdownPlugins}
                                            components={{
                                                a: ({ node: _node, ...props }) => (
                                                    <a
                                                        {...props}
                                                        target="_blank"
                                                        rel="noreferrer noopener"
                                                        className={mergeClassNames(
                                                            "text-blue-600 dark:text-blue-400 underline-offset-4 hover:underline break-words",
                                                            props.className
                                                        )}
                                                    />
                                                ),
                                                img: ({ node: _node, ...props }) => (
                                                    <CommentImage
                                                        {...props}
                                                        inlineImages={inlineImages}
                                                        requestInlineImage={requestInlineImage}
                                                    />
                                                ),
                                            }}
                                        >
                                            {prepareMarkdownText(comment.text)}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            ))}
                            {comments.length === 0 && (
                                <p className="text-sm text-slate-400">No comments yet.</p>
                            )}
                        </div>

                        <div className="flex flex-col gap-3">
                            <textarea
                                value={newComment}
                                onChange={e => setNewComment(e.target.value)}
                                placeholder="Write a comment..."
                                className="w-full min-h-[90px] rounded-2xl border border-white/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/70 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="flex justify-end">
                                <button
                                    onClick={handleAddComment}
                                    disabled={!newComment.trim()}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                    Add Comment
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            {(previewAttachmentData || previewLoadingId || previewError) && typeof document !== "undefined" && createPortal(
                <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center px-4 py-8">
                    <div className="w-full max-w-3xl bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-white/70 dark:border-slate-800/70 overflow-hidden transform translate-y-3 sm:translate-y-4 lg:translate-y-0 transition-transform">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/70 dark:border-slate-800/70">
                            <div>
                                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Attachment Preview</p>
                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {previewAttachmentData?.attachment.name || "Loading..."}
                                </p>
                            </div>
                            <button onClick={closePreview} className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 bg-slate-50 dark:bg-slate-900 min-h-[320px] flex items-center justify-center">
                            {previewLoadingId ? (
                                <div className="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 gap-3">
                                    <Loader2 className="w-8 h-8 animate-spin" />
                                    <span className="text-sm">Loading preview...</span>
                                </div>
                            ) : previewError ? (
                                <div className="text-center text-sm text-red-500">
                                    {previewError}
                                </div>
                            ) : previewAttachmentData ? (
                                <img
                                    src={previewAttachmentData.dataUrl}
                                    alt={previewAttachmentData.attachment.name}
                                    className="max-h-[70vh] w-full object-contain rounded"
                                />
                            ) : null}
                        </div>
                    </div>
                </div>, document.body
            )}

            {transitionDialog.isOpen && transitionDialog.transition && typeof document !== "undefined" && createPortal(
                <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center px-4 py-8">
                    <div className="w-full max-w-lg bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-white/70 dark:border-slate-800/70 overflow-hidden flex flex-col max-h-[90vh] transform translate-y-3 sm:translate-y-4 lg:translate-y-0 transition-transform">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/70 dark:border-slate-800/70">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                {transitionDialog.transition.name}
                            </h3>
                            <button
                                onClick={() => setTransitionDialog(prev => ({ ...prev, isOpen: false }))}
                                className="h-8 w-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto">
                            {(transitionDialog.transition.to_status?.key === "closed" || transitionDialog.transition.to_status?.key === "resolved") && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                        Resolution
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={transitionDialog.resolution}
                                            onChange={e => setTransitionDialog(prev => ({ ...prev, resolution: e.target.value }))}
                                            className="w-full appearance-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="">Select resolution...</option>
                                            {resolutions.map(res => (
                                                <option key={res.key} value={res.key}>
                                                    {res.display}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                                            <ChevronDown className="h-4 w-4" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Comment (optional)
                                </label>
                                <textarea
                                    value={transitionDialog.comment}
                                    onChange={e => setTransitionDialog(prev => ({ ...prev, comment: e.target.value }))}
                                    placeholder="Add a comment..."
                                    className="w-full h-32 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/70 dark:border-slate-800/70 bg-slate-50/50 dark:bg-slate-900/50">
                            <button
                                onClick={() => setTransitionDialog(prev => ({ ...prev, isOpen: false }))}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmTransition}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
                            >
                                Execute
                            </button>
                        </div>
                    </div>
                </div>, document.body
            )}

            {statusMenuPortal}
        </div>
    );
}

interface CommentImageProps extends ImgHTMLAttributes<HTMLImageElement> {
    inlineImages: Record<string, InlineImageEntry>;
    requestInlineImage: (attachmentId: string, options?: { force?: boolean }) => void;
}

function CommentImage({
    src,
    alt,
    inlineImages,
    requestInlineImage,
    className,
    ...rest
}: CommentImageProps) {
    const normalizedSrc = normalizeImageSource(src);
    const isDataUrl = normalizedSrc?.startsWith("data:") ?? false;
    const needsProxy = normalizedSrc ? shouldProxyImage(normalizedSrc) : false;

    useEffect(() => {
        if (normalizedSrc && needsProxy) {
            requestInlineImage(normalizedSrc);
        }
    }, [normalizedSrc, needsProxy, requestInlineImage]);

    if (!normalizedSrc) {
        return null;
    }

    if (isDataUrl || !needsProxy) {
        return (
            <img
                {...rest}
                src={normalizedSrc}
                alt={alt ?? ""}
                className={mergeClassNames(
                    "rounded-2xl border border-white/60 dark:border-slate-800/60 shadow-sm max-w-full",
                    className
                )}
            />
        );
    }

    const entry = inlineImages[normalizedSrc];
    if (entry?.status === "ready" && entry.dataUrl) {
        return (
            <img
                {...rest}
                src={entry.dataUrl}
                alt={alt ?? ""}
                className={mergeClassNames(
                    "rounded-2xl border border-white/60 dark:border-slate-800/60 shadow-sm max-w-full",
                    className
                )}
            />
        );
    }

    if (entry?.status === "error") {
        return (
            <span className="inline-flex items-center gap-2 rounded-full border border-red-200/70 dark:border-red-500/40 bg-red-50/80 dark:bg-red-500/10 px-3 py-1 text-[11px] text-red-600 dark:text-red-400">
                <span>Image failed</span>
                <button
                    type="button"
                    onClick={() => requestInlineImage(normalizedSrc, { force: true })}
                    className="px-2 py-0.5 rounded-full border border-red-300/80 dark:border-red-500/60 text-[10px] font-semibold"
                >
                    Retry
                </button>
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-900/60 px-3 py-1 text-[11px] text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading image…
        </span>
    );
}

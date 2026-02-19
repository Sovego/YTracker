/**
 * Checklist UI for viewing and editing issue checklist items.
 */
import {
    ChecklistItem,
    ChecklistItemCreatePayload,
    ChecklistItemUpdatePayload,
} from "../hooks/useBridge";
import {
    ChevronDown,
    ChevronUp,
    Plus,
    Trash2,
    Edit2,
    Save,
    Loader2,
    AlertCircle,
    CheckSquare,
    Square,
    Calendar,
    User,
} from "lucide-react";
import { useState, useCallback } from "react";
import { getErrorSummary } from "../utils";

interface ChecklistProps {
    issueKey: string;
    items: ChecklistItem[];
    loading: boolean;
    onRefresh: () => Promise<void>;
    onAddItem: (issueKey: string, item: ChecklistItemCreatePayload) => Promise<void>;
    onEditItem: (issueKey: string, itemId: string, update: ChecklistItemUpdatePayload) => Promise<void>;
    onDeleteItem: (issueKey: string, itemId: string) => Promise<void>;
    onDeleteChecklist: (issueKey: string) => Promise<void>;
}

function formatDeadlineDisplay(dateStr?: string | null) {
    if (!dateStr) return null;
    try {
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return dateStr;
        return date.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
        });
    } catch {
        return dateStr;
    }
}

function toDateInputValue(dateStr?: string | null): string {
    if (!dateStr) return "";
    try {
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return "";
        return date.toISOString().slice(0, 10);
    } catch {
        return "";
    }
}

/**
 * Renders checklist items with inline create/update/delete interactions.
 */
export function Checklist({
    issueKey,
    items,
    loading,
    onRefresh,
    onAddItem,
    onEditItem,
    onDeleteItem,
    onDeleteChecklist,
}: ChecklistProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newText, setNewText] = useState("");
    const [newAssignee, setNewAssignee] = useState("");
    const [newDeadline, setNewDeadline] = useState("");
    const [addLoading, setAddLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editText, setEditText] = useState("");
    const [editAssignee, setEditAssignee] = useState("");
    const [editDeadline, setEditDeadline] = useState("");
    const [editLoading, setEditLoading] = useState(false);

    const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);
    const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

    const doneCount = items.filter((i) => i.checked).length;

    const handleToggle = useCallback(
        async (item: ChecklistItem) => {
            setToggleLoadingId(item.id);
            setError(null);
            try {
                await onEditItem(issueKey, item.id, { checked: !item.checked });
                await onRefresh();
            } catch (err) {
                setError(getErrorSummary(err));
            } finally {
                setToggleLoadingId(null);
            }
        },
        [issueKey, onEditItem, onRefresh]
    );

    const handleAdd = useCallback(async () => {
        if (!newText.trim()) return;
        setAddLoading(true);
        setError(null);
        try {
            const payload: ChecklistItemCreatePayload = {
                text: newText.trim(),
                assignee: newAssignee.trim() || undefined,
                deadline: newDeadline || undefined,
                deadline_type: newDeadline ? "date" : undefined,
            };
            await onAddItem(issueKey, payload);
            setNewText("");
            setNewAssignee("");
            setNewDeadline("");
            setAdding(false);
            await onRefresh();
        } catch (err) {
            setError(getErrorSummary(err));
        } finally {
            setAddLoading(false);
        }
    }, [issueKey, newText, newAssignee, newDeadline, onAddItem, onRefresh]);

    const startEdit = useCallback((item: ChecklistItem) => {
        setEditingItemId(item.id);
        setEditText(item.text);
        setEditAssignee(item.assignee ?? "");
        setEditDeadline(toDateInputValue(item.deadline));
        setError(null);
    }, []);

    const cancelEdit = useCallback(() => {
        setEditingItemId(null);
        setEditText("");
        setEditAssignee("");
        setEditDeadline("");
    }, []);

    const handleSaveEdit = useCallback(async () => {
        if (!editingItemId) return;
        setEditLoading(true);
        setError(null);
        try {
            const update: ChecklistItemUpdatePayload = {
                text: editText.trim() || undefined,
                assignee: editAssignee.trim() || undefined,
                deadline: editDeadline || undefined,
                deadline_type: editDeadline ? "date" : undefined,
            };
            await onEditItem(issueKey, editingItemId, update);
            cancelEdit();
            await onRefresh();
        } catch (err) {
            setError(getErrorSummary(err));
        } finally {
            setEditLoading(false);
        }
    }, [issueKey, editingItemId, editText, editAssignee, editDeadline, onEditItem, onRefresh, cancelEdit]);

    const handleDeleteItem = useCallback(
        async (itemId: string) => {
            setDeleteLoadingId(itemId);
            setError(null);
            try {
                await onDeleteItem(issueKey, itemId);
                await onRefresh();
            } catch (err) {
                setError(getErrorSummary(err));
            } finally {
                setDeleteLoadingId(null);
            }
        },
        [issueKey, onDeleteItem, onRefresh]
    );

    const handleDeleteChecklist = useCallback(async () => {
        if (!confirm("Delete entire checklist? This cannot be undone.")) return;
        setError(null);
        try {
            await onDeleteChecklist(issueKey);
            await onRefresh();
        } catch (err) {
            setError(getErrorSummary(err));
        }
    }, [issueKey, onDeleteChecklist, onRefresh]);

    const progressPercent = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

    return (
        <section className="gtk-card p-6">
            <div className="flex items-center justify-between mb-4">
                <button
                    type="button"
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                >
                    <CheckSquare className="w-4 h-4" />
                    Checklist
                    {collapsed ? (
                        <ChevronDown className="w-4 h-4" />
                    ) : (
                        <ChevronUp className="w-4 h-4" />
                    )}
                </button>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">
                        {doneCount}/{items.length}
                    </span>
                    {items.length > 0 && (
                        <button
                            type="button"
                            onClick={handleDeleteChecklist}
                            className="h-7 w-7 rounded-full bg-red-500/10 text-red-500 dark:text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                            title="Delete entire checklist"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            {items.length > 0 && !collapsed && (
                <div className="mb-4">
                    <div className="h-1.5 w-full bg-slate-200/80 dark:bg-slate-800/80 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 text-sm text-red-500 mb-3 px-1">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {!collapsed && (
                <>
                    {loading ? (
                        <div className="min-h-[80px] flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 gap-2">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span className="text-xs">Loading checklist...</span>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {items.map((item) => {
                                const isEditing = editingItemId === item.id;
                                const isToggling = toggleLoadingId === item.id;
                                const isDeleting = deleteLoadingId === item.id;

                                if (isEditing) {
                                    return (
                                        <div
                                            key={item.id}
                                            className="rounded-xl border border-blue-300/60 dark:border-blue-700/60 bg-blue-50/50 dark:bg-blue-900/20 p-3 space-y-3"
                                        >
                                            <input
                                                type="text"
                                                value={editText}
                                                onChange={(e) => setEditText(e.target.value)}
                                                placeholder="Item text"
                                                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                autoFocus
                                            />
                                            <div className="flex flex-wrap gap-3">
                                                <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                                                    <User className="w-3.5 h-3.5 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={editAssignee}
                                                        onChange={(e) => setEditAssignee(e.target.value)}
                                                        placeholder="Assignee (login)"
                                                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                                    <input
                                                        type="date"
                                                        value={editDeadline}
                                                        onChange={(e) => setEditDeadline(e.target.value)}
                                                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={cancelEdit}
                                                    className="px-3 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                    disabled={editLoading}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleSaveEdit}
                                                    disabled={editLoading || !editText.trim()}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50"
                                                >
                                                    {editLoading ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                        <Save className="w-3 h-3" />
                                                    )}
                                                    Save
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={item.id}
                                        className={`group flex items-start gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                                            item.checked ? "opacity-70" : ""
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleToggle(item)}
                                            disabled={isToggling}
                                            className="mt-0.5 shrink-0 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                        >
                                            {isToggling ? (
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                            ) : item.checked ? (
                                                <CheckSquare className="w-5 h-5 text-blue-500" />
                                            ) : (
                                                <Square className="w-5 h-5" />
                                            )}
                                        </button>

                                        <div className="flex-1 min-w-0">
                                            <span
                                                className={`text-sm text-slate-700 dark:text-slate-200 ${
                                                    item.checked
                                                        ? "line-through text-slate-400 dark:text-slate-500"
                                                        : ""
                                                }`}
                                            >
                                                {item.text}
                                            </span>
                                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                                {item.assignee && (
                                                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                                                        <User className="w-3 h-3" />
                                                        {item.assignee}
                                                    </span>
                                                )}
                                                {item.deadline && (
                                                    <span
                                                        className={`inline-flex items-center gap-1 text-[11px] ${
                                                            item.is_exceeded
                                                                ? "text-red-500"
                                                                : "text-slate-400 dark:text-slate-500"
                                                        }`}
                                                    >
                                                        <Calendar className="w-3 h-3" />
                                                        {formatDeadlineDisplay(item.deadline)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => startEdit(item)}
                                                className="h-7 w-7 rounded-full hover:bg-slate-200/80 dark:hover:bg-slate-700/80 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                                title="Edit item"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteItem(item.id)}
                                                disabled={isDeleting}
                                                className="h-7 w-7 rounded-full hover:bg-red-100/80 dark:hover:bg-red-900/30 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
                                                title="Delete item"
                                            >
                                                {isDeleting ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {items.length === 0 && !adding && (
                                <p className="text-sm text-slate-400 py-2">
                                    No checklist items yet.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Add new item form */}
                    {adding ? (
                        <div className="mt-3 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/50 p-3 space-y-3">
                            <input
                                type="text"
                                value={newText}
                                onChange={(e) => setNewText(e.target.value)}
                                placeholder="New checklist item..."
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        handleAdd();
                                    }
                                    if (e.key === "Escape") setAdding(false);
                                }}
                            />
                            <div className="flex flex-wrap gap-3">
                                <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                                    <User className="w-3.5 h-3.5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={newAssignee}
                                        onChange={(e) => setNewAssignee(e.target.value)}
                                        placeholder="Assignee (login)"
                                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                    <input
                                        type="date"
                                        value={newDeadline}
                                        onChange={(e) => setNewDeadline(e.target.value)}
                                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAdding(false);
                                        setNewText("");
                                        setNewAssignee("");
                                        setNewDeadline("");
                                    }}
                                    className="px-3 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    disabled={addLoading}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAdd}
                                    disabled={addLoading || !newText.trim()}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50"
                                >
                                    {addLoading ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <Plus className="w-3 h-3" />
                                    )}
                                    Add
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setAdding(true)}
                            className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add item
                        </button>
                    )}
                </>
            )}
        </section>
    );
}

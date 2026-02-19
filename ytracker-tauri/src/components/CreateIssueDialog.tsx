/**
 * Modal dialog for creating a new issue in a Tracker queue.
 * Collects queue, summary, description, type, priority, and assignee.
 */
import { useState, useMemo } from "react";
import { useIssueDetails, useFilterCatalogs, type Issue } from "../hooks/useBridge";
import { MarkdownEditor } from "./MarkdownEditor";
import { Loader2, X, Search, ChevronDown } from "lucide-react";

interface CreateIssueDialogProps {
    /** Called when the dialog should close (cancel or after success). */
    onClose: () => void;
    /** Called with the newly created issue on success. */
    onSuccess: (issue: Issue) => void;
}

/**
 * Controlled form dialog for creating a new Tracker issue.
 * Uses `useFilterCatalogs()` for queue, priority, type, and assignee dropdowns.
 */
export function CreateIssueDialog({ onClose, onSuccess }: CreateIssueDialogProps) {
    const { createIssue } = useIssueDetails();
    const { queues, projects, priorities, issueTypes, users, loading: catalogsLoading } = useFilterCatalogs();

    const [queue, setQueue] = useState("");
    const [project, setProject] = useState("");
    const [summary, setSummary] = useState("");
    const [description, setDescription] = useState("");
    const [issueType, setIssueType] = useState("");
    const [priority, setPriority] = useState("");
    const [assignee, setAssignee] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Searchable queue dropdown state
    const [queueSearch, setQueueSearch] = useState("");
    const [queueDropdownOpen, setQueueDropdownOpen] = useState(false);

    const filteredQueues = useMemo(() => {
        const term = queueSearch.trim().toLowerCase();
        if (!term) return queues;
        return queues.filter(
            (q) =>
                q.key.toLowerCase().includes(term) ||
                q.display.toLowerCase().includes(term)
        );
    }, [queues, queueSearch]);

    const selectedQueueLabel = useMemo(() => {
        if (!queue) return "";
        const found = queues.find((q) => q.key === queue);
        return found ? `${found.key} — ${found.display}` : queue;
    }, [queue, queues]);

    // Searchable assignee dropdown state
    const [assigneeSearch, setAssigneeSearch] = useState("");
    const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);

    const filteredUsers = useMemo(() => {
        const term = assigneeSearch.trim().toLowerCase();
        if (!term) return users;
        return users.filter(
            (u) =>
                (u.display ?? "").toLowerCase().includes(term) ||
                (u.login ?? "").toLowerCase().includes(term)
        );
    }, [users, assigneeSearch]);

    const selectedAssigneeLabel = useMemo(() => {
        if (!assignee) return "";
        const found = users.find((u) => u.login === assignee);
        return found?.display ?? assignee;
    }, [assignee, users]);

    // Searchable project dropdown state
    const [projectSearch, setProjectSearch] = useState("");
    const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

    const filteredProjects = useMemo(() => {
        const term = projectSearch.trim().toLowerCase();
        if (!term) return projects;
        return projects.filter(
            (p) =>
                p.key.toLowerCase().includes(term) ||
                p.display.toLowerCase().includes(term)
        );
    }, [projects, projectSearch]);

    const selectedProjectLabel = useMemo(() => {
        if (!project) return "";
        const found = projects.find((p) => p.key === project);
        return found ? `${found.key} — ${found.display}` : project;
    }, [project, projects]);

    const canSubmit = queue.trim() !== "" && summary.trim() !== "" && !submitting;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            const issue = await createIssue({
                queue: queue.trim(),
                summary: summary.trim(),
                description: description.trim() || null,
                issueType: issueType || null,
                priority: priority || null,
                assignee: assignee || null,
                project: project || null,
            });
            onSuccess(issue);
        } catch (err) {
            setError(String(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-lg p-6 border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Create Issue</h2>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {catalogsLoading && (
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-4">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading catalogs…
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Queue (required, searchable) */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Queue <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={queueDropdownOpen ? queueSearch : selectedQueueLabel}
                                onChange={(e) => {
                                    setQueueSearch(e.target.value);
                                    if (!queueDropdownOpen) setQueueDropdownOpen(true);
                                }}
                                onFocus={() => {
                                    setQueueDropdownOpen(true);
                                    setQueueSearch("");
                                }}
                                onBlur={() => {
                                    // Delay to allow click on dropdown items
                                    setTimeout(() => setQueueDropdownOpen(false), 200);
                                }}
                                placeholder="Select queue…"
                                className="w-full px-3 py-2 pr-8 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            />
                            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                        {queueDropdownOpen && filteredQueues.length > 0 && (
                            <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg">
                                {filteredQueues.map((q) => (
                                    <li
                                        key={q.key}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setQueue(q.key);
                                            setQueueSearch("");
                                            setQueueDropdownOpen(false);
                                        }}
                                        className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700 ${
                                            queue === q.key ? "bg-blue-50 dark:bg-slate-700 font-medium" : ""
                                        }`}
                                    >
                                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mr-2">{q.key}</span>
                                        {q.display}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Project (searchable) */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Project
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={projectDropdownOpen ? projectSearch : selectedProjectLabel}
                                onChange={(e) => {
                                    setProjectSearch(e.target.value);
                                    if (!projectDropdownOpen) setProjectDropdownOpen(true);
                                }}
                                onFocus={() => {
                                    setProjectDropdownOpen(true);
                                    setProjectSearch("");
                                }}
                                onBlur={() => {
                                    setTimeout(() => setProjectDropdownOpen(false), 200);
                                }}
                                placeholder="Select project…"
                                className="w-full px-3 py-2 pr-8 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            />
                            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                        {project && (
                            <button
                                type="button"
                                onClick={() => {
                                    setProject("");
                                    setProjectSearch("");
                                }}
                                className="absolute right-8 top-[34px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                aria-label="Clear project"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                        {projectDropdownOpen && filteredProjects.length > 0 && (
                            <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg">
                                {filteredProjects.map((p) => (
                                    <li
                                        key={p.key}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setProject(p.key);
                                            setProjectSearch("");
                                            setProjectDropdownOpen(false);
                                        }}
                                        className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700 ${
                                            project === p.key ? "bg-blue-50 dark:bg-slate-700 font-medium" : ""
                                        }`}
                                    >
                                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mr-2">{p.key}</span>
                                        {p.display}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Summary (required) */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Summary <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            placeholder="Issue summary"
                            className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            autoFocus
                        />
                    </div>

                    {/* Description (markdown editor) */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Description
                        </label>
                        <MarkdownEditor
                            value={description}
                            onChange={setDescription}
                            placeholder="Describe the issue…"
                            minRows={4}
                        />
                    </div>

                    {/* Type */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Type
                            </label>
                            <div className="relative">
                                <select
                                    value={issueType}
                                    onChange={(e) => setIssueType(e.target.value)}
                                    className="w-full appearance-none px-3 py-2 pr-8 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm text-slate-900 dark:text-slate-100"
                                >
                                    <option value="">Default</option>
                                    {issueTypes.map((t) => (
                                        <option key={t.key} value={t.key}>
                                            {t.display}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Priority */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Priority
                            </label>
                            <div className="relative">
                                <select
                                    value={priority}
                                    onChange={(e) => setPriority(e.target.value)}
                                    className="w-full appearance-none px-3 py-2 pr-8 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm text-slate-900 dark:text-slate-100"
                                >
                                    <option value="">Default</option>
                                    {priorities.map((p) => (
                                        <option key={p.key} value={p.key}>
                                            {p.display}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    {/* Assignee (searchable) */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Assignee
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={assigneeDropdownOpen ? assigneeSearch : selectedAssigneeLabel}
                                onChange={(e) => {
                                    setAssigneeSearch(e.target.value);
                                    if (!assigneeDropdownOpen) setAssigneeDropdownOpen(true);
                                }}
                                onFocus={() => {
                                    setAssigneeDropdownOpen(true);
                                    setAssigneeSearch("");
                                }}
                                onBlur={() => {
                                    setTimeout(() => setAssigneeDropdownOpen(false), 200);
                                }}
                                placeholder="Select assignee…"
                                className="w-full px-3 py-2 pr-8 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            />
                            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                        {assignee && (
                            <button
                                type="button"
                                onClick={() => {
                                    setAssignee("");
                                    setAssigneeSearch("");
                                }}
                                className="absolute right-8 top-[34px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                aria-label="Clear assignee"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                        {assigneeDropdownOpen && filteredUsers.length > 0 && (
                            <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg">
                                {filteredUsers.map((u) => (
                                    <li
                                        key={u.login ?? u.display}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setAssignee(u.login ?? "");
                                            setAssigneeSearch("");
                                            setAssigneeDropdownOpen(false);
                                        }}
                                        className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700 ${
                                            assignee === u.login ? "bg-blue-50 dark:bg-slate-700 font-medium" : ""
                                        }`}
                                    >
                                        {u.display ?? u.login}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {error && (
                        <div className="text-red-500 text-sm">{error}</div>
                    )}

                    <div className="flex justify-end gap-2 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center disabled:opacity-50 text-sm"
                        >
                            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Create
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

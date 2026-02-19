/**
 * Reusable Markdown editor with toolbar, keyboard shortcuts, and live preview.
 * Uses react-markdown + remark-gfm for rendering — no extra dependencies.
 */
import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    Bold,
    Italic,
    Heading1,
    Heading2,
    Heading3,
    Link,
    Image,
    List,
    ListOrdered,
    Code,
    FileCode2,
    Quote,
    Eye,
    Pencil,
} from "lucide-react";
import { cn } from "../lib/utils";

const markdownPlugins = [remarkGfm];

/** Describes a text-wrapping or line-prefix toolbar action. */
interface ToolbarAction {
    /** Lucide icon component. */
    icon: React.ComponentType<{ className?: string }>;
    /** Tooltip label. */
    label: string;
    /** Keyboard shortcut (displayed in tooltip). */
    shortcut?: string;
    /** Execute the action on the textarea. */
    apply: (
        textarea: HTMLTextAreaElement,
        value: string,
        onChange: (v: string) => void,
    ) => void;
}

// ─── Toolbar helpers ─────────────────────────────────────────────────────────

/**
 * Wraps the selected text with `before` / `after` markers (e.g. `**`).
 * If nothing is selected, inserts placeholder text and selects it.
 */
function wrapSelection(
    ta: HTMLTextAreaElement,
    value: string,
    onChange: (v: string) => void,
    before: string,
    after: string,
    placeholder: string,
) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);
    const text = selected || placeholder;
    const next = value.slice(0, start) + before + text + after + value.slice(end);
    onChange(next);
    // Restore selection on next tick so React has committed the value.
    requestAnimationFrame(() => {
        ta.focus();
        const selStart = start + before.length;
        ta.setSelectionRange(selStart, selStart + text.length);
    });
}

/**
 * Prepends `prefix` to every selected line. If nothing is selected,
 * inserts a new line with the prefix and a placeholder.
 */
function prefixLines(
    ta: HTMLTextAreaElement,
    value: string,
    onChange: (v: string) => void,
    prefix: string,
    placeholder: string,
) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);

    if (!selected) {
        const insert = prefix + placeholder;
        const next = value.slice(0, start) + insert + value.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(start + prefix.length, start + insert.length);
        });
        return;
    }

    const lines = selected.split("\n").map((l) => prefix + l);
    const replacement = lines.join("\n");
    const next = value.slice(0, start) + replacement + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start, start + replacement.length);
    });
}

// ─── Action definitions ──────────────────────────────────────────────────────

const TOOLBAR_ACTIONS: ToolbarAction[] = [
    {
        icon: Bold,
        label: "Bold",
        shortcut: "Ctrl+B",
        apply: (ta, v, set) => wrapSelection(ta, v, set, "**", "**", "bold text"),
    },
    {
        icon: Italic,
        label: "Italic",
        shortcut: "Ctrl+I",
        apply: (ta, v, set) => wrapSelection(ta, v, set, "_", "_", "italic text"),
    },
    {
        icon: Heading1,
        label: "Heading 1",
        apply: (ta, v, set) => prefixLines(ta, v, set, "# ", "Heading"),
    },
    {
        icon: Heading2,
        label: "Heading 2",
        apply: (ta, v, set) => prefixLines(ta, v, set, "## ", "Heading"),
    },
    {
        icon: Heading3,
        label: "Heading 3",
        apply: (ta, v, set) => prefixLines(ta, v, set, "### ", "Heading"),
    },
    {
        icon: Link,
        label: "Link",
        shortcut: "Ctrl+K",
        apply: (ta, v, set) => wrapSelection(ta, v, set, "[", "](url)", "link text"),
    },
    {
        icon: Image,
        label: "Image",
        apply: (ta, v, set) => wrapSelection(ta, v, set, "![", "](url)", "alt text"),
    },
    {
        icon: List,
        label: "Bullet list",
        apply: (ta, v, set) => prefixLines(ta, v, set, "- ", "item"),
    },
    {
        icon: ListOrdered,
        label: "Numbered list",
        apply: (ta, v, set) => prefixLines(ta, v, set, "1. ", "item"),
    },
    {
        icon: Code,
        label: "Inline code",
        apply: (ta, v, set) => wrapSelection(ta, v, set, "`", "`", "code"),
    },
    {
        icon: FileCode2,
        label: "Code block",
        apply: (ta, v, set) => wrapSelection(ta, v, set, "```\n", "\n```", "code"),
    },
    {
        icon: Quote,
        label: "Quote",
        apply: (ta, v, set) => prefixLines(ta, v, set, "> ", "quote"),
    },
];

/** Shortcut key → action index map (lowercase). */
const SHORTCUT_MAP: Record<string, number> = {
    b: 0, // Bold
    i: 1, // Italic
    k: 5, // Link
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface MarkdownEditorProps {
    /** Current markdown value (controlled). */
    value: string;
    /** Called when the value changes. */
    onChange: (value: string) => void;
    /** Placeholder text for the textarea. */
    placeholder?: string;
    /** Minimum visible rows in the textarea. */
    minRows?: number;
    /** Optional callback when the user clicks the Image toolbar button.
     *  If provided, the Image action triggers this callback instead of
     *  inserting placeholder syntax directly — useful for triggering
     *  a file-picker + upload flow. */
    onAttachImage?: () => void;
    /** Extra CSS classes applied to the outermost wrapper. */
    className?: string;
}

/**
 * A two-tab markdown editor supporting Write (textarea + toolbar) and
 * Preview (rendered markdown) modes. Designed to be a drop-in replacement
 * for plain `<textarea>` elements throughout the app.
 */
export function MarkdownEditor({
    value,
    onChange,
    placeholder,
    minRows = 6,
    onAttachImage,
    className,
}: MarkdownEditorProps) {
    const [tab, setTab] = useState<"write" | "preview">("write");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    /** Apply a toolbar action, routing Image to the external callback if given. */
    const runAction = useCallback(
        (index: number) => {
            const action = TOOLBAR_ACTIONS[index];
            if (!action) return;
            // If external image handler provided and this is the Image action:
            if (action.label === "Image" && onAttachImage) {
                onAttachImage();
                return;
            }
            const ta = textareaRef.current;
            if (!ta) return;
            action.apply(ta, value, onChange);
        },
        [value, onChange, onAttachImage],
    );

    /** Handle keyboard shortcuts inside the textarea. */
    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const idx = SHORTCUT_MAP[e.key.toLowerCase()];
            if (idx !== undefined) {
                e.preventDefault();
                runAction(idx);
            }
        },
        [runAction],
    );

    const handleChange = useCallback(
        (e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
        [onChange],
    );

    /** Insert text at current cursor position (used by external callers via ref-forwarding). */
    const insertAtCursor = useCallback(
        (text: string) => {
            const ta = textareaRef.current;
            if (!ta) {
                onChange(value + text);
                return;
            }
            const start = ta.selectionStart;
            const next = value.slice(0, start) + text + value.slice(ta.selectionEnd);
            onChange(next);
            requestAnimationFrame(() => {
                ta.focus();
                ta.setSelectionRange(start + text.length, start + text.length);
            });
        },
        [value, onChange],
    );

    // Expose insertAtCursor to parent via a stable data attribute on the wrapper
    // so parents can imperatively insert uploaded image syntax.
    const wrapperRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = wrapperRef.current;
        if (el) {
            (el as HTMLDivElement & { _insertAtCursor?: typeof insertAtCursor })._insertAtCursor = insertAtCursor;
        }
    }, [insertAtCursor]);

    return (
        <div ref={wrapperRef} className={cn("rounded-2xl border border-white/60 dark:border-slate-800/70 bg-white/80 dark:bg-slate-900/60 overflow-hidden", className)}>
            {/* ── Tab bar + Toolbar ── */}
            <div className="flex items-center gap-1 border-b border-white/60 dark:border-slate-800/60 px-2 py-1.5 bg-slate-50/60 dark:bg-slate-900/40">
                {/* Tabs */}
                <button
                    type="button"
                    onClick={() => setTab("write")}
                    className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-widest transition-colors",
                        tab === "write"
                            ? "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-sm"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                    )}
                >
                    <Pencil className="w-3 h-3" />
                    Write
                </button>
                <button
                    type="button"
                    onClick={() => setTab("preview")}
                    className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-widest transition-colors",
                        tab === "preview"
                            ? "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-sm"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                    )}
                >
                    <Eye className="w-3 h-3" />
                    Preview
                </button>

                {/* Toolbar — visible only in Write mode */}
                {tab === "write" && (
                    <>
                        <span className="mx-1 w-px h-5 bg-slate-200 dark:bg-slate-700" />
                        <div className="flex items-center gap-0.5 flex-wrap">
                            {TOOLBAR_ACTIONS.map((action, i) => {
                                const Icon = action.icon;
                                return (
                                    <button
                                        key={action.label}
                                        type="button"
                                        onClick={() => runAction(i)}
                                        title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
                                        className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* ── Content area ── */}
            {tab === "write" ? (
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={minRows}
                    className="w-full resize-y px-4 py-3 text-sm bg-transparent focus:outline-none focus:ring-0 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                />
            ) : (
                <div className="prose prose-slate max-w-none dark:prose-invert px-4 py-3 min-h-[calc(1.5em*var(--rows)+1.5rem)]" style={{ "--rows": minRows } as React.CSSProperties}>
                    {value.trim() ? (
                        <ReactMarkdown remarkPlugins={markdownPlugins}>
                            {value}
                        </ReactMarkdown>
                    ) : (
                        <p className="text-sm text-slate-400 italic">Nothing to preview</p>
                    )}
                </div>
            )}
        </div>
    );
}

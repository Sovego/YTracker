import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search as SearchIcon, X } from "lucide-react";

export interface FilterOption {
    id: string;
    label: string;
    description?: string;
}

interface FilterSelectProps {
    label: string;
    placeholder?: string;
    options: FilterOption[];
    selected: string[];
    onChange: (next: string[]) => void;
    emptyLabel?: string;
    disabled?: boolean;
    loading?: boolean;
}

export function FilterSelect({
    label,
    placeholder = "Search...",
    options,
    selected,
    onChange,
    emptyLabel = "Any",
    disabled,
    loading,
}: FilterSelectProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const handleClick = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    const filteredOptions = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return options;
        return options.filter((option) => {
            const haystack = `${option.label} ${option.description ?? ""}`.toLowerCase();
            return haystack.includes(term);
        });
    }, [options, search]);

    const toggleOption = (optionId: string) => {
        if (selected.includes(optionId)) {
            onChange(selected.filter((id) => id !== optionId));
        } else {
            onChange([...selected, optionId]);
        }
    };

    const summaryLabel = selected.length === 0 ? emptyLabel : `${selected.length} selected`;
    const isDisabled = disabled || loading;

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                disabled={isDisabled}
                onClick={() => setOpen((prev) => !prev)}
                className={`w-full inline-flex items-center justify-between px-3 py-2 rounded-2xl border text-sm transition bg-white/80 dark:bg-slate-900/40 border-white/60 dark:border-slate-800/70 ${isDisabled ? "text-slate-400" : "text-slate-600 dark:text-slate-200"
                    }`}
            >
                <div className="text-left">
                    <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">{label}</p>
                    <p className="text-sm font-semibold">{loading ? "Loading…" : summaryLabel}</p>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && !isDisabled && (
                <div className="absolute z-40 mt-2 w-full rounded-2xl border border-white/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xl">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/60 dark:border-slate-800/60">
                        <SearchIcon className="w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={placeholder}
                            className="flex-1 bg-transparent text-sm text-slate-600 dark:text-slate-200 focus:outline-none"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch("")}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <div className="max-h-64 overflow-y-auto py-1">
                        {filteredOptions.length === 0 ? (
                            <p className="px-4 py-3 text-sm text-slate-400">No matches</p>
                        ) : (
                            filteredOptions.map((option) => {
                                const active = selected.includes(option.id);
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => toggleOption(option.id)}
                                        className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 ${active ? "text-blue-600 dark:text-blue-400" : "text-slate-600 dark:text-slate-200"
                                            }`}
                                    >
                                        <div>
                                            <p className="font-medium">{option.label}</p>
                                            {option.description && (
                                                <p className="text-xs text-slate-400 dark:text-slate-500">{option.description}</p>
                                            )}
                                        </div>
                                        {active && <Check className="w-4 h-4" />}
                                    </button>
                                );
                            })
                        )}
                    </div>
                    <div className="flex items-center justify-between px-4 py-2 text-xs border-t border-white/60 dark:border-slate-800/60">
                        <button
                            type="button"
                            onClick={() => onChange([])}
                            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-blue-600 hover:text-blue-500"
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

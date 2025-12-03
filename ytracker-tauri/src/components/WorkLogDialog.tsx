import { useState, useEffect } from "react";
import { useWorkLog } from "../hooks/useBridge";
import { formatDurationHuman } from "../utils";
import { Loader2, X } from "lucide-react";

interface WorkLogDialogProps {
    issueKey: string;
    durationSeconds: number;
    onClose: () => void;
    onSuccess: () => void;
}

export function WorkLogDialog({ issueKey, durationSeconds, onClose, onSuccess }: WorkLogDialogProps) {
    const { logWork, loading, error } = useWorkLog();
    const [duration, setDuration] = useState("");
    const [comment, setComment] = useState("");

    useEffect(() => {
        setDuration(formatDurationHuman(durationSeconds));
    }, [durationSeconds]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const success = await logWork(issueKey, duration, comment);
        if (success) {
            onSuccess();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Log Work: {issueKey}</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Duration
                        </label>
                        <input
                            type="text"
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="e.g. 1h 30m"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Comment
                        </label>
                        <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                            placeholder="What did you work on?"
                        />
                    </div>

                    {error && (
                        <div className="text-red-500 text-sm">{error}</div>
                    )}

                    <div className="flex justify-end gap-2 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center disabled:opacity-50"
                        >
                            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Log Work
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

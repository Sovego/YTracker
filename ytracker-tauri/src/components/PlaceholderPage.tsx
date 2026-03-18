interface PlaceholderPageProps {
    title: string;
}

/**
 * Placeholder page for routes not yet implemented.
 */
export function PlaceholderPage({ title }: PlaceholderPageProps) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 min-h-[400px]">
            <h2 className="text-xl font-semibold text-slate-600 dark:text-slate-300 mb-2">{title}</h2>
            <p className="text-sm">Coming Soon</p>
            <p className="text-xs text-slate-400 mt-2">This feature is under development.</p>
        </div>
    );
}

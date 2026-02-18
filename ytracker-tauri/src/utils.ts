/**
 * Shared UI utility helpers used by the React frontend.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges conditional class names and resolves Tailwind conflicts.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Formats seconds as `HH:MM:SS`.
 */
export function formatDuration(seconds: number): string {
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return [hours, minutes].map((part) => String(part).padStart(2, "0")).join(":");
}

/**
 * Formats duration with compact human units (hours/minutes/seconds).
 */
export function formatDurationHuman(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);

    if (parts.length === 0) {
        return seconds > 0 ? "1m" : "0m";
    }

    return parts.join(" ");
}

/**
 * Extracts a user-facing summary from unknown errors.
 */
export function getErrorSummary(error: unknown): string {
    if (error instanceof Error) {
        const name = error.name || "Error";
        const message = error.message ? `: ${error.message}` : "";
        return `${name}${message}`.slice(0, 180);
    }

    const raw = String(error ?? "unknown").trim();
    if (!raw) {
        return "unknown";
    }

    return raw.slice(0, 180);
}

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkSessionExists, useTracker } from "./useBridge";

const invokeMock = vi.mocked(invoke);

const issue = (key: string, summary: string) => ({
  key,
  summary,
  description: "",
  status: { key: "open", display: "Open" },
  priority: { key: "normal", display: "Normal" },
  tracked_seconds: null,
});

describe("useBridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("fetches first issue page and merges next page by key", async () => {
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_issues" && (args as { scroll_id?: string | null })?.scroll_id == null) {
        return {
          issues: [issue("YT-1", "Initial")],
          next_scroll_id: "scroll-1",
          total_count: 2,
          has_more: true,
        };
      }
      if (command === "get_issues" && (args as { scroll_id?: string | null })?.scroll_id === "scroll-1") {
        return {
          issues: [issue("YT-1", "Updated"), issue("YT-2", "Second")],
          next_scroll_id: null,
          total_count: 2,
          has_more: false,
        };
      }
      if (command === "release_scroll_context") {
        return null;
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useTracker());

    await act(async () => {
      const ok = await result.current.fetchIssues({ query: "  board:YT  " });
      expect(ok).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.issues).toHaveLength(1);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.issues[0].summary).toBe("Initial");
    });

    await act(async () => {
      const loaded = await result.current.loadMore();
      expect(loaded).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.issues).toHaveLength(2);
      expect(result.current.issues[0].summary).toBe("Updated");
      expect(result.current.issues[1].key).toBe("YT-2");
      expect(result.current.hasMore).toBe(false);
    });
  });

  it("coalesces identical in-flight issue requests", async () => {
    let resolveRequest: ((value: {
      issues: ReturnType<typeof issue>[];
      next_scroll_id: string | null;
      total_count: number;
      has_more: boolean;
    }) => void) | undefined;

    const pending = new Promise<{
      issues: ReturnType<typeof issue>[];
      next_scroll_id: string | null;
      total_count: number;
      has_more: boolean;
    }>((resolve) => {
      resolveRequest = resolve;
    });

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_issues" && (args as { scroll_id?: string | null })?.scroll_id == null) {
        return pending;
      }
      if (command === "release_scroll_context") {
        return null;
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useTracker());

    let p1!: Promise<boolean>;
    let p2!: Promise<boolean>;

    await act(async () => {
      p1 = result.current.fetchIssues({ query: "me:current" });
      p2 = result.current.fetchIssues({ query: "me:current" });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);

    resolveRequest?.({
      issues: [issue("YT-3", "Deferred")],
      next_scroll_id: null,
      total_count: 1,
      has_more: false,
    });

    await act(async () => {
      const values = await Promise.all([p1, p2]);
      expect(values).toEqual([true, true]);
    });

    await waitFor(() => {
      expect(result.current.issues).toHaveLength(1);
      expect(result.current.issues[0].key).toBe("YT-3");
    });
  });

  it("returns false when session check fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("native failure"));
    await expect(checkSessionExists()).resolves.toBe(false);
  });
});

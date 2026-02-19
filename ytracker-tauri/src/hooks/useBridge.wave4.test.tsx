import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth, useClientCredentials, useIssueDetails, useUpdater } from "./useBridge";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);

describe("useBridge wave4", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    checkMock.mockReset();
    relaunchMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("caches comments and invalidates cache after addComment", async () => {
    let commentsFetchCount = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_comments") {
        commentsFetchCount += 1;
        return [{ id: String(commentsFetchCount), text: "c", author: "a", created_at: "2026-02-19" }];
      }
      if (command === "add_comment") {
        return null;
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useIssueDetails());

    const first = await result.current.getComments("YT-C1");
    const second = await result.current.getComments("YT-C1");
    expect(first[0].id).toBe("1");
    expect(second[0].id).toBe("1");
    expect(commentsFetchCount).toBe(1);

    await result.current.addComment("YT-C1", "hello");
    const third = await result.current.getComments("YT-C1");
    expect(third[0].id).toBe("2");
    expect(commentsFetchCount).toBe(2);
  });

  it("coalesces status requests into one in-flight promise", async () => {
    let resolveStatuses: ((value: Array<{ key: string; display: string }>) => void) | undefined;
    const pending = new Promise<Array<{ key: string; display: string }>>((resolve) => {
      resolveStatuses = resolve;
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_statuses") {
        return pending;
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useIssueDetails());

    const p1 = result.current.getStatuses();
    const p2 = result.current.getStatuses();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    resolveStatuses?.([{ key: "open", display: "Open" }]);
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      [{ key: "open", display: "Open" }],
      [{ key: "open", display: "Open" }],
    ]);
  });

  it("loads credentials and handles refresh failures", async () => {
    invokeMock
      .mockResolvedValueOnce({ client_id: "client", has_client_secret: true })
      .mockRejectedValueOnce(new Error("credentials unavailable"));

    const { result } = renderHook(() => useClientCredentials());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.info?.client_id).toBe("client");
    });

    await act(async () => {
      await expect(result.current.refresh()).rejects.toThrow("credentials unavailable");
    });

    await waitFor(() => {
      expect(result.current.error).toContain("credentials unavailable");
    });
  });

  it("exchangeCode sends null orgId for empty value and reports errors", async () => {
    invokeMock.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("bad code"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      const ok = await result.current.exchangeCode("abc", "", "yandex360");
      expect(ok).toBe(true);
    });

    expect(invokeMock).toHaveBeenCalledWith("exchange_code", {
      code: "abc",
      orgId: null,
      orgType: "yandex360",
    });

    await act(async () => {
      const ok = await result.current.exchangeCode("bad", "org-1", "cloud");
      expect(ok).toBe(false);
    });

    expect(result.current.error).toContain("bad code");
  });

  it("checkForUpdates sets available payload and up-to-date state", async () => {
    checkMock
      .mockResolvedValueOnce({
        version: "1.2.3",
        date: "2026-02-19T10:00:00.000Z",
        body: "notes",
      } as never)
      .mockResolvedValueOnce(null as never);

    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      const found = await result.current.checkForUpdates();
      expect(found).toBe(true);
    });

    expect(result.current.available?.version).toBe("1.2.3");
    expect(result.current.upToDate).toBe(false);

    await act(async () => {
      const found = await result.current.checkForUpdates();
      expect(found).toBe(false);
    });

    expect(result.current.available).toBeNull();
    expect(result.current.upToDate).toBe(true);
  });

  it("installUpdate updates state and respects restart option", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: { event: string; data?: { chunkLength?: number; contentLength?: number } }) => void) => {
      onEvent({ event: "Started", data: { contentLength: 10 } });
      onEvent({ event: "Progress", data: { chunkLength: 4, contentLength: 10 } });
      onEvent({ event: "Progress", data: { chunkLength: 6, contentLength: 10 } });
      onEvent({ event: "Finished", data: { contentLength: 10 } });
    });

    checkMock.mockResolvedValueOnce({ version: "9.9.9", downloadAndInstall } as never);

    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      const ok = await result.current.installUpdate({ restart: false });
      expect(ok).toBe(true);
    });

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(result.current.installedVersion).toBe("9.9.9");
    expect(result.current.upToDate).toBe(true);
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("createIssue invokes create_issue command with correct params", async () => {
    const createdIssue = { key: "Q-1", summary: "New", status: { key: "open", display: "Open" } };
    invokeMock.mockResolvedValueOnce(createdIssue);

    const { result } = renderHook(() => useIssueDetails());

    const issue = await result.current.createIssue({
      queue: "Q",
      summary: "New",
      description: "desc",
      issueType: "task",
      priority: "2",
      assignee: "alice",
      project: "proj-1",
    });

    expect(issue).toEqual(createdIssue);
    expect(invokeMock).toHaveBeenCalledWith("create_issue", {
      queue: "Q",
      summary: "New",
      description: "desc",
      issueType: "task",
      priority: "2",
      assignee: "alice",
      project: "proj-1",
      attachmentIds: null,
    });
  });

  it("updateIssueExtended invokes update_issue_extended command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useIssueDetails());

    await result.current.updateIssueExtended("YT-10", {
      summary: "Updated",
      priority: "1",
      tagsAdd: ["urgent"],
    });

    expect(invokeMock).toHaveBeenCalledWith("update_issue_extended", expect.objectContaining({
      issueKey: "YT-10",
      summary: "Updated",
      priority: "1",
      tagsAdd: ["urgent"],
    }));
  });

  it("uploadAttachment invokes upload_attachment command", async () => {
    invokeMock.mockResolvedValueOnce({ id: 123, name: "file.txt" });

    const { result } = renderHook(() => useIssueDetails());

    const attachment = await result.current.uploadAttachment("YT-5", "/tmp/file.txt");

    expect(attachment).toEqual({ id: 123, name: "file.txt" });
    expect(invokeMock).toHaveBeenCalledWith("upload_attachment", {
      issueKey: "YT-5",
      filePath: "/tmp/file.txt",
    });
  });

  it("uploadTempAttachment invokes upload_temp_attachment command", async () => {
    invokeMock.mockResolvedValueOnce({ id: 456, name: "temp.png" });

    const { result } = renderHook(() => useIssueDetails());

    const attachment = await result.current.uploadTempAttachment("/tmp/temp.png");

    expect(attachment).toEqual({ id: 456, name: "temp.png" });
    expect(invokeMock).toHaveBeenCalledWith("upload_temp_attachment", {
      filePath: "/tmp/temp.png",
    });
  });
});

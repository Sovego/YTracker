import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAccount,
  useConfig,
  useFilterCatalogs,
  useTimer,
  useWorkLog,
  type Config,
  type TimerState,
} from "./useBridge";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

describe("useBridge wave2", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("loads filter catalogs and supports force refresh", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_queues") return [{ key: "Q1", display: "Queue 1" }];
      if (command === "get_projects") return [{ key: "P1", display: "Project 1" }];
      if (command === "get_users") return [{ login: "alice", display: "Alice" }];
      if (command === "get_priorities") return [{ key: "2", display: "Normal" }];
      if (command === "get_issue_types") return [{ key: "task", display: "Task" }];
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useFilterCatalogs(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.queues).toHaveLength(1);
      expect(result.current.projects).toHaveLength(1);
      expect(result.current.users).toHaveLength(1);
    });

    await act(async () => {
      await result.current.refresh(true);
    });

    const commandCalls = invokeMock.mock.calls.map((call) => String(call[0]));
    expect(commandCalls.filter((command) => command === "get_queues").length).toBeGreaterThanOrEqual(2);
  });

  it("saves config and updates local state", async () => {
    const initialConfig: Config = {
      timer_notification_interval: 10,
      workday_hours: 8,
      workday_start_time: "09:00",
      workday_end_time: "17:00",
    };

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_config") return initialConfig;
      if (command === "save_config") return null;
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useConfig());

    await waitFor(() => {
      expect(result.current.config?.timer_notification_interval).toBe(10);
    });

    const updated: Config = {
      timer_notification_interval: 30,
      workday_hours: 7,
      workday_start_time: "10:00",
      workday_end_time: "18:00",
    };

    await act(async () => {
      await result.current.save(updated);
    });

    expect(result.current.config?.timer_notification_interval).toBe(30);
    expect(invokeMock).toHaveBeenCalledWith("save_config", { config: updated });
  });

  it("handles worklog submission errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("worklog failed"));

    const { result } = renderHook(() => useWorkLog());

    await act(async () => {
      const ok = await result.current.logWork("YT-404", "1h", "comment");
      expect(ok).toBe(false);
    });

    expect(result.current.error).toContain("worklog failed");
  });

  it("subscribes to timer events and updates state", async () => {
    let timerListener: ((event: { payload: TimerState }) => void) | null = null;

    listenMock.mockImplementation(async (_eventName: string, cb: unknown) => {
      timerListener = cb as (event: { payload: TimerState }) => void;
      return () => {};
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_timer_state") {
        return {
          active: false,
          issue_key: null,
          issue_summary: null,
          start_time: null,
          elapsed: 0,
        } satisfies TimerState;
      }
      if (command === "start_timer" || command === "stop_timer") {
        return command === "stop_timer" ? [60, "YT-55"] : null;
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useTimer());

    await waitFor(() => {
      expect(result.current.state.active).toBe(false);
    });

    act(() => {
      timerListener?.({
        payload: {
          active: true,
          issue_key: "YT-55",
          issue_summary: "Tracking",
          start_time: 1,
          elapsed: 120,
        },
      });
    });

    expect(result.current.state.active).toBe(true);
    expect(result.current.state.issue_key).toBe("YT-55");
  });

  it("loads profile and clears it on logout", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_current_user") {
        return { login: "alice", display: "Alice" };
      }
      if (command === "logout") return null;
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useAccount());

    await waitFor(() => {
      expect(result.current.profile?.login).toBe("alice");
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.profile).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("logout");
  });
});

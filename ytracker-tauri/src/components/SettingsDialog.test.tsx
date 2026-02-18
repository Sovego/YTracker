import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";

const mocked = vi.hoisted(() => ({
  logoutMock: vi.fn(async () => {}),
  saveMock: vi.fn(async () => {}),
  checkForUpdatesMock: vi.fn(async () => false),
  installUpdateMock: vi.fn(async () => false),
  account: {
    profile: { display: "Alice", login: "alice" },
    loading: false,
    error: null as string | null,
  },
  updater: {
    available: null as null | { version: string; automatic: boolean; notes?: string | null; pub_date?: string | null },
    checking: false,
    installing: false,
    progress: null as null | { downloaded: number; total?: number | null },
    lastCheckedAt: null as number | null,
    upToDate: false,
    error: null as string | null,
    installedVersion: null as string | null,
  },
}));

vi.mock("../hooks/useBridge", () => ({
  useAccount: () => ({
    profile: mocked.account.profile,
    loading: mocked.account.loading,
    error: mocked.account.error,
    logout: mocked.logoutMock,
  }),
  useConfig: () => ({
    config: {
      timer_notification_interval: 15,
      workday_hours: 8,
      workday_start_time: "09:00",
      workday_end_time: "17:00",
    },
    save: mocked.saveMock,
  }),
  useUpdater: () => ({
    ...mocked.updater,
    checkForUpdates: mocked.checkForUpdatesMock,
    installUpdate: mocked.installUpdateMock,
  }),
}));

describe("SettingsDialog", () => {
  beforeEach(() => {
    mocked.logoutMock.mockClear();
    mocked.saveMock.mockClear();
    mocked.checkForUpdatesMock.mockClear();
    mocked.installUpdateMock.mockClear();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} onLogout={vi.fn()} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves interval and validates workday schedule", async () => {
    render(<SettingsDialog onClose={vi.fn()} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "30 min" }));
    await waitFor(() => {
      expect(mocked.saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ timer_notification_interval: 30 })
      );
    });

    const timeInputs = screen.getAllByDisplayValue(/\d{2}:\d{2}/);
    fireEvent.change(timeInputs[0], { target: { value: "10:00" } });
    fireEvent.change(timeInputs[1], { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    expect(screen.getByText("End time must be later than start time.")).toBeInTheDocument();
  });

  it("logs out and notifies parent callbacks", async () => {
    const onLogout = vi.fn();
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} onLogout={onLogout} />);

    fireEvent.click(screen.getByRole("button", { name: /Logout/i }));

    await waitFor(() => {
      expect(mocked.logoutMock).toHaveBeenCalledTimes(1);
      expect(onLogout).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

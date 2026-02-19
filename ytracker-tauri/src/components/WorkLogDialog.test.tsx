import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { WorkLogDialog } from "./WorkLogDialog";

const logWorkMock = vi.fn();

vi.mock("../hooks/useBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useBridge")>();
  return {
    ...actual,
    useWorkLog: () => ({
      logWork: logWorkMock,
      loading: false,
      error: null,
    }),
  };
});

describe("WorkLogDialog", () => {
  beforeEach(() => {
    logWorkMock.mockReset();
  });

  it("submits worklog and calls success callback", async () => {
    logWorkMock.mockResolvedValue(true);
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <WorkLogDialog
        issueKey="YT-333"
        durationSeconds={3660}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const durationInput = screen.getByPlaceholderText("e.g. 1h 30m");
    expect((durationInput as HTMLInputElement).value).toBe("1h 1m");

    fireEvent.change(screen.getByPlaceholderText("What did you work on?"), {
      target: { value: "Implemented tests" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Log Work" }));

    await waitFor(() => {
      expect(logWorkMock).toHaveBeenCalledWith("YT-333", "1h 1m", "Implemented tests");
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("calls close when cancel is clicked", () => {
    const onClose = vi.fn();

    render(
      <WorkLogDialog
        issueKey="YT-333"
        durationSeconds={10}
        onClose={onClose}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

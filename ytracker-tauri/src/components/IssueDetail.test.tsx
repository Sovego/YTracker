import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetail } from "./IssueDetail";

const bridgeMocks = vi.hoisted(() => ({
  getIssue: vi.fn(),
  getComments: vi.fn(),
  addComment: vi.fn(),
  updateIssue: vi.fn(),
  updateIssueExtended: vi.fn(),
  getAttachments: vi.fn(),
  downloadAttachment: vi.fn(),
  previewAttachment: vi.fn(),
  previewInlineImage: vi.fn(),
  getTransitions: vi.fn(),
  getIssueWorklogs: vi.fn(),
  executeTransition: vi.fn(),
  getResolutions: vi.fn(),
  getChecklist: vi.fn(),
  addChecklistItem: vi.fn(),
  editChecklistItem: vi.fn(),
  deleteChecklist: vi.fn(),
  deleteChecklistItem: vi.fn(),
  createIssue: vi.fn(),
}));

vi.mock("../hooks/useBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useBridge")>();
  return {
    ...actual,
    useIssueDetails: () => ({
      ...bridgeMocks,
    }),
    useFilterCatalogs: () => ({
      queues: [],
      projects: [],
      users: [],
      priorities: [{ key: "2", display: "Normal" }],
      issueTypes: [{ key: "task", display: "Task" }],
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
  };
});

vi.mock("./Checklist", () => ({
  Checklist: () => <div>checklist-mock</div>,
}));

const issue = {
  key: "YT-500",
  summary: "Issue details title",
  description: "Some description",
  status: { key: "open", display: "Open" },
  priority: { key: "major", display: "Major" },
  tracked_seconds: null,
};

const timerIdle = {
  active: false,
  issue_key: null,
  issue_summary: null,
  start_time: null,
  elapsed: 0,
};

describe("IssueDetail", () => {
  beforeEach(() => {
    Object.values(bridgeMocks).forEach((mockFn) => mockFn.mockReset());

    bridgeMocks.getIssue.mockResolvedValue(issue);
    bridgeMocks.getComments.mockResolvedValue([
      { id: "c1", text: "First comment", author: "alice", created_at: "2026-02-19T10:00:00.000Z" },
    ]);
    bridgeMocks.getAttachments.mockResolvedValue([
      { id: "a1", name: "image.png", url: "/a1", mime_type: "image/png" },
    ]);
    bridgeMocks.getTransitions.mockResolvedValue([
      { id: "t1", name: "Resolve", to_status: { key: "resolved", display: "Resolved" } },
    ]);
    bridgeMocks.getChecklist.mockResolvedValue([]);
    bridgeMocks.getIssueWorklogs.mockResolvedValue([]);
    bridgeMocks.getResolutions.mockResolvedValue([{ key: "fixed", display: "Fixed" }]);
    bridgeMocks.updateIssue.mockResolvedValue(null);
    bridgeMocks.updateIssueExtended.mockResolvedValue(undefined);
    bridgeMocks.addComment.mockResolvedValue(null);
    bridgeMocks.executeTransition.mockResolvedValue(null);

    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("downloaded.png");
  });

  it("renders empty state when issue is null", () => {
    render(
      <IssueDetail
        issue={null}
        timerState={timerIdle}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onIssueUpdate={vi.fn()}
      />
    );

    expect(screen.getByText("Select an issue to view details")).toBeInTheDocument();
  });

  it("starts timer for selected issue", async () => {
    const onStart = vi.fn();

    render(
      <IssueDetail
        issue={issue}
        timerState={timerIdle}
        onStart={onStart}
        onStop={vi.fn()}
        onIssueUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Issue details title")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Start timer"));
    expect(onStart).toHaveBeenCalledWith("YT-500", "Issue details title");
  });

  it("stops timer when active issue is tracked", async () => {
    const onStop = vi.fn();

    render(
      <IssueDetail
        issue={issue}
        timerState={{ ...timerIdle, active: true, issue_key: "YT-500", elapsed: 1800 }}
        onStart={vi.fn()}
        onStop={onStop}
        onIssueUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle("Stop timer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Stop timer"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("edits issue summary and saves changes", async () => {
    const onIssueUpdate = vi.fn();

    render(
      <IssueDetail
        issue={issue}
        timerState={timerIdle}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onIssueUpdate={onIssueUpdate}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle("Edit issue")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Edit issue"));
    fireEvent.change(screen.getByDisplayValue("Issue details title"), {
      target: { value: "Updated summary" },
    });

    fireEvent.click(screen.getByTitle("Save changes"));

    await waitFor(() => {
      expect(bridgeMocks.updateIssueExtended).toHaveBeenCalledWith("YT-500", expect.objectContaining({
        summary: "Updated summary",
        description: "Some description",
      }));
      expect(onIssueUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("adds comment and refreshes comments list", async () => {
    render(
      <IssueDetail
        issue={issue}
        timerState={timerIdle}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onIssueUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Write a comment...")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Write a comment..."), {
      target: { value: "New comment" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Comment/i }));

    await waitFor(() => {
      expect(bridgeMocks.addComment).toHaveBeenCalledWith("YT-500", "New comment");
      expect(bridgeMocks.getComments).toHaveBeenCalledWith("YT-500");
    });
  });

  it("opens transition dialog and executes transition", async () => {
    const onIssueUpdate = vi.fn();

    render(
      <IssueDetail
        issue={issue}
        timerState={timerIdle}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onIssueUpdate={onIssueUpdate}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Change Status/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Change Status/i }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Execute" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => {
      expect(bridgeMocks.executeTransition).toHaveBeenCalledWith("YT-500", "t1", undefined, "fixed");
      expect(onIssueUpdate).toHaveBeenCalled();
    });
  });
});

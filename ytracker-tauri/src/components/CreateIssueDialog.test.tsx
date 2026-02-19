import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateIssueDialog } from "./CreateIssueDialog";

const createIssueMock = vi.fn();

vi.mock("../hooks/useBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useBridge")>();
  return {
    ...actual,
    useIssueDetails: () => ({
      createIssue: createIssueMock,
    }),
    useFilterCatalogs: () => ({
      queues: [
        { key: "BACK", display: "Backend" },
        { key: "FRONT", display: "Frontend" },
      ],
      priorities: [
        { key: "1", display: "Critical" },
        { key: "2", display: "Normal" },
      ],
      issueTypes: [
        { key: "task", display: "Task" },
        { key: "bug", display: "Bug" },
      ],
      users: [
        { login: "alice", display: "Alice Smith" },
        { login: "bob", display: "Bob Jones" },
      ],
      projects: [
        { key: "proj-1", display: "Alpha Project" },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
  };
});

describe("CreateIssueDialog", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createIssueMock.mockReset();
    onClose = vi.fn();
    onSuccess = vi.fn();
  });

  function renderDialog() {
    return render(<CreateIssueDialog onClose={onClose} onSuccess={onSuccess} />);
  }

  it("renders form fields", () => {
    renderDialog();

    expect(screen.getByText("Create Issue")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Select queue…")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Issue summary")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe the issue…")).toBeInTheDocument();

    // Type and Priority selects
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();

    // Buttons
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("disables submit when queue and summary are empty", () => {
    renderDialog();

    const submitBtn = screen.getByRole("button", { name: "Create" });
    expect(submitBtn).toBeDisabled();
  });

  it("enables submit when queue and summary are filled", () => {
    renderDialog();

    // Select queue by focusing input and clicking queue dropdown item
    const queueInput = screen.getByPlaceholderText("Select queue…");
    fireEvent.focus(queueInput);

    const queueDropdown = screen.getByText("Backend");
    fireEvent.mouseDown(queueDropdown);

    // Fill summary
    fireEvent.change(screen.getByPlaceholderText("Issue summary"), {
      target: { value: "Test issue" },
    });

    const submitBtn = screen.getByRole("button", { name: "Create" });
    expect(submitBtn).not.toBeDisabled();
  });

  it("submits the form and calls onSuccess", async () => {
    const createdIssue = {
      key: "BACK-42",
      summary: "Test issue",
      description: "Details",
      status: { key: "open", display: "Open" },
      priority: { key: "2", display: "Normal" },
      tracked_seconds: null,
    };
    createIssueMock.mockResolvedValue(createdIssue);

    renderDialog();

    // Select queue
    const queueInput = screen.getByPlaceholderText("Select queue…");
    fireEvent.focus(queueInput);
    fireEvent.mouseDown(screen.getByText("Backend"));

    // Fill summary
    fireEvent.change(screen.getByPlaceholderText("Issue summary"), {
      target: { value: "Test issue" },
    });

    // Fill description
    fireEvent.change(screen.getByPlaceholderText("Describe the issue…"), {
      target: { value: "Details" },
    });

    // Select type
    const typeSelect = screen.getByText("Type").closest("div")!.querySelector("select")!;
    fireEvent.change(typeSelect, { target: { value: "bug" } });

    // Select priority
    const prioritySelect = screen.getByText("Priority").closest("div")!.querySelector("select")!;
    fireEvent.change(prioritySelect, { target: { value: "2" } });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createIssueMock).toHaveBeenCalledWith({
        queue: "BACK",
        summary: "Test issue",
        description: "Details",
        issueType: "bug",
        priority: "2",
        assignee: null,
        project: null,
      });
      expect(onSuccess).toHaveBeenCalledWith(createdIssue);
    });
  });

  it("shows error message on submission failure", async () => {
    createIssueMock.mockRejectedValue(new Error("Network error"));

    renderDialog();

    // Select queue
    const queueInput = screen.getByPlaceholderText("Select queue…");
    fireEvent.focus(queueInput);
    fireEvent.mouseDown(screen.getByText("Backend"));

    // Fill summary
    fireEvent.change(screen.getByPlaceholderText("Issue summary"), {
      target: { value: "Failing issue" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });

    // Ensure onSuccess was NOT called
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when X button is clicked", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("filters queues by search term", () => {
    renderDialog();

    const queueInput = screen.getByPlaceholderText("Select queue…");
    fireEvent.focus(queueInput);

    // Both queues visible initially
    expect(screen.getByText("Backend")).toBeInTheDocument();
    expect(screen.getByText("Frontend")).toBeInTheDocument();

    // Type filter
    fireEvent.change(queueInput, { target: { value: "front" } });

    // Only Frontend should remain
    expect(screen.queryByText("Backend")).not.toBeInTheDocument();
    expect(screen.getByText("Frontend")).toBeInTheDocument();
  });

  it("sends null for optional empty fields", async () => {
    const createdIssue = {
      key: "BACK-1",
      summary: "Minimal",
      description: null,
      status: { key: "open", display: "Open" },
      priority: null,
      tracked_seconds: null,
    };
    createIssueMock.mockResolvedValue(createdIssue);

    renderDialog();

    // Select queue
    const queueInput = screen.getByPlaceholderText("Select queue…");
    fireEvent.focus(queueInput);
    fireEvent.mouseDown(screen.getByText("Backend"));

    // Fill only required summary
    fireEvent.change(screen.getByPlaceholderText("Issue summary"), {
      target: { value: "Minimal" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createIssueMock).toHaveBeenCalledWith({
        queue: "BACK",
        summary: "Minimal",
        description: null,
        issueType: null,
        priority: null,
        assignee: null,
        project: null,
      });
    });
  });
});

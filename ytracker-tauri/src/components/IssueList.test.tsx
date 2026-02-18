import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueList } from "./IssueList";

const issues = [
  {
    key: "YT-11",
    summary: "Open task",
    description: "desc",
    status: { key: "open", display: "Open" },
    priority: { key: "major", display: "Major" },
    tracked_seconds: null,
  },
  {
    key: "YT-12",
    summary: "Unknown metadata",
    description: "desc",
    status: { key: "unknown", display: "Unknown" },
    priority: { key: "unknown", display: "Unknown" },
    tracked_seconds: null,
  },
];

describe("IssueList", () => {
  it("renders issues and triggers selection callback", () => {
    const onSelect = vi.fn();
    render(<IssueList issues={issues} selectedKey={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("YT-11"));
    expect(onSelect).toHaveBeenCalledWith(issues[0]);
  });

  it("applies selected styling for active issue", () => {
    const { container } = render(<IssueList issues={issues} selectedKey="YT-12" onSelect={vi.fn()} />);
    const selectedButton = screen.getByText("YT-12").closest("button");
    expect(selectedButton?.className).toContain("border-blue-400/60");
    expect(container.textContent).toContain("Unknown metadata");
  });
});

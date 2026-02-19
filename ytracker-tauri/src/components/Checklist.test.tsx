import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Checklist } from "./Checklist";

const item = {
  id: "1",
  text: "Prepare release",
  checked: false,
  assignee: "alice",
  deadline: "2026-02-25",
  deadline_type: "date",
  is_exceeded: false,
  item_type: "item",
};

describe("Checklist", () => {
  const onRefresh = vi.fn(async () => {});
  const onAddItem = vi.fn(async () => {});
  const onEditItem = vi.fn(async () => {});
  const onDeleteItem = vi.fn(async () => {});
  const onDeleteChecklist = vi.fn(async () => {});

  beforeEach(() => {
    onRefresh.mockClear();
    onAddItem.mockClear();
    onEditItem.mockClear();
    onDeleteItem.mockClear();
    onDeleteChecklist.mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("adds new checklist item and refreshes", async () => {
    render(
      <Checklist
        issueKey="YT-1"
        items={[item]}
        loading={false}
        onRefresh={onRefresh}
        onAddItem={onAddItem}
        onEditItem={onEditItem}
        onDeleteItem={onDeleteItem}
        onDeleteChecklist={onDeleteChecklist}
      />
    );

    fireEvent.click(screen.getByText("Add item"));
    fireEvent.change(screen.getByPlaceholderText("New checklist item..."), {
      target: { value: "Write tests" },
    });
    fireEvent.change(screen.getByPlaceholderText("Assignee (login)"), {
      target: { value: "bob" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add/i }));

    await waitFor(() => {
      expect(onAddItem).toHaveBeenCalledWith("YT-1", {
        text: "Write tests",
        assignee: "bob",
        deadline: undefined,
        deadline_type: undefined,
      });
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("edits, toggles and deletes checklist items", async () => {
    render(
      <Checklist
        issueKey="YT-1"
        items={[item]}
        loading={false}
        onRefresh={onRefresh}
        onAddItem={onAddItem}
        onEditItem={onEditItem}
        onDeleteItem={onDeleteItem}
        onDeleteChecklist={onDeleteChecklist}
      />
    );

    fireEvent.click(screen.getByTitle("Edit item"));
    fireEvent.change(screen.getByPlaceholderText("Item text"), {
      target: { value: "Prepare release v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(onEditItem).toHaveBeenCalledWith("YT-1", "1", expect.objectContaining({ text: "Prepare release v2" }));
    });

    fireEvent.click(screen.getByTitle("Delete item"));
    await waitFor(() => {
      expect(onDeleteItem).toHaveBeenCalledWith("YT-1", "1");
    });

    fireEvent.click(screen.getByTitle("Delete entire checklist"));
    await waitFor(() => {
      expect(onDeleteChecklist).toHaveBeenCalledWith("YT-1");
    });
  });
});

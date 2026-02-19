import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSelect, type FilterOption } from "./FilterSelect";

const options: FilterOption[] = [
  { id: "open", label: "Open", description: "Ready to start" },
  { id: "inProgress", label: "In Progress", description: "Active" },
  { id: "closed", label: "Closed", description: "Done" },
];

describe("FilterSelect", () => {
  it("opens dropdown, filters options, toggles selection and clears", () => {
    const onChange = vi.fn();

    render(
      <FilterSelect
        label="Status"
        options={options}
        selected={["open"]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /status/i }));

    const search = screen.getByPlaceholderText("Search...");
    fireEvent.change(search, { target: { value: "prog" } });

    const listContainer = screen.getByRole("button", { name: /in progress/i }).closest("button");
    expect(listContainer).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /in progress/i }));
    expect(onChange).toHaveBeenCalledWith(["open", "inProgress"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith([]);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });

  it("shows no matches state", () => {
    render(
      <FilterSelect
        label="Status"
        options={options}
        selected={[]}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /status/i }));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});

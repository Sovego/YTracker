import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimerWidget } from "./Timer";

describe("TimerWidget", () => {
  it("does not render when timer is inactive", () => {
    const { container } = render(
      <TimerWidget
        state={{ active: false, issue_key: null, start_time: null, elapsed: 0 }}
        onStop={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders timer state and calls stop handler", () => {
    const onStop = vi.fn();

    render(
      <TimerWidget
        state={{
          active: true,
          issue_key: "YT-201",
          issue_summary: "Implement test wave",
          start_time: 1,
          elapsed: 3660,
        }}
        onStop={onStop}
      />
    );

    expect(screen.getByText("Tracking")).toBeInTheDocument();
    expect(screen.getByText("01:01")).toBeInTheDocument();
    expect(screen.getByText("Implement test wave")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Stop Timer"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

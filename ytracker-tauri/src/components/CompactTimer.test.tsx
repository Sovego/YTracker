import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompactTimer } from "./CompactTimer";

describe("CompactTimer", () => {
    it("shows idle state when timer is not active", () => {
        render(
            <CompactTimer
                state={{ active: false, issue_key: null, start_time: null, elapsed: 0 }}
                onStop={vi.fn()}
            />
        );

        expect(screen.getByText("No timer")).toBeInTheDocument();
        expect(screen.queryByTitle("Stop Timer")).not.toBeInTheDocument();
    });

    it("displays issue key and elapsed time when active", () => {
        render(
            <CompactTimer
                state={{
                    active: true,
                    issue_key: "PROJ-42",
                    start_time: 1,
                    elapsed: 1395,
                }}
                onStop={vi.fn()}
            />
        );

        expect(screen.getByText("PROJ-42")).toBeInTheDocument();
        expect(screen.getByText("00:23")).toBeInTheDocument();
    });

    it("calls onStop when stop button is clicked", () => {
        const onStop = vi.fn();

        render(
            <CompactTimer
                state={{
                    active: true,
                    issue_key: "PROJ-42",
                    start_time: 1,
                    elapsed: 60,
                }}
                onStop={onStop}
            />
        );

        fireEvent.click(screen.getByTitle("Stop Timer"));
        expect(onStop).toHaveBeenCalledTimes(1);
    });
});

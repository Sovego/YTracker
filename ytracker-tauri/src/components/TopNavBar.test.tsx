import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TopNavBar } from "./TopNavBar";

const defaultTimer = { active: false, issue_key: null, start_time: null, elapsed: 0 };

const renderNav = (props?: Partial<Parameters<typeof TopNavBar>[0]>) =>
    render(
        <MemoryRouter initialEntries={["/tasks"]}>
            <TopNavBar
                timerState={defaultTimer}
                onStopTimer={vi.fn()}
                todayTrackedSeconds={0}
                targetTodaySeconds={28800}
                loadingTodayProgress={false}
                onSettingsClick={vi.fn()}
                {...props}
            />
        </MemoryRouter>
    );

describe("TopNavBar", () => {
    it("renders branding and page tabs", () => {
        renderNav();

        expect(screen.getByText("YTracker")).toBeInTheDocument();
        expect(screen.getByText("Tasks")).toBeInTheDocument();
        expect(screen.getByText("Boards")).toBeInTheDocument();
        expect(screen.getByText("Timesheets")).toBeInTheDocument();
        expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    it("highlights active tab based on route", () => {
        renderNav();

        const tasksLink = screen.getByText("Tasks").closest("a");
        expect(tasksLink?.getAttribute("aria-current")).toBe("page");
    });

    it("shows today progress", () => {
        renderNav({ todayTrackedSeconds: 18000, targetTodaySeconds: 28800 });

        expect(screen.getByText(/5h/)).toBeInTheDocument();
    });

    it("renders compact timer when active", () => {
        renderNav({
            timerState: {
                active: true,
                issue_key: "PROJ-42",
                issue_summary: "Fix login",
                start_time: 1,
                elapsed: 120,
            },
        });

        expect(screen.getByText("PROJ-42")).toBeInTheDocument();
    });

    it("calls onSettingsClick when settings button is clicked", () => {
        const onSettingsClick = vi.fn();
        renderNav({ onSettingsClick });

        fireEvent.click(screen.getByTitle("Settings"));
        expect(onSettingsClick).toHaveBeenCalledTimes(1);
    });
});

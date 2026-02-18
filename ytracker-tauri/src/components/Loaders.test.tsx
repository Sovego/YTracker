import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AppBootScreen,
  IssueDetailPlaceholder,
  IssueListSkeleton,
  RefreshOverlay,
  SettingsCardSkeleton,
} from "./Loaders";

describe("Loaders", () => {
  it("renders app boot screen with custom text", () => {
    render(<AppBootScreen title="Booting" subtitle="YT" caption="Syncing" />);
    expect(screen.getByText("Booting")).toBeInTheDocument();
    expect(screen.getByText("YT")).toBeInTheDocument();
    expect(screen.getByText("Syncing")).toBeInTheDocument();
  });

  it("renders issue list skeleton with configured row count", () => {
    render(<IssueListSkeleton rows={4} />);
    const loadingContainer = screen.getByLabelText("Loading issues");
    expect(loadingContainer.children).toHaveLength(4);
  });

  it("renders refresh and placeholder states", () => {
    render(
      <>
        <RefreshOverlay label="Refreshing now" />
        <IssueDetailPlaceholder />
      </>
    );
    expect(screen.getByText("Refreshing now")).toBeInTheDocument();
    expect(screen.getByText("Preparing issue workspace…")).toBeInTheDocument();
  });

  it("renders settings card skeleton", () => {
    render(<SettingsCardSkeleton title="Loading account" />);
    expect(screen.getByText("Loading account")).toBeInTheDocument();
  });
});

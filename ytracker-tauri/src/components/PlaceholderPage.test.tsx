import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceholderPage } from "./PlaceholderPage";

describe("PlaceholderPage", () => {
    it("renders the page title and coming soon message", () => {
        render(<PlaceholderPage title="Boards" />);

        expect(screen.getByText("Boards")).toBeInTheDocument();
        expect(screen.getByText("Coming Soon")).toBeInTheDocument();
    });
});

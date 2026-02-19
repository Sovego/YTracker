import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor", () => {
    it("renders with Write tab active by default", () => {
        render(<MarkdownEditor value="" onChange={vi.fn()} />);

        expect(screen.getByText("Write")).toBeInTheDocument();
        expect(screen.getByText("Preview")).toBeInTheDocument();
        // Textarea should be visible
        expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders the textarea with the given value and placeholder", () => {
        render(
            <MarkdownEditor
                value="Hello **world**"
                onChange={vi.fn()}
                placeholder="Write something..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Write something...");
        expect(textarea).toBeInTheDocument();
        expect(textarea).toHaveValue("Hello **world**");
    });

    it("calls onChange when text is typed", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor value="" onChange={onChange} placeholder="Type..." />,
        );

        const textarea = screen.getByPlaceholderText("Type...");
        fireEvent.change(textarea, { target: { value: "new text" } });
        expect(onChange).toHaveBeenCalledWith("new text");
    });

    it("switches to Preview tab and renders markdown", () => {
        render(
            <MarkdownEditor
                value={"# Hello\n\nThis is **bold**."}
                onChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByText("Preview"));

        // Rendered markdown should contain a heading element
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello");
        expect(screen.getByText(/bold/)).toBeInTheDocument();
        // Textarea should no longer be visible
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("shows 'Nothing to preview' for empty value in Preview", () => {
        render(<MarkdownEditor value="" onChange={vi.fn()} />);

        fireEvent.click(screen.getByText("Preview"));
        expect(screen.getByText("Nothing to preview")).toBeInTheDocument();
    });

    it("switches back to Write tab from Preview", () => {
        render(
            <MarkdownEditor
                value="some text"
                onChange={vi.fn()}
                placeholder="Type..."
            />,
        );

        fireEvent.click(screen.getByText("Preview"));
        expect(screen.queryByPlaceholderText("Type...")).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("Write"));
        expect(screen.getByPlaceholderText("Type...")).toBeInTheDocument();
    });

    it("renders toolbar buttons in Write mode", () => {
        render(<MarkdownEditor value="" onChange={vi.fn()} />);

        expect(screen.getByTitle("Bold (Ctrl+B)")).toBeInTheDocument();
        expect(screen.getByTitle("Italic (Ctrl+I)")).toBeInTheDocument();
        expect(screen.getByTitle("Link (Ctrl+K)")).toBeInTheDocument();
        expect(screen.getByTitle("Heading 1")).toBeInTheDocument();
        expect(screen.getByTitle("Code block")).toBeInTheDocument();
        expect(screen.getByTitle("Quote")).toBeInTheDocument();
    });

    it("hides toolbar in Preview mode", () => {
        render(<MarkdownEditor value="" onChange={vi.fn()} />);

        fireEvent.click(screen.getByText("Preview"));

        expect(screen.queryByTitle("Bold (Ctrl+B)")).not.toBeInTheDocument();
        expect(screen.queryByTitle("Italic (Ctrl+I)")).not.toBeInTheDocument();
    });

    it("applies Bold toolbar action with no selection", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="hello"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        // Place cursor at end
        textarea.setSelectionRange(5, 5);

        fireEvent.click(screen.getByTitle("Bold (Ctrl+B)"));

        // Should insert **bold text** at cursor position
        expect(onChange).toHaveBeenCalledWith("hello**bold text**");
    });

    it("applies Bold toolbar action wrapping selected text", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="hello world"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        // Select "world"
        textarea.setSelectionRange(6, 11);

        fireEvent.click(screen.getByTitle("Bold (Ctrl+B)"));

        expect(onChange).toHaveBeenCalledWith("hello **world**");
    });

    it("applies Italic toolbar action", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="text"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 4);

        fireEvent.click(screen.getByTitle("Italic (Ctrl+I)"));

        expect(onChange).toHaveBeenCalledWith("_text_");
    });

    it("applies Heading 1 toolbar action", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="title"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 5);

        fireEvent.click(screen.getByTitle("Heading 1"));

        expect(onChange).toHaveBeenCalledWith("# title");
    });

    it("applies Link toolbar action", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="click here"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 10);

        fireEvent.click(screen.getByTitle("Link (Ctrl+K)"));

        expect(onChange).toHaveBeenCalledWith("[click here](url)");
    });

    it("applies Inline code toolbar action", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="const x = 1"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 11);

        fireEvent.click(screen.getByTitle("Inline code"));

        expect(onChange).toHaveBeenCalledWith("`const x = 1`");
    });

    it("applies Quote toolbar action", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="some quote"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 10);

        fireEvent.click(screen.getByTitle("Quote"));

        expect(onChange).toHaveBeenCalledWith("> some quote");
    });

    it("applies Bullet list to single-line text", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="item text"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 9);

        fireEvent.click(screen.getByTitle("Bullet list"));

        expect(onChange).toHaveBeenCalledWith("- item text");
    });

    it("fires Ctrl+B keyboard shortcut", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="test"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 4);

        fireEvent.keyDown(textarea, { key: "b", ctrlKey: true });

        expect(onChange).toHaveBeenCalledWith("**test**");
    });

    it("fires Ctrl+I keyboard shortcut", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="test"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 4);

        fireEvent.keyDown(textarea, { key: "i", ctrlKey: true });

        expect(onChange).toHaveBeenCalledWith("_test_");
    });

    it("fires Ctrl+K keyboard shortcut", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value="test"
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...") as HTMLTextAreaElement;
        textarea.setSelectionRange(0, 4);

        fireEvent.keyDown(textarea, { key: "k", ctrlKey: true });

        expect(onChange).toHaveBeenCalledWith("[test](url)");
    });

    it("calls onAttachImage when Image button is clicked and handler is provided", () => {
        const onAttachImage = vi.fn();
        render(
            <MarkdownEditor
                value=""
                onChange={vi.fn()}
                onAttachImage={onAttachImage}
            />,
        );

        fireEvent.click(screen.getByTitle("Image"));
        expect(onAttachImage).toHaveBeenCalledTimes(1);
    });

    it("inserts image placeholder when Image button is clicked without handler", () => {
        const onChange = vi.fn();
        render(
            <MarkdownEditor
                value=""
                onChange={onChange}
                placeholder="Type..."
            />,
        );

        fireEvent.click(screen.getByTitle("Image"));
        expect(onChange).toHaveBeenCalledWith("![alt text](url)");
    });

    it("applies minRows to the textarea", () => {
        render(
            <MarkdownEditor
                value=""
                onChange={vi.fn()}
                minRows={10}
                placeholder="Type..."
            />,
        );

        const textarea = screen.getByPlaceholderText("Type...");
        expect(textarea).toHaveAttribute("rows", "10");
    });

    it("applies custom className to wrapper", () => {
        const { container } = render(
            <MarkdownEditor
                value=""
                onChange={vi.fn()}
                className="my-custom-class"
            />,
        );

        expect(container.firstChild).toHaveClass("my-custom-class");
    });
});

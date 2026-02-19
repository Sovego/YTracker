import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("lib/utils cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    const result = cn("px-2", false, "px-4", "text-sm", undefined, "text-base");
    expect(result).toContain("px-4");
    expect(result).not.toContain("px-2");
    expect(result).toContain("text-base");
  });
});

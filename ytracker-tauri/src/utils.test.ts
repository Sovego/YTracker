import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationHuman, getErrorSummary } from "./utils";

describe("utils", () => {
  it("formats duration as HH:MM", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(3599)).toBe("00:59");
    expect(formatDuration(3600)).toBe("01:00");
    expect(formatDuration(7380)).toBe("02:03");
  });

  it("formats human duration with fallback", () => {
    expect(formatDurationHuman(0)).toBe("0m");
    expect(formatDurationHuman(1)).toBe("1m");
    expect(formatDurationHuman(59)).toBe("1m");
    expect(formatDurationHuman(3600)).toBe("1h");
    expect(formatDurationHuman(3660)).toBe("1h 1m");
  });

  it("builds a safe error summary", () => {
    expect(getErrorSummary(new Error("boom"))).toMatch(/^Error: boom/);
    expect(getErrorSummary(" plain text ")).toBe("plain text");
    expect(getErrorSummary("" as unknown)).toBe("unknown");
  });
});

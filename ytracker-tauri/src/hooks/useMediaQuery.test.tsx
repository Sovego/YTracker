import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

describe("useMediaQuery", () => {
  it("returns current match value and reacts to change events", () => {
    let listener: ((event: MediaQueryListEvent) => void) | null = null;

    const matchMediaMock = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: (_event: string, cb: (event: MediaQueryListEvent) => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock,
    });

    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => {
      listener?.({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });
});

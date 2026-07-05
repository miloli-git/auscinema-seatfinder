import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue (47c fix #6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the initial value immediately, before any timer fires", () => {
    const { result } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: 74 },
    });
    expect(result.current).toBe(74);
  });

  it("coalesces a rapid burst of updates into exactly one settled value after the delay", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: 74 },
    });

    // Simulate a slider drag firing many intermediate values well under the debounce window.
    for (const v of [75, 76, 77, 78, 79, 80]) {
      rerender({ value: v });
      act(() => {
        vi.advanceTimersByTime(50); // never reaches 350ms of silence
      });
    }
    expect(result.current).toBe(74); // still the pre-drag value — nothing has settled yet

    act(() => {
      vi.advanceTimersByTime(350); // drag stops; silence long enough to settle
    });
    expect(result.current).toBe(80); // settles once, to the FINAL value, not once per intermediate step
  });

  it("updates again after a second settle period following further changes", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: 2 },
    });
    rerender({ value: 3 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current).toBe(3);

    rerender({ value: 4 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current).toBe(4);
  });
});

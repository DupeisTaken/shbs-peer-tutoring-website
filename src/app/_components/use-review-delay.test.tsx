/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useReviewDelay } from "./use-review-delay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("ignores wall-clock jumps and becomes ready at the exact monotonic boundary", () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
  });
  const { result } = renderHook(() => useReviewDelay(3_000));
  expect(result.current.remaining).toBe(3);
  act(() => {
    vi.setSystemTime(new Date("2040-01-01"));
    fireEvent.focus(window);
  });
  expect(result.current.remaining).toBe(3);
  expect(result.current.ready()).toBe(false);
  act(() => {
    vi.advanceTimersByTime(2_999);
  });
  expect(result.current.remaining).toBe(1);
  expect(result.current.ready()).toBe(false);
  act(() => {
    vi.setSystemTime(new Date("2000-01-01"));
    vi.advanceTimersByTime(1);
  });
  expect(result.current.remaining).toBe(0);
  expect(result.current.ready()).toBe(true);
});

it("samples elapsed time on visibility recovery and gives a reopened review a fresh delay", () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const first = renderHook(() => useReviewDelay(3_000));
  now = 10_000;
  expect(first.result.current.ready()).toBe(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(first.result.current.remaining).toBe(0);
  first.unmount();
  const next = renderHook(() => useReviewDelay(3_000));
  expect(next.result.current.remaining).toBe(3);
  expect(next.result.current.ready()).toBe(false);
});

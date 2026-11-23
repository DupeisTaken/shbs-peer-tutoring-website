// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useServerBoundaryClock } from "./use-server-clock";

function Probe({
  serverNowMs,
  boundariesMs,
}: {
  serverNowMs: number | undefined;
  boundariesMs: readonly number[];
}) {
  const now = useServerBoundaryClock(serverNowMs, boundariesMs);
  return <output data-testid="now">{now === undefined ? "none" : String(now)}</output>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("returns undefined without scheduling timers when no server anchor is supplied", () => {
  vi.useFakeTimers();
  render(<Probe serverNowMs={undefined} boundariesMs={[1_000]} />);
  expect(screen.getByTestId("now").textContent).toBe("none");
  expect(vi.getTimerCount()).toBe(0);
});

it("advances across each boundary using monotonic performance.now deltas and stops after the last", () => {
  vi.useFakeTimers();
  let monotonic = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const anchor = Date.parse("2026-10-30T08:00:00.000Z");
  const first = anchor + 5_000;
  const second = anchor + 12_000;

  render(<Probe serverNowMs={anchor} boundariesMs={[second, first]} />);
  expect(screen.getByTestId("now").textContent).toBe(String(anchor));

  // Just before the first boundary: no re-render yet.
  monotonic = 5_999;
  act(() => {
    vi.advanceTimersByTime(4_999);
  });
  expect(screen.getByTestId("now").textContent).toBe(String(anchor));

  // Cross the first boundary.
  monotonic = 6_000;
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByTestId("now").textContent).toBe(String(first));

  // Cross the second (final) boundary and stop scheduling timers.
  monotonic = 13_000;
  act(() => {
    vi.advanceTimersByTime(7_000);
  });
  expect(screen.getByTestId("now").textContent).toBe(String(second));
  expect(vi.getTimerCount()).toBe(0);
});

it("re-checks immediately on window focus and resets elapsed offset on a fresh server anchor", () => {
  vi.useFakeTimers();
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const anchor1 = Date.parse("2026-10-30T08:00:00.000Z");
  const boundary = anchor1 + 120_000;

  const view = render(<Probe serverNowMs={anchor1} boundariesMs={[boundary]} />);
  // Simulate sleep/jump detected upon window focus before the 60 s chunk fires.
  monotonic = 125_000;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.getByTestId("now").textContent).toBe(String(anchor1 + 125_000));

  const anchor2 = anchor1 + 130_000;
  view.rerender(<Probe serverNowMs={anchor2} boundariesMs={[anchor2 + 10_000]} />);
  expect(screen.getByTestId("now").textContent).toBe(String(anchor2));
});

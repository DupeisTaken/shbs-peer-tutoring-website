// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRecruitmentStatus } from "./recruitment-notice";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Status({ serverNow }: { serverNow: string }) {
  const status = useRecruitmentStatus({
    enabled: true,
    opensAt: "2026-09-22T08:00:01Z",
    closesAt: "2026-09-22T08:00:03Z",
    previewUrl: null,
    serverNow,
  });
  return <p role="status">{status}</p>;
}
it("opens and closes a stale tab from server time despite an incorrect client wall clock", async () => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "performance", "Date"],
  });
  vi.setSystemTime(new Date("1990-01-01"));
  const view = render(<Status serverNow="2026-09-22T08:00:00Z" />);
  expect(screen.getByRole("status").textContent).toBe("scheduled");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole("status").textContent).toBe("open");
  // A fresh anchor must not inherit the prior response's elapsed time.
  view.rerender(<Status serverNow="2026-09-22T08:00:02Z" />);
  expect(screen.getByRole("status").textContent).toBe("open");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole("status").textContent).toBe("ended");
});

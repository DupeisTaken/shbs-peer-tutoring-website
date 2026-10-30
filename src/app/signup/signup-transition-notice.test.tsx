/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import type { PublicSignupTransition } from "~/lib/public-signup-transition";
import {
  SignupTransitionNotice,
  useSignupClock,
} from "./signup-transition-notice";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const refresh = vi.fn();
function data(): PublicSignupTransition {
  return {
    serverNow: "2026-10-30T00:00:00Z",
    timeZone: "Asia/Shanghai",
    current: {
      termId: "q1",
      label: "2026–27 Q1",
      kind: "quarter",
      window: {
        enabled: true,
        opensAt: null,
        closesAt: "2026-10-30T00:00:02Z",
        previewUrl: null,
      },
    },
    next: {
      label: "2026–27 Q2",
      opensAt: "2026-10-31T00:00:00Z",
      closesAt: null,
      enabled: true,
      previewUrl: null,
      preparationValid: true,
      refresh: null,
    },
  };
}
function View({
  value,
  verified = true,
}: {
  value: PublicSignupTransition;
  verified?: boolean;
}) {
  const now = useSignupClock(value.serverNow);
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <SignupTransitionNotice
        data={value}
        now={now}
        refresh={refresh}
        verified={verified}
      />
    </NextIntlClientProvider>
  );
}

it("switches an open tab to the next-quarter timer at closure using server time", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  render(<View value={data()} />);
  expect(screen.queryByRole("timer")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(screen.getByRole("timer")).toBeTruthy();
  expect(
    screen.getByText(/2026–27 Q2 Tutee Signup — Planned Opening/),
  ).toBeTruthy();
  expect(screen.getByText(/2026–27 Q1 tutee signup is closed/)).toBeTruthy();
  expect(screen.getByText(/must be activated/)).toBeTruthy();
});

it("keeps elapsed time when the next countdown mounts at closure", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  const value = data();
  value.next!.opensAt = "2026-10-30T00:00:10Z";
  render(<View value={value} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(within(screen.getByRole("timer")).getByText("08")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  expect(within(screen.getByRole("timer")).getByText("05")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.getByText(/Applications are not open yet/)).toBeTruthy();
});

it("restores the current intake when a manual pause is removed and reacts to edits", () => {
  const value = data();
  value.current!.window.enabled = false;
  const mounted = render(<View value={value} />);
  expect(screen.getByRole("timer")).toBeTruthy();
  const unannounced = structuredClone(value);
  unannounced.next!.opensAt = null;
  mounted.rerender(<View value={unannounced} />);
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.getByText(/has not been announced/)).toBeTruthy();
  const reopened = structuredClone(value);
  reopened.current!.window.enabled = true;
  reopened.current!.window.closesAt = null;
  mounted.rerender(<View value={reopened} />);
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.queryByText(/next intake/)).toBeNull();
});

it("replaces an expired future countdown with pending activation and bounded read recovery", async () => {
  vi.useFakeTimers();
  refresh.mockClear();
  const value = data();
  value.current!.window.enabled = false;
  value.next!.opensAt = "2026-10-30T00:00:02Z";
  render(<View value={value} />);
  expect(screen.getByRole("timer")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.getByText(/Applications are not open yet/)).toBeTruthy();
  const first = refresh.mock.calls.length;
  expect(first).toBeGreaterThan(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(refresh.mock.calls.length).toBe(first);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(refresh.mock.calls.length).toBe(first + 1);
});

it("removes a cancelled or blocked refresh promise while retaining the target label", () => {
  const value = data();
  value.current!.window.enabled = false;
  value.next!.refresh = {
    executeAt: value.next!.opensAt!,
    state: "CANCELLED",
    valid: false,
  };
  const mounted = render(<View value={value} />);
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.getByText(/was cancelled/)).toBeTruthy();
  const blocked = structuredClone(value);
  blocked.next!.refresh!.state = "BLOCKED";
  mounted.rerender(<View value={blocked} />);
  expect(screen.getByText(/needs review/)).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "2026–27 Q2 Tutee Signup" }),
  ).toBeTruthy();
});

it("formats the advertised opening with the fresh program timezone rather than a stale provider", () => {
  const value = data();
  value.current!.window.enabled = false;
  value.timeZone = "America/New_York";
  value.next!.opensAt = "2027-01-15T14:00:00Z";
  render(<View value={value} />);
  expect(screen.getByText(/EST \(GMT-05:00\)/)).toBeTruthy();
  expect(screen.getByText(/9:00/)).toBeTruthy();
});

it("suspends a cached opening promise on read failure and restores it after recovery", () => {
  const value = data();
  value.current!.window.enabled = false;
  const mounted = render(<View value={value} />);
  expect(screen.getByRole("timer")).toBeTruthy();
  mounted.rerender(<View value={value} verified={false} />);
  expect(screen.queryByRole("timer")).toBeNull();
  expect(
    screen.getByText(/previous announcement may have changed/),
  ).toBeTruthy();
  mounted.rerender(<View value={value} />);
  expect(screen.getByRole("timer")).toBeTruthy();
});

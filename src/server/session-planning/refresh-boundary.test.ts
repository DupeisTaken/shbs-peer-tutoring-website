import { describe, expect, it } from "vitest";
import { plannedWindow } from "~/lib/session-planning";
import {
  sessionExceedsRefresh,
  sessionRefreshSuppressed,
} from "./refresh-boundary";

const window = plannedWindow(
  { date: "2026-11-26", startMin: 950, online: false },
  "Asia/Shanghai",
);
const schedule = {
  sourceTermId: "synthetic-term",
  state: "SCHEDULED",
  executeAt: window.endsAt,
  version: 1,
  updatedAt: new Date("2026-11-16T00:00:00Z"),
};

describe("exact scheduled refresh boundary", () => {
  it("allows an exact end and excludes a one-millisecond overrun independently of timezone display", () => {
    expect(window.endsAt.toISOString()).toBe("2026-11-26T08:35:00.000Z");
    expect(sessionExceedsRefresh(window, schedule)).toBe(false);
    expect(
      sessionExceedsRefresh(window, {
        ...schedule,
        executeAt: new Date("2026-11-26T16:34:59.999+08:00"),
      }),
    ).toBe(true);
  });

  it.each(["CANCELLED", "BLOCKED", "FAILED", "COMPLETED"])(
    "does not use %s as a future cutoff",
    (state) => {
      expect(
        sessionExceedsRefresh(window, {
          ...schedule,
          state,
          executeAt: window.startsAt,
        }),
      ).toBe(false);
    },
  );

  it("preserves evidence that had already started when the cutoff was observed", () => {
    const cutoff = {
      ...schedule,
      executeAt: window.startsAt,
      updatedAt: window.startsAt,
    };
    expect(
      sessionRefreshSuppressed(
        window,
        cutoff,
        new Date(window.startsAt.getTime() - 1),
      ),
    ).toBe(true);
    expect(sessionRefreshSuppressed(window, cutoff, window.startsAt)).toBe(
      false,
    );
    expect(sessionRefreshSuppressed(window, cutoff, window.endsAt)).toBe(false);
  });

  it("keeps a preannounced cutoff effective when the first read arrives after the lesson ends", () => {
    const cutoff = { ...schedule, executeAt: window.startsAt };
    expect(sessionRefreshSuppressed(window, cutoff, window.startsAt)).toBe(
      true,
    );
    expect(
      sessionRefreshSuppressed(
        window,
        cutoff,
        new Date(window.endsAt.getTime() + 1),
      ),
    ).toBe(true);
  });
});

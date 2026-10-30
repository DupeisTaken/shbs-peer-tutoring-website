import { describe, expect, it } from "vitest";
import {
  publicSignupView,
  type PublicSignupTransition,
} from "./public-signup-transition";

const now = Date.parse("2026-10-30T02:00:00Z");
function projection(): PublicSignupTransition {
  return {
    serverNow: new Date(now).toISOString(),
    timeZone: "Asia/Shanghai",
    current: {
      termId: "q1",
      label: "2026–27 Q1",
      kind: "quarter",
      window: {
        enabled: true,
        opensAt: "2026-09-01T00:00:00Z",
        closesAt: new Date(now).toISOString(),
        previewUrl: null,
      },
    },
    next: {
      label: "2026–27 Q2",
      opensAt: "2026-11-01T02:00:00Z",
      closesAt: null,
      enabled: true,
      previewUrl: null,
      preparationValid: true,
      refresh: null,
    },
  };
}

describe("public next-quarter signup projection", () => {
  it("hands off at the exclusive closing boundary, without relabeling current enrollment", () => {
    const data = projection();
    expect(publicSignupView(data, now - 1)).toMatchObject({
      next: false,
      state: "open",
      label: "2026–27 Q1",
    });
    expect(publicSignupView(data, now)).toMatchObject({
      next: true,
      state: "planned",
      label: "2026–27 Q2",
    });
    expect(data.current?.termId).toBe("q1");
  });
  it("hands off during manual pause and restores current signup on reopening", () => {
    const data = projection();
    data.current!.window.closesAt = null;
    data.current!.window.enabled = false;
    expect(publicSignupView(data, now).state).toBe("planned");
    data.current!.window.enabled = true;
    expect(publicSignupView(data, now).state).toBe("open");
  });
  it("retains current quarter's own pre-opening countdown", () => {
    const data = projection();
    data.current!.window.closesAt = null;
    data.current!.window.opensAt = "2026-11-01T00:00:00Z";
    expect(publicSignupView(data, now)).toMatchObject({
      next: false,
      state: "currentScheduled",
      label: "2026–27 Q1",
    });
  });
  it("distinguishes approved scheduling from an unapproved planned date", () => {
    const data = projection();
    data.next!.refresh = {
      executeAt: "2026-11-01T01:00:00Z",
      state: "SCHEDULED",
      valid: true,
    };
    expect(publicSignupView(data, now).state).toBe("scheduled");
    expect(
      publicSignupView(data, Date.parse("2026-11-01T01:00:00Z")).state,
    ).toBe("pendingActivation");
    expect(publicSignupView(data, Date.parse(data.next!.opensAt!)).state).toBe(
      "pendingActivation",
    );
  });
  it.each(["CANCELLED", "BLOCKED", "FAILED"] as const)(
    "removes an opening promise when refresh is %s",
    (state) => {
      const data = projection();
      data.next!.refresh = {
        executeAt: "2026-11-01T01:00:00Z",
        state,
        valid: false,
      };
      expect(publicSignupView(data, now)).toMatchObject({
        state: state === "CANCELLED" ? "cancelled" : "needsReview",
        opensAt: null,
      });
    },
  );
  it("does not invent unset dates or use stale target preparation", () => {
    const data = projection();
    data.next!.opensAt = null;
    expect(publicSignupView(data, now).state).toBe("awaitingSchedule");
    data.next!.preparationValid = false;
    expect(publicSignupView(data, now).state).toBe("needsReview");
  });
  it("does not advertise a disabled, ended or impossible next window", () => {
    const data = projection();
    data.next!.enabled = false;
    expect(publicSignupView(data, now).state).toBe("unavailable");
    data.next!.enabled = true;
    data.next!.closesAt = new Date(now).toISOString();
    expect(publicSignupView(data, now).state).toBe("unavailable");
    data.next!.closesAt = data.next!.opensAt;
    expect(publicSignupView(data, now).state).toBe("needsReview");
  });
  it("does not move the announced date to hide a later activation", () => {
    const data = projection();
    data.next!.refresh = {
      executeAt: "2026-11-02T01:00:00Z",
      state: "SCHEDULED",
      valid: true,
    };
    expect(publicSignupView(data, now)).toMatchObject({
      state: "needsReview",
      opensAt: null,
    });
  });
  it("does not invent a next-quarter handoff outside the supplied eligible target", () => {
    const data = projection();
    data.next = null;
    expect(publicSignupView(data, now)).toMatchObject({
      state: "closed",
      next: false,
    });
    data.current = null;
    expect(publicSignupView(data, now).label).toBeNull();
  });
});

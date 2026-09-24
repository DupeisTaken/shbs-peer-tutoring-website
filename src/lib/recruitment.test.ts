import { expect, it } from "vitest";
import { recruitmentStatus, recruitmentWindow } from "./recruitment";
const start = new Date("2026-09-22T08:00:00Z");
const end = new Date("2026-09-22T09:00:00Z");
const window = {
  enabled: true,
  opensAt: start,
  closesAt: end,
  previewUrl: null,
};
it.each([
  [start.getTime() - 1, "scheduled"],
  [start.getTime(), "open"],
  [end.getTime() - 1, "open"],
  [end.getTime(), "ended"],
] as const)("enforces exact start/end boundary %s", (now, status) =>
  expect(recruitmentStatus(window, now)).toBe(status),
);
it("supports independent toggles and optional time bounds", () => {
  expect(
    recruitmentStatus({ ...window, enabled: false }, start.getTime()),
  ).toBe("paused");
  expect(
    recruitmentStatus({ ...window, opensAt: null, closesAt: null }, 0),
  ).toBe("open");
  const term = {
    signupEnabled: false,
    tutorSignupEnabled: true,
    tutorSignupClosesAt: end,
  };
  expect(
    recruitmentStatus(recruitmentWindow(term, "tutee"), start.getTime()),
  ).toBe("paused");
  expect(
    recruitmentStatus(recruitmentWindow(term, "tutor"), start.getTime()),
  ).toBe("open");
  expect(recruitmentStatus(recruitmentWindow(null, "tutor"))).toBe("paused");
});

import { expect, it } from "vitest";
import {
  sessionNoticeContext,
  sessionPlanningNoticeCopy,
} from "./session-planning-notice-copy";

it("distinguishes a missed delivered deadline from ordinary short-notice expiry", () => {
  const copy = sessionPlanningNoticeCopy("deadline_missed", {
    startsAt: "2026-11-04T07:00:00.000Z",
    originalStartsAt: "2026-11-03T07:00:00.000Z",
    timeZone: "Asia/Shanghai",
    isActionable: false,
  });
  expect(copy.text).toContain(
    "deadline elapsed while scheduling processing was unavailable",
  );
  expect(copy.text).toContain("did not move a session retroactively");
  expect(copy.text).toContain("请采取行动");
  expect(copy.text).not.toContain("automatically accepted");
});

it("keeps bilingual action and delivery-qualified timing explicit without copying private context", () => {
  const copy = sessionPlanningNoticeCopy("proposed", {
    startsAt: "2026-11-02T04:00:00.000Z",
    endsAt: "2026-11-02T04:45:00.000Z",
    originalStartsAt: "2026-11-01T04:00:00.000Z",
    subjectLabel: "Mathematics / Chemistry",
    roomLabel: "Room 101",
    online: false,
    timeZone: "Asia/Shanghai",
    stage: "A",
    isActionable: true,
    reason: "PRIVATE REASON",
    tutees: ["PRIVATE STUDENT"],
    deadlineAt: "fabricated",
  });
  expect(copy.text).toContain("24-hour clock starts only after");
  expect(copy.text).toContain("请登录");
  expect(copy.text).toContain("Asia/Shanghai");
  expect(copy.text).toContain(
    "Lesson subjects / 辅导科目: Mathematics / Chemistry",
  );
  expect(copy.text).toContain("Original start / 原开始时间:");
  expect(copy.text).toContain("Room / 教室: Room 101");
  expect(copy.text).not.toContain("PRIVATE");
  expect(copy.text).not.toContain("fabricated");
});

it("makes a superseded actionable transition historical instead of inviting stale agreement", () => {
  const copy = sessionPlanningNoticeCopy(
    "countered",
    { isActionable: true, stage: "B" },
    true,
  );
  expect(copy.text).toContain("no longer an actionable offer");
  expect(copy.text).not.toContain("Action required:");
});

it("rejects invalid clock context and unknown events without echoing arbitrary text", () => {
  expect(
    sessionNoticeContext({
      startsAt: "2026-02-31T00:00:00.000Z",
      timeZone: "invalid",
      stage: "PRIVATE",
    }),
  ).toEqual({});
  const copy = sessionPlanningNoticeCopy("PRIVATE SUBJECT", {
    text: "PRIVATE BODY",
  });
  expect(copy.text).not.toContain("PRIVATE");
  expect(copy.subject).not.toContain("PRIVATE");
});

it("keeps bounded single-line subject/room labels and distinguishes an online lesson", () => {
  expect(
    sessionNoticeContext({
      subjectLabel: "PRIVATE\nNOTES",
      roomLabel: "x".repeat(121),
    }),
  ).toEqual({});
  const copy = sessionPlanningNoticeCopy("proposed", {
    subjectLabel: "Mathematics",
    roomLabel: "Ignored room",
    online: true,
  });
  expect(copy.text).toContain("Online / 线上");
  expect(copy.text).not.toContain("Ignored room");
});

import { expect, it } from "vitest";
import {
  sessionNoticeContext,
  sessionPlanningNoticeCopy,
} from "./session-planning-notice-copy";

it("requires affirmative agreement for paused-date offers without advertising a silence timer", () => {
  const copy = sessionPlanningNoticeCopy("proposed", { isActionable: true, requiresExplicitAcceptance: true });
  expect(copy.text).toContain("Silence will not accept it");
  expect(copy.text).toContain("未回复不会视为接受");
  expect(copy.text).not.toContain("24-hour clock");
  expect(copy.text).not.toContain("Silence can mean acceptance");
  // The admitted terms remain explicit-only even if management removes the pause.
  expect(copy.text).not.toContain("on a paused tutoring date");
  expect(copy.text).not.toContain("暂停日期");
  expect(sessionNoticeContext({ requiresExplicitAcceptance: "true", privateData: "secret" })).toEqual({});
  expect(sessionNoticeContext({ requiresExplicitAcceptance: true })).toEqual({ requiresExplicitAcceptance: true });
});

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
  expect(copy.subject).toBe(
    "Tutoring response deadline needs review / 请核对辅导回复期限",
  );
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
  expect(copy.text).toContain("Original start:");
  expect(copy.text).toContain("原开始时间：");
  expect(copy.text).toContain("Room / 教室: Room 101");
  expect(copy.text).not.toContain("Stage / 阶段");
  expect(copy.text).toContain("Silence can mean acceptance");
  expect(copy.text).toContain("Email replies do not decide the offer");
  expect(copy.text).not.toContain("PRIVATE");
  expect(copy.text).not.toContain("fabricated");
  expect(copy.text.indexOf("Silence can mean acceptance")).toBeLessThan(
    copy.text.indexOf("Lesson subjects"),
  );
  expect(copy.presentation.action.label).toBe(
    "Respond to proposal / 回复时间提议",
  );
});

it("makes a superseded actionable transition historical instead of inviting stale agreement", () => {
  const copy = sessionPlanningNoticeCopy(
    "countered",
    { isActionable: true, stage: "B" },
    true,
  );
  expect(copy.text).toContain("no longer an actionable offer");
  expect(copy.text).not.toContain("Action required:");
  expect(copy.text).not.toContain("Respond in the portal");
  expect(copy.text.startsWith("This is an earlier update")).toBe(true);
  expect(copy.subject).toBe("Earlier tutoring update / 历史辅导通知");
  expect(copy.presentation.action.label).toBe(
    "View current schedule / 查看当前安排",
  );
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

it.each([
  ["suggestion", "Tutoring time suggested / 辅导时间建议"],
  ["schedule_updated", "Tutoring timetable updated / 辅导课表已更新"],
  ["proposed", "Review a tutoring time / 请审核辅导时间"],
  ["countered", "Review an alternative tutoring time / 请审核替代辅导时间"],
  [
    "response_accepted",
    "A participant agreed to a tutoring time / 一位参与者已同意辅导时间",
  ],
  [
    "response_autoaccepted",
    "Tutoring response accepted automatically / 辅导时间回复已自动接受",
  ],
  ["accepted", "Tutoring time agreed / 辅导时间已达成一致"],
  ["autoaccepted", "Tutoring time accepted automatically / 辅导时间已自动接受"],
  ["split_requested", "Separate tutoring times requested / 已申请单独辅导时间"],
  ["split", "Individual tutoring scheduling started / 已开始个人辅导安排"],
  ["cancelled", "Tutoring session cancelled / 该次辅导已取消"],
  ["expired", "Tutoring schedule request expired / 辅导时间请求已到期"],
  [
    "deadline_missed",
    "Tutoring response deadline needs review / 请核对辅导回复期限",
  ],
  ["stale", "Tutoring schedule request no longer current / 辅导时间请求已失效"],
] as const)(
  "gives %s a maintained bilingual subject instead of a machine identifier",
  (event, subject) => {
    const copy = sessionPlanningNoticeCopy(event, {
      subjectLabel: "Mathematics",
    });
    expect(copy.subject).toBe(`${subject} — Mathematics`);
    expect(copy.subject).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    const withoutLesson = sessionPlanningNoticeCopy(event, {});
    expect(withoutLesson.subject).toMatch(/tutoring|Tutoring/);
    expect(withoutLesson.subject).toContain("辅导");
  },
);

it("preserves group agreement and ordinary-expiry consequences", () => {
  expect(sessionPlanningNoticeCopy("response_accepted", {}).text).toContain(
    "only when everyone accepts that same offer",
  );
  expect(sessionPlanningNoticeCopy("response_autoaccepted", {}).text).toContain(
    "does not confirm a group move",
  );
  expect(sessionPlanningNoticeCopy("expired", {}).text).toContain(
    "keeps its original time",
  );
});

const dated = {
  startsAt: "2026-11-02T04:00:00.000Z",
  endsAt: "2026-11-02T04:45:00.000Z",
  timeZone: "Asia/Shanghai",
};

it("condenses same-local-day ranges in each language and states the zone once", () => {
  const copy = sessionPlanningNoticeCopy("proposed", {
    ...dated,
    originalStartsAt: dated.startsAt,
  });
  expect(copy.text).toContain(
    "Proposed time: November 2, 2026, 12:00 PM–12:45 PM",
  );
  expect(copy.text).toContain("提议时间：2026年11月2日 12:00–12:45");
  expect(copy.text.match(/November 2, 2026/g)).toHaveLength(1);
  expect(copy.text.match(/Asia\/Shanghai/g)).toHaveLength(1);
  expect(copy.text).not.toContain("Original start:");
});

it("retains both local dates for a range crossing the program-zone midnight", () => {
  const copy = sessionPlanningNoticeCopy("accepted", {
    ...dated,
    startsAt: "2026-11-02T15:30:00.000Z",
    endsAt: "2026-11-02T16:15:00.000Z",
  });
  expect(copy.text).toContain(
    "November 2, 2026, 11:30 PM – November 3, 2026, 12:15 AM",
  );
  expect(copy.text).toContain("2026年11月2日 23:30 – 2026年11月3日 00:15");
});

it.each(["response_accepted", "response_autoaccepted", "deadline_missed"])(
  "does not label %s as a confirmed group move",
  (event) => {
    const copy = sessionPlanningNoticeCopy(event, dated);
    expect(copy.text).toContain("Proposed time:");
    expect(copy.text).not.toContain("Confirmed time:");
    expect(copy.presentation.action.label).toBe("View session / 查看课程");
  },
);

it.each(["accepted", "autoaccepted", "schedule_updated"])(
  "identifies %s as confirmed time",
  (event) => {
    const copy = sessionPlanningNoticeCopy(event, dated);
    expect(copy.text).toContain("Confirmed time:");
    expect(copy.text).toContain("确认时间：");
  },
);

it("labels superseded proposals as historical before showing their recorded time", () => {
  const copy = sessionPlanningNoticeCopy(
    "countered",
    { ...dated, isActionable: true },
    true,
  );
  expect(copy.text).toContain("Earlier proposed time:");
  expect(copy.text).toContain("此前提议时间：");
  expect(copy.text.indexOf("no longer an actionable offer")).toBeLessThan(
    copy.text.indexOf("An alternative tutoring time"),
  );
});

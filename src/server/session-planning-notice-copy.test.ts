import { expect, it } from "vitest";
import {
  sessionNoticeContext,
  sessionPlanningNoticeCopy,
} from "./session-planning-notice-copy";

it.each(["proposed", "countered"])(
  "asks the recipient to reply to %s in each maintained language",
  (event) => {
    const english = sessionPlanningNoticeCopy(event, { isActionable: true });
    const chinese = sessionPlanningNoticeCopy(
      event,
      { isActionable: true },
      false,
      "zh",
    );
    expect(english.subject).toContain("Reply to");
    expect(chinese.subject).toContain("请回复");
    expect(english.text).toContain("waiting for your reply");
    expect(chinese.text).toContain("等待您的回复");
  },
);

it.each(["en", "zh"] as const)(
  "requires affirmative agreement in %s for paused-date offers without advertising a silence timer",
  (locale) => {
    const copy = sessionPlanningNoticeCopy(
      "proposed",
      { isActionable: true, requiresExplicitAcceptance: true },
      false,
      locale,
    );
    expect(copy.text).toContain(
      locale === "en" ? "Silence will not accept it" : "未回复不会视为接受",
    );
    expect(copy.text).not.toContain("24-hour clock");
    expect(copy.text).not.toContain("Silence can mean acceptance");
    // The admitted terms remain explicit-only even if management removes the pause.
    expect(copy.text).not.toContain("on a paused tutoring date");
    expect(copy.text).not.toContain("暂停日期");
    expect(
      sessionNoticeContext({
        requiresExplicitAcceptance: "true",
        privateData: "secret",
      }),
    ).toEqual({});
    expect(sessionNoticeContext({ requiresExplicitAcceptance: true })).toEqual({
      requiresExplicitAcceptance: true,
    });
  },
);

it.each(["en", "zh"] as const)(
  "uses only maintained state guidance in the %s session inbox preview",
  (locale) => {
    const context = {
      isActionable: true,
      subjectLabel: "PRIVATE LESSON",
      roomLabel: "PRIVATE ROOM",
      reason: "PRIVATE REASON",
    };
    const ordinary = sessionPlanningNoticeCopy(
      "proposed",
      context,
      false,
      locale,
    );
    const explicit = sessionPlanningNoticeCopy(
      "proposed",
      { ...context, requiresExplicitAcceptance: true },
      false,
      locale,
    );
    const obsolete = sessionPlanningNoticeCopy(
      "countered",
      context,
      true,
      locale,
    );
    for (const copy of [ordinary, explicit, obsolete]) {
      expect(copy.presentation.preview).not.toMatch(
        /PRIVATE|https:|proposed|countered/,
      );
      expect(copy.presentation.preview).not.toBe(copy.subject);
    }
    expect(ordinary.presentation.preview).toContain(
      locale === "en" ? "exact response deadline" : "准确的回复期限",
    );
    expect(explicit.presentation.preview).toContain(
      locale === "en" ? "silence will not accept" : "未回复不会视为接受",
    );
    expect(obsolete.presentation.preview).toContain(
      locale === "en" ? "earlier notice" : "历史通知",
    );
  },
);

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
  expect(copy.text).not.toContain("automatically accepted");
  expect(copy.subject).toBe("Tutoring response deadline needs review");
});

it("keeps action and delivery-qualified timing explicit without copying private context", () => {
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
  expect(copy.text).toContain("Asia/Shanghai");
  expect(copy.text).toContain("Lesson subjects: Mathematics / Chemistry");
  expect(copy.text).toContain("Original start:");
  expect(copy.text).toContain("Room: Room 101");
  expect(copy.text).not.toMatch(/Stage|阶段/);
  expect(copy.text).toContain("Silence can mean acceptance");
  expect(copy.text).toContain("Email replies do not decide the offer");
  expect(copy.text).not.toContain("PRIVATE");
  expect(copy.text).not.toContain("fabricated");
  expect(copy.text.indexOf("Silence can mean acceptance")).toBeLessThan(
    copy.text.indexOf("Lesson subjects"),
  );
  expect(copy.presentation.action.label).toBe("Respond to proposal");
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
  expect(copy.subject).toBe("Earlier tutoring update");
  expect(copy.presentation.action.label).toBe("View current schedule");
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
  expect(copy.text).toContain("Location: Online");
  expect(copy.text).not.toContain("Ignored room");
});

it.each([
  ["suggestion", "Tutoring time suggested"],
  ["schedule_updated", "Tutoring timetable updated"],
  ["proposed", "Reply to a tutoring time proposal"],
  ["countered", "Reply to an alternative tutoring time"],
  ["response_accepted", "A participant agreed to a tutoring time"],
  ["response_autoaccepted", "Tutoring response accepted automatically"],
  ["accepted", "Tutoring time agreed"],
  ["autoaccepted", "Tutoring time accepted automatically"],
  ["split_requested", "Separate tutoring times requested"],
  ["split", "Individual tutoring scheduling started"],
  ["cancelled", "Tutoring session cancelled"],
  ["expired", "Tutoring schedule request expired"],
  ["deadline_missed", "Tutoring response deadline needs review"],
  ["stale", "Tutoring schedule request no longer current"],
] as const)(
  "gives %s a maintained subject in each language instead of a machine identifier",
  (event, subject) => {
    const copy = sessionPlanningNoticeCopy(event, {
      subjectLabel: "Mathematics",
    });
    expect(copy.subject).toBe(`${subject} — Mathematics`);
    expect(copy.subject).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    const withoutLesson = sessionPlanningNoticeCopy(event, {});
    expect(withoutLesson.subject).toMatch(/tutoring|Tutoring/);
    expect(withoutLesson.subject).not.toMatch(/\p{Script=Han}/u);
    const chinese = sessionPlanningNoticeCopy(event, {}, false, "zh");
    expect(chinese.subject).toContain("辅导");
    expect(chinese.subject).not.toMatch(/\b[a-z]+_[a-z_]+\b|Tutoring/);
    expect(chinese.presentation.locale).toBe("zh");
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
  const chinese = sessionPlanningNoticeCopy("proposed", dated, false, "zh");
  expect(chinese.text).toContain("提议时间：2026年11月2日 12:00–12:45");
  expect(chinese.text).not.toContain("November");
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
  expect(
    sessionPlanningNoticeCopy(
      "accepted",
      {
        ...dated,
        startsAt: "2026-11-02T15:30:00.000Z",
        endsAt: "2026-11-02T16:15:00.000Z",
      },
      false,
      "zh",
    ).text,
  ).toContain("2026年11月2日 23:30 – 2026年11月3日 00:15");
});

it.each(["response_accepted", "response_autoaccepted", "deadline_missed"])(
  "does not label %s as a confirmed group move",
  (event) => {
    const copy = sessionPlanningNoticeCopy(event, dated);
    expect(copy.text).toContain("Proposed time:");
    expect(copy.text).not.toContain("Confirmed time:");
    expect(copy.presentation.action.label).toBe("View session");
  },
);

it.each(["accepted", "autoaccepted", "schedule_updated"])(
  "identifies %s as confirmed time",
  (event) => {
    const copy = sessionPlanningNoticeCopy(event, dated);
    expect(copy.text).toContain("Confirmed time:");
    expect(sessionPlanningNoticeCopy(event, dated, false, "zh").text).toContain(
      "确认时间：",
    );
  },
);

it("labels superseded proposals as historical before showing their recorded time", () => {
  const copy = sessionPlanningNoticeCopy(
    "countered",
    { ...dated, isActionable: true },
    true,
  );
  expect(copy.text).toContain("Earlier proposed time:");
  expect(
    sessionPlanningNoticeCopy("countered", dated, true, "zh").text,
  ).toContain("此前提议时间：");
  expect(copy.text.indexOf("no longer an actionable offer")).toBeLessThan(
    copy.text.indexOf("An alternative tutoring time"),
  );
});

it.each(["en", "zh"] as const)(
  "keeps ordinary and obsolete proposal copy entirely in %s with the right action and silence rule",
  (locale) => {
    const ordinary = sessionPlanningNoticeCopy(
      "proposed",
      { ...dated, isActionable: true },
      false,
      locale,
    );
    expect(ordinary.text).toContain(
      locale === "en" ? "Silence can mean acceptance" : "未回复可能视为接受",
    );
    expect(ordinary.text).toContain(
      locale === "en" ? "short-notice cutoff" : "临近开课限制",
    );
    expect(ordinary.presentation.action.label).toBe(
      locale === "en" ? "Respond to proposal" : "回复时间提议",
    );
    const obsolete = sessionPlanningNoticeCopy(
      "countered",
      { ...dated, isActionable: true },
      true,
      locale,
    );
    expect(obsolete.presentation.action.label).toBe(
      locale === "en" ? "View current schedule" : "查看当前安排",
    );
    expect(obsolete.text).not.toContain(
      locale === "en" ? "Silence can mean acceptance" : "未回复可能视为接受",
    );
    if (locale === "en") expect(ordinary.text).not.toMatch(/\p{Script=Han}/u);
    else
      expect(ordinary.text).not.toMatch(
        /Respond in the portal|Time zone|Calendar subscriptions/,
      );
  },
);

// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { RouterOutputs } from "~/trpc/react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { attendanceOccurrence } from "~/app/(tutor)/_components/attendance-test-data";
import { SessionAgenda, SessionResponseDeadline } from "./session-agenda";

type Agenda = RouterOutputs["sessionPlanning"]["agenda"];
const state = vi.hoisted(() => ({
  data: undefined as Agenda | undefined,
  error: null as null | { data?: { code: string } },
  refetch: vi.fn(),
  propose: vi.fn(),
  suggest: vi.fn(),
  respond: vi.fn(),
  split: vi.fn(),
  formalize: vi.fn(),
  retryNotice: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    sessionPlanning: {
      agenda: {
        useQuery: () => ({
          data: state.data,
          error: state.error,
          isSuccess: !state.error,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
      propose: { useMutation: () => ({ mutateAsync: state.propose }) },
      suggest: { useMutation: () => ({ mutateAsync: state.suggest }) },
      respond: { useMutation: () => ({ mutateAsync: state.respond }) },
      requestSplit: { useMutation: () => ({ mutateAsync: state.split }) },
      formalizeSplit: { useMutation: () => ({ mutateAsync: state.formalize }) },
      retryNotice: { useMutation: () => ({ mutateAsync: state.retryNotice }) },
    },
  },
}));
vi.mock("./session-coordinate-message", () => ({
  SessionCoordinateMessage: () => <button>Message to coordinate</button>,
}));
vi.mock("./session-calendar-subscription", () => ({
  SessionCalendarSubscription: () => <button>Calendar subscription</button>,
}));
vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({
    title,
    children,
    onClose,
    pending,
  }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    pending: boolean;
  }) => (
    <div role="dialog" aria-label={title}>
      <button disabled={pending} onClick={onClose}>
        Close editor
      </button>
      {children}
    </div>
  ),
}));
vi.mock("./ui/modal", () => ({
  Modal: ({
    title,
    children,
    footer,
  }: {
    title: string;
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("~/app/(tutor)/_components/attendance-form", () => ({
  AttendanceForm: ({
    occurrence,
    open,
    onClose,
  }: {
    occurrence: { id: string };
    open: boolean;
    onClose: () => void;
  }) =>
    open ? (
      <div role="dialog">
        <p>{occurrence.id}</p>
        <button onClick={onClose}>Close attendance</button>
      </div>
    ) : null,
}));

const messages = en.sessionPlanning;
const sample = (): Agenda => ({
  timeZone: "Asia/Shanghai",
  windowStart: "2026-10-26",
  windowEnd: "2026-11-08",
  canTutorWrite: true,
  rooms: [{ id: "room", name: "A101" }],
  schoolCalendarDays: [],
  cohorts: [{ ...attendanceOccurrence }],
  requests: [],
  suggestions: [],
  notices: [],
  weeklyPublication: {
    unavailable: 0,
    normalized: 0,
    preparedThrough: "2026-11-08",
  },
});
beforeEach(() => {
  state.data = sample();
  state.error = null;
  for (const fn of [
    state.propose,
    state.suggest,
    state.respond,
    state.split,
    state.formalize,
    state.retryNotice,
  ])
    fn.mockReset().mockResolvedValue({ id: "saved" });
  state.refetch.mockReset().mockResolvedValue({ data: state.data });
});
afterEach(cleanup);
function show(role: "tutor" | "tutee" = "tutor", locale: "en" | "zh" = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "en" ? en : zh}
    >
      <SessionAgenda role={role} />
    </NextIntlClientProvider>,
  );
}
it("interleaves authorized interview and meeting starts without inventing tutoring intervals", () => {
  const events = [
    {
      id: "meeting:later",
      startsAt: new Date("2026-10-26T08:00:00Z"),
      content: <article>Later meeting</article>,
    },
    {
      id: "interview:earlier",
      startsAt: new Date("2026-10-26T06:00:00Z"),
      content: <article>Earlier interview</article>,
    },
    {
      id: "meeting:outside",
      startsAt: new Date("2026-11-10T08:00:00Z"),
      content: <article>Outside window</article>,
    },
  ];
  render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      <SessionAgenda role="tutor" supplementalEvents={events} />
    </NextIntlClientProvider>,
  );
  const cards = screen.getAllByRole("article");
  expect(cards.map((card) => card.textContent)).toEqual([
    "Earlier interview",
    expect.stringContaining("Mathematics"),
    "Later meeting",
  ]);
  fireEvent.click(screen.getByRole("tab", { name: messages.needsAttendance }));
  expect(screen.queryByText("Earlier interview")).toBeNull();
  expect(screen.getAllByRole("article")).toHaveLength(1);
});
it.each([false, true])(
  "keeps independent appointments when tutoring has no usable read (denied=%s)",
  (denied) => {
    state.data = denied ? sample() : undefined;
    state.error = {
      data: { code: denied ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR" },
    };
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={en}
      >
        <SessionAgenda
          role="tutor"
          supplementalEvents={[
            {
              id: "interview:own",
              startsAt: new Date("2026-10-26T06:00:00Z"),
              content: <article>Authorized interview</article>,
            },
          ]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Authorized interview")).toBeTruthy();
    expect(screen.queryByText("Mathematics + Physics")).toBeNull();
  },
);
it("does not add tutor appointment types to the tutee agenda", () => {
  render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      <SessionAgenda
        role="tutee"
        supplementalEvents={[
          {
            id: "interview:own",
            startsAt: new Date("2026-10-26T06:00:00Z"),
            content: <article>Private interview</article>,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByText("Private interview")).toBeNull();
});
it("places coordination before formal controls and opens attendance only from the exact cohort", () => {
  show();
  const card = screen.getByRole("article");
  const buttons = within(card).getAllByRole("button");
  expect(buttons[0]?.textContent).toBe("Message to coordinate");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: messages.record }));
  expect(screen.getByRole("dialog").textContent).toContain("cohort-synthetic");
  fireEvent.click(screen.getByRole("button", { name: "Close attendance" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it.each(["en", "zh"] as const)(
  "gives an unavailable empty-subject cohort a meaningful localized heading in %s",
  (locale) => {
    state.data!.cohorts = [
      {
        ...attendanceOccurrence,
        subjects: [],
        unavailable: true,
        needsAttendance: false,
        canRecordAttendance: false,
      },
    ];
    show("tutor", locale);
    const copy = locale === "en" ? en : zh;
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: copy.sessionPlanning.scheduleUnavailable,
      }),
    ).toBeTruthy();
    for (const heading of screen.getAllByRole("heading"))
      expect(heading.textContent?.trim()).not.toBe("");
  },
);
it("keeps the final Sunday and older incomplete attendance reachable", () => {
  state.data!.cohorts = [
    attendanceOccurrence,
    { ...attendanceOccurrence, id: "last-sunday", date: "2026-11-08" },
    {
      ...attendanceOccurrence,
      id: "older",
      date: "2026-10-19",
      subjects: ["Older subject"],
    },
  ];
  show();
  expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.click(screen.getByRole("tab", { name: messages.needsAttendance }));
  expect(screen.getByText("Older subject")).toBeTruthy();
});
it("stops historical response prompts on a split request while retaining evidence and formalization", () => {
  const response = {
    id: "delivered-response",
    actorKey: "tutee:delivered",
    name: "Delivered Learner",
    state: "PENDING" as const,
    deadline: new Date("2099-01-02T07:00:00Z"),
    deliveredAt: new Date("2099-01-01T07:00:00Z"),
    acceptedBy: null,
    isMe: false,
  };
  const request: Agenda["requests"][number] = {
    id: "split-request",
    version: 4,
    planId: "plan-synthetic",
    cohortId: "cohort-synthetic",
    kind: "RESCHEDULE",
    scope: "ALL",
    status: "PENDING",
    stage: 1,
    participantIds: ["delivered", "undelivered"],
    currentOffer: {
      id: "split-offer",
      date: "2099-01-04",
      startMin: 900,
      endMin: 945,
      roomId: null,
      online: true,
      startsAt: new Date("2099-01-04T07:00:00Z"),
      endsAt: new Date("2099-01-04T07:45:00Z"),
      cutoffAt: new Date("2099-01-03T07:00:00Z"),
      schoolClosed: false,
      responses: [
        response,
        {
          ...response,
          id: "undelivered-response",
          actorKey: "tutee:undelivered",
          name: "Undelivered Learner",
          deadline: null,
          deliveredAt: null,
        },
      ],
      myResponse: null,
      canReject: false,
      canRequestSplit: false,
    },
  };
  state.data!.requests = [request];
  const ui = () => (
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      <SessionAgenda role="tutor" />
    </NextIntlClientProvider>
  );
  const view = render(ui());
  const deadline = screen.getByText(/^Respond by /);
  const remaining = screen.getByText(/ h \d+ min remaining$/);
  const delivery = screen.getByText(messages.deliveryPending);
  // Suspending a request retains its response evidence and original deadlines.
  state.data!.requests = [{ ...request, status: "SPLIT_REQUESTED" }];
  view.rerender(ui());
  expect(deadline.isConnected).toBe(false);
  expect(remaining.isConnected).toBe(false);
  expect(delivery.isConnected).toBe(false);
  expect(screen.queryByText(messages.checking)).toBeNull();
  expect(screen.getByText(/Delivered Learner/)).toBeTruthy();
  expect(screen.getByText(/Undelivered Learner/)).toBeTruthy();
  expect(screen.getByText(messages.splitHelp)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.formalizeSplit,
    }).disabled,
  ).toBe(false);
  expect(state.respond).not.toHaveBeenCalled();
  expect(state.formalize).not.toHaveBeenCalled();
});
it.each(["en", "zh"] as const)(
  "gives %s learners suggestions without tutor proposal or attendance actions",
  (locale) => {
    state.data!.canTutorWrite = false;
    state.data!.cohorts = [
      {
        ...attendanceOccurrence,
        startsAt: new Date("2099-01-01T07:00:00Z"),
        endsAt: new Date("2099-01-01T07:45:00Z"),
        canRecordAttendance: false,
      },
    ];
    show("tutee", locale);
    const text = locale === "en" ? en.sessionPlanning : zh.sessionPlanning;
    expect(screen.getByRole("button", { name: text.suggest })).toBeTruthy();
    expect(screen.queryByRole("button", { name: text.reschedule })).toBeNull();
    expect(screen.queryByRole("button", { name: text.record })).toBeNull();
  },
);
it("reviews scope and clocks before sending an extra, then preserves saved read recovery", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: messages.addExtra }));
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("radio", { name: messages.one }),
  ).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText(messages.end), {
    target: { value: "17:00" },
  });
  expect(
    within(dialog).getByLabelText<HTMLInputElement>(messages.start).value,
  ).toBe("16:15");
  fireEvent.click(
    within(dialog).getByRole("button", { name: messages.review }),
  );
  expect(state.propose).not.toHaveBeenCalled();
  state.refetch.mockRejectedValueOnce(new Error("Synthetic read failure"));
  await act(async () =>
    fireEvent.click(
      within(dialog).getByRole("button", { name: messages.sendProposal }),
    ),
  );
  expect(state.propose).toHaveBeenCalledOnce();
  expect(state.propose.mock.calls[0]?.[0]).toMatchObject({
    cohortId: "cohort-synthetic",
    expectedVersion: 7,
    kind: "EXTRA",
    startMin: 975,
  });
  expect(screen.getByText(messages.savedRefreshFailed)).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: messages.retry })),
  );
  expect(state.propose).toHaveBeenCalledOnce();
});
it("conceals retained personal data after authoritative access loss", () => {
  const view = show();
  state.error = { data: { code: "FORBIDDEN" } };
  view.rerender(
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      <SessionAgenda role="tutor" />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByText("Remaining Learner")).toBeNull();
  expect(screen.getByText(messages.denied)).toBeTruthy();
});
it("requires explicit resume or discard when switching exact attendance contexts", () => {
  state.data!.cohorts.push({
    ...attendanceOccurrence,
    id: "second-cohort",
    subjects: ["Second subject"],
  });
  show();
  fireEvent.click(screen.getAllByRole("button", { name: messages.record })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Close attendance" }));
  fireEvent.click(screen.getAllByRole("button", { name: messages.record })[1]!);
  expect(screen.getByRole("dialog").textContent).toContain(messages.switchHelp);
  fireEvent.click(screen.getByRole("button", { name: messages.resume }));
  expect(screen.getByRole("dialog").textContent).toContain("cohort-synthetic");
  fireEvent.click(screen.getByRole("button", { name: "Close attendance" }));
  fireEvent.click(screen.getAllByRole("button", { name: messages.record })[1]!);
  fireEvent.click(screen.getByRole("button", { name: messages.discard }));
  expect(screen.getByRole("dialog").textContent).toContain("second-cohort");
});
it("keeps explicitly agreed closed-day sessions visible and warns in a new-time editor", () => {
  state.data!.cohorts = [
    {
      ...attendanceOccurrence,
      kind: "EXTRA",
      rescheduled: true,
      schoolClosed: true,
    },
  ];
  state.data!.schoolCalendarDays = [
    {
      date: attendanceOccurrence.date,
      isSchoolDay: false,
      timetableWeekday: null,
      active: true,
    },
  ];
  show();
  expect(screen.getByText(messages.schoolClosed)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: messages.addExtra }));
  expect(
    within(screen.getByRole("dialog")).getByText(messages.schoolClosedProposal),
  ).toBeTruthy();
});
it("offers separate rescheduling after an ALL rejection budget is spent, with a named review", async () => {
  const response = {
    id: "response",
    actorKey: "tutee:remaining",
    name: "Remaining Learner",
    state: "PENDING" as const,
    deadline: new Date("2099-01-02T07:00:00Z"),
    deliveredAt: new Date("2099-01-01T07:00:00Z"),
    acceptedBy: null,
    isMe: true,
  };
  state.data!.requests = [
    {
      id: "request",
      version: 3,
      planId: "plan-synthetic",
      cohortId: "cohort-synthetic",
      kind: "RESCHEDULE",
      scope: "ALL",
      status: "PENDING",
      stage: 1,
      participantIds: ["remaining"],
      currentOffer: {
        id: "offer",
        date: "2099-01-04",
        startMin: 900,
        endMin: 945,
        roomId: null,
        online: true,
        startsAt: new Date("2099-01-04T07:00:00Z"),
        endsAt: new Date("2099-01-04T07:45:00Z"),
        cutoffAt: new Date("2099-01-03T07:00:00Z"),
        schoolClosed: false,
        responses: [response],
        myResponse: response,
        canReject: false,
        canRequestSplit: true,
      },
    },
  ];
  show();
  expect(
    screen.queryByRole("button", { name: messages.alternative }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.requestSeparate }),
  );
  expect(state.split).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: messages.requestSeparate,
      }),
    ),
  );
  expect(state.split).toHaveBeenCalledOnce();
  expect(state.split.mock.calls[0]?.[0]).toMatchObject({
    requestId: "request",
    expectedVersion: 3,
  });
});
it.each(["en", "zh"] as const)(
  "keeps a SENT action-required outage visible with exact original/proposed context in %s and no retroactive action",
  (locale) => {
    const originalStartsAt = "2026-10-29T07:00:00.000Z";
    const startsAt = "2026-10-30T08:00:00.000Z";
    state.data!.notices = [
      {
        id: "missed-deadline",
        requestId: "expired-request",
        event: "deadline_missed",
        status: "SENT",
        lastError: null,
        acceptedAt: new Date("2026-10-30T10:00:00Z"),
        createdAt: new Date("2026-10-30T09:00:00Z"),
        actionRequired: true,
        context: {
          subjectLabel: "Synthetic Physics",
          timeZone: "Asia/Shanghai",
          originalStartsAt,
          startsAt,
          endsAt: "2026-10-30T08:45:00.000Z",
          outcomeReason: "MISSED_AUTOMATIC_RESPONSE_WINDOW",
        },
      },
    ];
    show("tutor", locale);
    const text = locale === "en" ? en.sessionPlanning : zh.sessionPlanning;
    const warning = screen.getByRole("alert");
    expect(within(warning).getByText(text.deadlineMissedTitle)).toBeTruthy();
    expect(within(warning).getByText(text.deadlineMissedHelp)).toBeTruthy();
    expect(within(warning).getByText("Synthetic Physics")).toBeTruthy();
    for (const value of [originalStartsAt, startsAt])
      expect(
        warning.querySelector(`time[datetime="${value}"]`)?.textContent,
      ).toBe(
        new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Shanghai",
        }).format(new Date(value)),
      );
    expect(within(warning).queryByRole("button")).toBeNull();
    expect(
      screen.queryByRole("button", { name: text.retryDelivery }),
    ).toBeNull();
    expect(state.respond).not.toHaveBeenCalled();
    expect(state.propose).not.toHaveBeenCalled();
  },
);
it("keeps the outage outcome separate from failed essential delivery and its transport-only retry", () => {
  state.data!.notices = [
    {
      id: "failed-outage-notice",
      requestId: "expired-request",
      event: "deadline_missed",
      status: "FAILED",
      lastError: "Synthetic mail failure",
      acceptedAt: null,
      createdAt: new Date("2026-10-30T09:00:00Z"),
      actionRequired: true,
      context: { outcomeReason: "MISSED_AUTOMATIC_RESPONSE_WINDOW" },
    },
  ];
  show();
  expect(screen.getByText(messages.deadlineMissedHelp)).toBeTruthy();
  expect(screen.getByText(messages.noticeFailed)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: messages.retryDelivery }),
  ).toBeTruthy();
  expect(state.respond).not.toHaveBeenCalled();
});
it("distinguishes undelivered, explicit short-notice and elapsed response windows", () => {
  const now = new Date("2026-10-29T08:00:00Z");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      {children}
    </NextIntlClientProvider>
  );
  const view = render(
    <SessionResponseDeadline deadline={null} deliveredAt={null} now={now} />,
    { wrapper },
  );
  expect(screen.getByText(messages.deliveryPending)).toBeTruthy();
  view.rerender(
    <SessionResponseDeadline
      deadline={null}
      deliveredAt={now}
      cutoffAt={new Date("2026-10-29T09:00:00Z")}
      now={now}
    />,
  );
  expect(screen.queryByText(messages.deliveryPending)).toBeNull();
  view.rerender(
    <SessionResponseDeadline deadline={now} deliveredAt={now} now={now} />,
  );
  expect(screen.getByText(messages.checking)).toBeTruthy();
  expect(state.respond).not.toHaveBeenCalled();
});

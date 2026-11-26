/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import type * as NextNavigation from "next/navigation";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { StudentPortal } from "./student-portal";
import { StudentWorkspace } from "../student/student-workspace";
import {
  StudentSignupAction,
  StudentSignupRestrictionProvider,
} from "../student/signup-restriction";
import { LegacyParticipation } from "../student/legacy-participation";
import { TutorDiscipline } from "../(tutor)/_components/tutor-discipline";
import { DEFAULT_NAME_FIELDS } from "~/lib/name-field-policy";
import { programDateKey } from "~/lib/program-time";
import type { RouterOutputs } from "~/trpc/react";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";

const remote = vi.hoisted(() => ({
  me: vi.fn(),
  settings: vi.fn(),
  mine: vi.fn(),
  legacy: vi.fn(),
  options: vi.fn(),
  feedback: vi.fn(),
  appeal: vi.fn(),
  edit: vi.fn(),
  withdraw: vi.fn(),
  abortReceipt: vi.fn(),
  cancelAction: vi.fn(),
  discipline: vi.fn(),
  signup: vi.fn(),
  profile: vi.fn(),
  names: vi.fn(),
  headEdit: vi.fn(),
  calendar: vi.fn(),
  agenda: vi.fn(),
  history: vi.fn(),
  calendarStatus: vi.fn(),
  planningWrite: vi.fn(),
  restriction: vi.fn(),
  routeRefresh: vi.fn(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof NextNavigation>()),
  useRouter: () => ({ refresh: remote.routeRefresh }),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useInfiniteQuery, useMutation } =
    await import("@tanstack/react-query");
  const read = (path: string[], load: typeof remote.me) => ({
    _def: () => ({ path }),
    useQuery(input?: unknown, options?: { enabled?: boolean }) {
      return useQuery({
        queryKey: [
          path,
          { ...(input === undefined ? {} : { input }), type: "query" },
        ],
        queryFn: (): unknown => load(input),
        ...options,
      });
    },
  });
  const write = (run: typeof remote.appeal) => ({
    useMutation: (options: Record<string, unknown> = {}) =>
      useMutation({ mutationFn: run, ...options }),
  });
  return {
    api: {
      sessionPlanning: {
        agenda: read(["sessionPlanning", "agenda"], remote.agenda),
        history: {
          useInfiniteQuery(input: unknown, options?: { enabled?: boolean }) {
            return useInfiniteQuery({
              queryKey: [
                ["sessionPlanning", "history"],
                { input, type: "infinite" },
              ],
              initialPageParam: null,
              queryFn: (): unknown => remote.history(),
              getNextPageParam: () => undefined,
              ...options,
            });
          },
        },
        calendarStatus: read(
          ["sessionPlanning", "calendarStatus"],
          remote.calendarStatus,
        ),
        propose: write(remote.planningWrite),
        proposeCancellation: write(remote.planningWrite),
        suggest: write(remote.planningWrite),
        respond: write(remote.planningWrite),
        requestSplit: write(remote.planningWrite),
        formalizeSplit: write(remote.planningWrite),
        retryNotice: write(remote.planningWrite),
        refreshSchedule: write(remote.planningWrite),
        rotateCalendar: write(remote.planningWrite),
        revokeCalendar: write(remote.planningWrite),
      },
      program: {
        schoolCalendar: read(["program", "schoolCalendar"], remote.calendar),
        calendar: { useQuery: () => ({ data: [] }) },
        profilePolicy: read(["program", "profilePolicy"], remote.profile),
        nameFieldPolicy: read(["program", "nameFieldPolicy"], remote.names),
        nameFieldsForProfile: read(
          ["program", "nameFieldsForProfile"],
          remote.names,
        ),
      },
      tutor: {
        myTuteeDiscipline: read(
          ["tutor", "myTuteeDiscipline"],
          remote.discipline,
        ),
      },
      useUtils: () => ({
        studentWorkflow: {
          abortReceipt: { fetch: remote.abortReceipt },
          mine: {
            invalidate: () =>
              client.invalidateQueries({
                queryKey: [["studentWorkflow", "mine"]],
              }),
          },
          legacyParticipation: { invalidate: vi.fn() },
          adminRequests: { invalidate: vi.fn() },
        },
        admin: {
          tutees: { invalidate: vi.fn() },
          pairings: { invalidate: vi.fn() },
        },
      }),
      student: {
        me: read(["student", "me"], remote.me),
        feedbackSettings: read(
          ["student", "feedbackSettings"],
          remote.settings,
        ),
        feedback: write(remote.feedback),
        appeal: write(remote.appeal),
      },
      studentWorkflow: {
        signupRestriction: read(
          ["studentWorkflow", "signupRestriction"],
          remote.restriction,
        ),
        mine: read(["studentWorkflow", "mine"], remote.mine),
        legacyParticipation: read(
          ["studentWorkflow", "legacyParticipation"],
          remote.legacy,
        ),
        signup: read(["studentWorkflow", "signup"], remote.signup),
        managedSignup: read(
          ["studentWorkflow", "managedSignup"],
          remote.signup,
        ),
        editSignup: write(remote.edit),
        headEditSignup: write(remote.headEdit),
        recall: write(remote.withdraw),
        applyAbort: write(remote.withdraw),
        cancelAction: write(remote.cancelAction),
        applyLegacyWithdrawal: write(remote.withdraw),
      },
      tutee: {
        signupOptions: read(["tutee", "signupOptions"], remote.options),
      },
    },
  };
});
// These tests preserve the feature's reason and admission contract; the timed
// ticket/countdown and native dialog integration retain their dedicated suites.
vi.mock("./timed-action-dialog", () => ({
  TimedActionDialog: ({
    children,
    canConfirm,
    onConfirm,
    onCancel,
    busy,
    action,
    target,
  }: {
    children: ReactNode;
    canConfirm: boolean;
    onConfirm: (ticket: string) => void;
    onCancel: () => void;
    busy: boolean;
    action: string;
    target: string;
  }) => (
    <div role="dialog" data-action={action} data-target={target}>
      {children}
      <button
        disabled={busy || !canConfirm}
        onClick={() => onConfirm("ticket")}
      >
        Confirm timed action
      </button>
      <button disabled={busy} onClick={onCancel}>
        Cancel timed action
      </button>
    </div>
  ),
}));
const slot = { id: "mon", dayOfWeek: 1, startMin: 930, endMin: 990 };
const request = {
  id: "request",
  state: "OPEN",
  subjects: [{ name: "Math" }],
  submittedAt: new Date("2026-10-01"),
  editedAt: null,
  slots: [slot],
  pairings: [
    {
      ...slot,
      id: "pair",
      subject: "Math",
      tutor: { englishName: "Tutor" },
      scheduleConfirmed: true,
    },
  ],
  reviews: [],
};
const signup = (version = 0) => ({
  id: request.id,
  version,
  editable: true,
  email: "owner@example.test",
  state: "OPEN",
  submittedAt: request.submittedAt,
  answers: {
    firstName: "Original",
    lastName: "Name",
    englishName: "Original Name",
    preferredContact: "Original contact",
    firstChoiceId: "math",
    slotIds: ["mon"],
  },
  originalSignature: "Original Signature",
  originalPolicyRevision: "original-policy",
  assignedSubjectIds: ["math"],
  assignmentsUnresolved: false,
  subjectEditingBlocked: false,
  persistedSubjects: [],
  persistedSlots: [],
  isInvalid: false,
  invalidityVersion: 0,
  canAppeal: false,
  appeal: null,
});
const legacy = [
  {
    id: "legacy",
    englishName: "Private Student",
    status: "ACTIVE",
    reviews: [],
  },
];
const personal = {
  schedule: [],
  sessions: [
    {
      session: {
        id: "session",
        date: new Date("2026-10-01"),
        pairing: { subject: "Math" },
      },
      status: "PRESENT",
      feedback: null,
    },
  ],
  cards: [
    {
      id: "card",
      color: "RED",
      reviewStatus: "VALID",
      reason: "Authored reason",
      deadline: new Date("2099-01-01"),
      hasExistingAppeal: false,
    },
  ],
  appeals: [
    { id: "appeal", body: "Authored appeal", state: "PENDING", decision: null },
    {
      id: "resolved",
      body: "Resolved appeal",
      state: "RESOLVED",
      decision: "Authored decision",
    },
  ],
};
let client: QueryClient;
const key = (path: string[], input?: unknown) => [
  path,
  { ...(input === undefined ? {} : { input }), type: "query" },
];
function mount(ui: ReactElement, locale = "en") {
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={locale === "zh" ? zh : en}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
async function refresh(path: string[]) {
  await act(async () => {
    await client.refetchQueries({ queryKey: [path] });
  });
}
beforeEach(() => {
  Object.defineProperty(crypto, "subtle", { configurable: true, value: webcrypto.subtle });
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  installSessionReadReceipts(client);
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/student");
  remote.calendar.mockResolvedValue([]);
  const date = programDateKey(new Date(), "Asia/Shanghai");
  remote.agenda.mockResolvedValue({
    timeZone: "Asia/Shanghai",
    windowStart: date,
    windowEnd: date,
    canTutorWrite: false,
    tutoringPauses: [],
    rooms: [],
    schoolCalendarDays: [],
    cohorts: [],
    requests: [],
    suggestions: [],
    notices: [],
    weeklyPublication: {
      unavailable: 0,
      normalized: 0,
      preparedThrough: date,
    },
  } satisfies RouterOutputs["sessionPlanning"]["agenda"]);
  remote.calendarStatus.mockResolvedValue({
    active: false,
    available: true,
    createdAt: null,
  });
  remote.planningWrite.mockRejectedValue(
    new Error("This read-recovery test must not submit scheduling changes"),
  );
  remote.me.mockResolvedValue(personal);
  remote.settings.mockResolvedValue(false);
  remote.mine.mockResolvedValue([request]);
  remote.restriction.mockResolvedValue({
    intakeTermId: "current",
    blocked: false,
    canOpenWorkspace: true,
  });
  remote.legacy.mockResolvedValue([]);
  remote.options.mockResolvedValue({
    subjects: [
      { id: "math", name: "Math" },
      { id: "science", name: "Science" },
    ],
    slots: [slot, { ...slot, id: "tue", dayOfWeek: 2 }],
  });
  remote.signup.mockResolvedValue(signup());
  remote.profile.mockResolvedValue({ offeredGrades: [9, 10, 11, 12] });
  remote.names.mockResolvedValue({
    policies: { STUDENT: DEFAULT_NAME_FIELDS },
    states: DEFAULT_NAME_FIELDS,
  });
  remote.edit.mockResolvedValue({ ok: true, version: 1 });
  remote.headEdit.mockResolvedValue({ ok: true, version: 1 });
  remote.appeal.mockResolvedValue({});
  remote.withdraw.mockReset().mockResolvedValue({ ok: true, reviewId: "withdrawal-review" });
  remote.abortReceipt.mockReset().mockResolvedValue({ status: "UNCONFIRMED", canRetire: true });
  remote.cancelAction.mockReset().mockResolvedValue({ count: 1 });
  remote.feedback.mockResolvedValue({});
  remote.discipline.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("recovers school-calendar reads independently while retaining the tutee's weekly schedule", async () => {
  const date = programDateKey(new Date(), "Asia/Shanghai");
  const calendar = [
    {
      date,
      isSchoolDay: false,
      timetableWeekday: null,
      version: 2,
      scheduleRevision: 2,
    },
  ];
  remote.calendar.mockResolvedValue(calendar);
  remote.me.mockResolvedValue({
    ...personal,
    schedule: [
      {
        id: "calendar-pairing",
        subject: "Calendar mathematics",
        tutor: { englishName: "Synthetic Tutor", user: null },
        timeSlotId: null,
        groupId: null,
        scheduleConfirmed: true,
        roomMode: "LEGACY",
        roomNeedsAssignment: false,
        dayOfWeek: 1,
        startMin: 930,
        endMin: 990,
        room: null,
      } satisfies RouterOutputs["student"]["me"]["schedule"][number],
    ],
  });
  mount(<StudentPortal view="schedule" />);
  await screen.findByText(en.schoolCalendar.closureWarning);
  // Keep the real agenda mounted: an absent API fixture must surface as an app
  // error, while calendar recovery must not refetch either participant read.
  await screen.findByText(en.sessionPlanning.empty);
  // The shared agenda declares its history hook, but the default tutee view
  // must not fetch history or couple it to school-calendar recovery.
  expect(remote.history).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: en.tuteePortal.weeklyArrangements }),
  ).toBeTruthy();
  expect(
    screen.getByText("Calendar mathematics · Synthetic Tutor"),
  ).toBeTruthy();
  const personalReads = remote.me.mock.calls.length;
  const agendaReads = remote.agenda.mock.calls.length;
  remote.calendar.mockRejectedValue(new Error("Calendar offline"));
  await refresh(["program", "schoolCalendar"]);
  await screen.findByText(en.schoolCalendar.noticeLoadFailed);
  expect(screen.getByText(en.schoolCalendar.closureWarning)).toBeTruthy();
  expect(
    screen.getByText("Calendar mathematics · Synthetic Tutor"),
  ).toBeTruthy();
  remote.calendar.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await refresh(["program", "schoolCalendar"]);
  await screen.findByText(en.schoolCalendar.denied);
  expect(screen.queryByText(en.schoolCalendar.closureWarning)).toBeNull();
  expect(
    screen.getByText("Calendar mathematics · Synthetic Tutor"),
  ).toBeTruthy();
  remote.calendar.mockRejectedValue(new Error("Still offline"));
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.refresh }),
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByText(en.schoolCalendar.denied)).toBeTruthy();
  remote.calendar.mockResolvedValue(calendar);
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.refresh }),
  );
  await screen.findByText(en.schoolCalendar.closureWarning);
  expect(remote.me).toHaveBeenCalledTimes(personalReads);
  expect(remote.agenda).toHaveBeenCalledTimes(agendaReads);
  expect(remote.planningWrite).not.toHaveBeenCalled();
  expect(remote.feedback).not.toHaveBeenCalled();
  expect(remote.appeal).not.toHaveBeenCalled();
});

it.each(["en", "zh"])(
  "localizes card and appeal states in %s without translating authored reasons",
  async (locale) => {
    mount(<StudentPortal view="support" />, locale);
    await screen.findByText("Authored reason");
    expect(
      screen.getByText(
        locale === "zh" ? zh.tutor.attendance.red : en.tutor.attendance.red,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        locale === "zh"
          ? zh.admin.cards.reviewStatus.VALID
          : en.admin.cards.reviewStatus.VALID,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Authored decision")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /RED|VALID|PENDING|RESOLVED|PENDING ·/,
    );
  },
);

it.each(["PENDING", "DENIED", "APPROVED"])(
  "refreshes both mounted signup entries after a source read (decision=%s)",
  async (decision) => {
    const approved = decision === "APPROVED";
    remote.mine.mockResolvedValue([]);
    remote.legacy.mockResolvedValue([
      { status: "INACTIVE", reviews: [{ state: decision }] },
    ]);
    mount(
      <StudentSignupRestrictionProvider
        snapshotKey="a0000000-0000-4000-8000-000000000001"
        initialRestriction={{
          intakeTermId: "current",
          blocked: false,
          canOpenWorkspace: true,
        }}
      >
        <StudentSignupAction initiallyBlocked={false} departed={false} />
        <StudentWorkspace />
      </StudentSignupRestrictionProvider>,
    );
    await screen.findByRole("link", { name: en.workflow.newRequest });
    remote.restriction.mockResolvedValue({
      intakeTermId: "current",
      blocked: approved,
      canOpenWorkspace: true,
    });
    await refresh(["studentWorkflow", "mine"]);
    await waitFor(() =>
      expect(
        !!screen.queryByRole("link", { name: en.tuteePortal.requestTutor }),
      ).toBe(!approved),
    );
    expect(!!screen.queryByRole("link", { name: en.workflow.newRequest })).toBe(
      !approved,
    );
    if (approved) expect(screen.getByText(en.workflow.abortFinal)).toBeTruthy();
    expect(remote.withdraw).not.toHaveBeenCalled();
  },
);

it.each([undefined, false, true])(
  "never claims a privacy audience on an unknown/failed read (cached %s)",
  async (cached) => {
    if (cached !== undefined)
      client.setQueryData(key(["student", "feedbackSettings"]), cached);
    remote.settings.mockRejectedValue(new Error("Offline"));
    mount(<StudentPortal view="attendance" />);
    // Dedicated attendance routes own their page heading; wait for the actual record entry.
    await screen.findByText(/· Math ·/);
    expect(screen.getByText(en.workflows.feedback)).toBeTruthy();
    if (cached !== undefined) await refresh(["student", "feedbackSettings"]);
    await screen.findByText(en.workflows.feedbackVisibilityUnavailable);
    expect(screen.queryByText(en.workflows.privateFeedback)).toBeNull();
    expect(screen.queryByText(en.workflows.sharedFeedback)).toBeNull();
    expect(screen.getByText(en.workflows.feedback)).toBeTruthy();
  },
);
it("keeps feedback text through cached failure and restores write access only after a successful read", async () => {
  mount(<StudentPortal view="attendance" />);
  fireEvent.click(await screen.findByText(en.workflows.feedback));
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.workflows.body,
  });
  fireEvent.change(input, { target: { value: "Unsaved feedback" } });
  remote.me.mockRejectedValue(new Error("Offline"));
  await refresh(["student", "me"]);
  await screen.findAllByText(en.participantRecovery.refreshFailed);
  expect(input.isConnected).toBe(true);
  expect(input.value).toBe("Unsaved feedback");
  expect(input.closest("fieldset")?.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.workflows.save,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(input.closest("form")!);
  expect(remote.feedback).not.toHaveBeenCalled();
  remote.me.mockResolvedValue(personal);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.workflows.save,
      }).disabled,
    ).toBe(false),
  );
  expect(input.value).toBe("Unsaved feedback");
  expect(input.closest("fieldset")?.disabled).toBe(false);
});

it("freezes only the pending feedback draft, retains rejected text and clears an obsolete saved receipt on edit", async () => {
  remote.me.mockResolvedValue({
    ...personal,
    sessions: [
      personal.sessions[0],
      {
        ...personal.sessions[0],
        session: { ...personal.sessions[0]!.session, id: "other-session" },
      },
    ],
  });
  let reject!: (error: Error) => void;
  remote.feedback.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  mount(<StudentPortal view="attendance" />);
  for (const summary of await screen.findAllByText(en.workflows.feedback))
    fireEvent.click(summary);
  const [first, second] = screen.getAllByRole<HTMLTextAreaElement>("textbox", {
    name: en.workflows.body,
  });
  fireEvent.change(first!, { target: { value: "First independent draft" } });
  fireEvent.change(second!, { target: { value: "Other independent draft" } });
  fireEvent.submit(first!.closest("form")!);
  fireEvent.submit(first!.closest("form")!);
  await waitFor(() => expect(remote.feedback).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(first!.closest("fieldset")?.disabled).toBe(true));
  expect(second!.closest("fieldset")?.disabled).toBe(false);
  fireEvent.change(second!, {
    target: { value: "Other draft stays editable" },
  });
  await act(async () => reject(new Error("Synthetic failed feedback")));
  await screen.findByText("Synthetic failed feedback");
  expect(first!.value).toBe("First independent draft");
  expect(second!.value).toBe("Other draft stays editable");
  expect(first!.closest("fieldset")?.disabled).toBe(false);
  fireEvent.submit(first!.closest("form")!);
  await screen.findByText(en.workflows.saved);
  expect(remote.feedback.mock.calls[0]?.[0]).toEqual(
    remote.feedback.mock.calls[1]?.[0],
  );
  fireEvent.change(first!, { target: { value: "A new unsaved draft" } });
  // React Query batches mutation reset notifications; observe the rendered result.
  await waitFor(() =>
    expect(screen.queryByText(en.workflows.saved)).toBeNull(),
  );
  expect(second!.value).toBe("Other draft stays editable");
});
it("shows initial failure with a read-only retry and no invented empty records", async () => {
  remote.me.mockRejectedValue(new Error("Offline"));
  mount(<StudentPortal view="support" />);
  await screen.findByText(en.participantRecovery.loadFailed);
  expect(screen.queryByText(en.workflows.empty)).toBeNull();
  remote.me.mockResolvedValue(personal);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await screen.findByText("Authored reason");
  expect(remote.appeal).not.toHaveBeenCalled();
});
it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "evicts all private feed pages on %s and does not lift denial on a network retry",
  async (code) => {
    client.setQueryData(key(["student", "me"], { page: 0 }), personal);
    client.setQueryData(key(["student", "me"], { page: 1 }), personal);
    client.setQueryData(["unrelated"], "keep");
    mount(<StudentPortal view="support" />);
    await screen.findByText("Authored reason");
    remote.me.mockRejectedValue(
      Object.assign(new Error("Denied"), { data: { code } }),
    );
    await refresh(["student", "me"]);
    await screen.findByText(en.participantRecovery.accessDenied);
    expect(screen.queryByText("Authored reason")).toBeNull();
    expect(
      client.getQueryData(key(["student", "me"], { page: 1 })),
    ).toBeUndefined();
    expect(client.getQueryData(["unrelated"])).toBe("keep");
    remote.me.mockRejectedValue(new Error("Offline"));
    fireEvent.click(
      screen.getByRole("button", { name: en.participantRecovery.retry }),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByText(en.participantRecovery.accessDenied)).toBeTruthy();
    remote.me.mockResolvedValue(personal);
    fireEvent.click(
      screen.getByRole("button", { name: en.participantRecovery.retry }),
    );
    await screen.findByText("Authored reason");
  },
);
it("retains the appeal draft and read retry in its modal, and blocks pending dismissal and accepted-write replay", async () => {
  mount(<StudentPortal view="support" />);
  fireEvent.click(
    await screen.findByRole("button", { name: en.workflows.appeal }),
  );
  const dialog = screen.getByRole("dialog");
  const input = within(dialog).getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(input, { target: { value: "Appeal draft" } });
  remote.me.mockRejectedValue(new Error("Offline"));
  await refresh(["student", "me"]);
  await within(dialog).findByText(en.participantRecovery.refreshFailed);
  expect(input.value).toBe("Appeal draft");
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: en.workflows.submit,
    }).disabled,
  ).toBe(true);
  remote.me.mockResolvedValue(personal);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: en.workflows.submit,
      }).disabled,
    ).toBe(false),
  );
  let finish!: (value: object) => void;
  remote.appeal.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.workflows.submit }),
  );
  await waitFor(() => expect(input.disabled).toBe(true));
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.workflows.cancel }),
  );
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(dialog.isConnected).toBe(true);
  remote.me.mockRejectedValue(new Error("Read failed after accepted write"));
  await act(async () => {
    finish({});
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  remote.me.mockResolvedValue(personal);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.participantRecovery.refreshFailed)).toBeNull(),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.workflows.appeal,
    }).disabled,
  ).toBe(true);
  expect(remote.appeal).toHaveBeenCalledTimes(1);
});
it("retains selected availability on background failure and localizes the stored weekday", async () => {
  mount(<StudentWorkspace />, "zh");
  fireEvent.click(
    await screen.findByRole("button", { name: zh.signupEditing.edit }),
  );
  const dialog = screen.getByRole("dialog");
  const choices = await within(dialog).findAllByRole("checkbox");
  fireEvent.click(choices[1]!);
  expect(document.body.textContent).toContain("周一 15:30–16:30");
  // The full editor owns the exact source query independently of its parent list.
  remote.signup.mockRejectedValue(new Error("Offline"));
  await refresh(["studentWorkflow", "signup"]);
  await within(dialog).findByText(zh.signupEditing.loadFailed);
  expect((choices[1] as HTMLInputElement).checked).toBe(true);
  expect(choices[1]!.isConnected).toBe(true);
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: zh.signupEditing.save,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(choices[1]!.closest("form")!);
  expect(remote.edit).not.toHaveBeenCalled();
  remote.signup.mockResolvedValue(signup());
  fireEvent.click(
    within(dialog).getByRole("button", { name: zh.signupEditing.retry }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: zh.signupEditing.save,
      }).disabled,
    ).toBe(false),
  );
  expect((choices[1] as HTMLInputElement).checked).toBe(true);
  expect(remote.edit).not.toHaveBeenCalled();
});

it.each(["en", "zh"])(
  "uses the authoritative current-period restriction for an empty %s request workspace",
  async (locale) => {
    remote.mine.mockResolvedValue([]);
    remote.legacy.mockResolvedValue([]);
    mount(<StudentWorkspace quarterBlocked />, locale);
    const messages = locale === "zh" ? zh : en;
    expect(await screen.findByText(messages.workflow.abortFinal)).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: messages.workflow.newRequest }),
    ).toBeNull();
  },
);

it("keeps a saved signup draft read-only through refresh failure and recovers without duplicating the accepted write", async () => {
  mount(<StudentWorkspace />);
  fireEvent.click(
    await screen.findByRole("button", { name: en.signupEditing.edit }),
  );
  const dialog = screen.getByRole("dialog");
  const choices = await within(dialog).findAllByRole("checkbox");
  fireEvent.click(choices[1]!);
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: en.signupEditing.save,
      }).disabled,
    ).toBe(false),
  );
  let finish!: (value: { ok: boolean; version: number }) => void;
  remote.edit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const form = choices[1]!.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(remote.edit).toHaveBeenCalledTimes(1));
  expect(remote.edit.mock.calls[0]?.[0]).toMatchObject({
    id: request.id,
    expectedVersion: 0,
    answers: { slotIds: ["mon", "tue"] },
  });
  remote.signup.mockRejectedValue(
    new Error("Read failed after the write was accepted"),
  );
  await act(async () => finish({ ok: true, version: 1 }));
  await within(dialog).findByText(en.signupEditing.savedRefresh);
  expect((choices[1] as HTMLInputElement).checked).toBe(true);
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: en.signupEditing.save,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(form);
  expect(remote.edit).toHaveBeenCalledTimes(1);
  remote.signup.mockResolvedValue({
    ...signup(1),
    answers: { ...signup(1).answers, slotIds: ["mon", "tue"] },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.signupEditing.retryRefresh }),
  );
  await within(dialog).findByText(en.signupEditing.saved);
  expect((choices[1] as HTMLInputElement).checked).toBe(true);
  expect(remote.edit).toHaveBeenCalledTimes(1);
});
it("does not offer a new request while legacy eligibility is unknown", async () => {
  remote.mine.mockResolvedValue([]);
  remote.legacy.mockRejectedValue(new Error("Offline"));
  mount(<StudentWorkspace />);
  await screen.findByText(en.participantRecovery.loadFailed);
  expect(
    screen.queryByRole("link", { name: en.workflow.newRequest }),
  ).toBeNull();
});
it.each(["request", "legacy"])(
  "retains the %s withdrawal reason and allows read recovery inside the open dialog",
  async (kind) => {
    if (kind === "legacy") remote.legacy.mockResolvedValue(legacy);
    mount(kind === "request" ? <StudentWorkspace /> : <LegacyParticipation />);
    fireEvent.click(
      await screen.findByRole("button", { name: en.workflow.applyAbort }),
    );
    const dialog = screen.getByRole("dialog");
    const reason = within(dialog).getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(reason, {
      target: { value: "Keep this withdrawal reason" },
    });
    const load = kind === "request" ? remote.mine : remote.legacy;
    load.mockRejectedValue(new Error("Offline"));
    await refresh([
      "studentWorkflow",
      kind === "request" ? "mine" : "legacyParticipation",
    ]);
    await within(dialog).findByText(en.participantRecovery.refreshFailed);
    expect(dialog.isConnected).toBe(true);
    expect(reason.value).toBe("Keep this withdrawal reason");
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: "Confirm timed action",
      }).disabled,
    ).toBe(true);
    load.mockResolvedValue(kind === "request" ? [request] : legacy);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en.participantRecovery.retry,
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole<HTMLButtonElement>("button", {
          name: "Confirm timed action",
        }).disabled,
      ).toBe(false),
    );
    expect(reason.value).toBe("Keep this withdrawal reason");
    expect(remote.withdraw).not.toHaveBeenCalled();
  },
);

it.each(["request", "legacy"])(
  "removes %s private content on denial and restores it only after an authorized read",
  async (kind) => {
    const path = [
      "studentWorkflow",
      kind === "request" ? "mine" : "legacyParticipation",
    ];
    const load = kind === "request" ? remote.mine : remote.legacy;
    const value = kind === "request" ? [request] : legacy;
    load.mockResolvedValue(value);
    mount(kind === "request" ? <StudentWorkspace /> : <LegacyParticipation />);
    await screen.findByRole("button", { name: en.workflow.applyAbort });
    load.mockRejectedValue(
      Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
    );
    await refresh(path);
    await screen.findByText(en.participantRecovery.accessDenied);
    expect(
      screen.queryByRole("button", { name: en.workflow.applyAbort }),
    ).toBeNull();
    expect(client.getQueryData(key(path))).toBeUndefined();
    load.mockRejectedValue(new Error("Offline"));
    fireEvent.click(
      screen.getByRole("button", { name: en.participantRecovery.retry }),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByText(en.participantRecovery.accessDenied)).toBeTruthy();
    load.mockResolvedValue(value);
    fireEvent.click(
      screen.getByRole("button", { name: en.participantRecovery.retry }),
    );
    await screen.findByRole("button", { name: en.workflow.applyAbort });
  },
);

const retainedRequest = {
  ...request,
  id: "retained-request",
  subjects: [{ name: "English" }],
  submittedAt: new Date("2026-10-02"),
  pairings: [],
};
const retainedSignup = (version = 7) => ({
  ...signup(version),
  id: retainedRequest.id,
  email: "original-english@example.test",
  submittedAt: retainedRequest.submittedAt,
  answers: {
    ...signup(version).answers,
    firstName: "English",
    englishName: "English Name",
    preferredContact: "English contact",
    firstChoiceId: "english",
  },
  assignedSubjectIds: [],
});
function ownTwoRequests() {
  remote.mine.mockResolvedValue([request, retainedRequest]);
  remote.options.mockResolvedValue({
    subjects: [
      { id: "math", name: "Math" },
      { id: "english", name: "English" },
    ],
    slots: [slot, { ...slot, id: "tue", dayOfWeek: 2 }],
  });
  remote.signup.mockImplementation(async ({ id }: { id: string }) =>
    id === retainedRequest.id ? retainedSignup() : signup(),
  );
}

function withdrawalReview(id: string, state: "PENDING" | "DENIED" | "APPROVED") {
  return {
    id,
    kind: "STUDENT_ABORT",
    reason: "Synthetic withdrawal review",
    state,
    createdAt: new Date("2026-10-03"),
    resolvedAt: state === "PENDING" ? null : new Date("2026-10-04"),
    pairingId: null,
    assignment: null,
  } satisfies RouterOutputs["studentWorkflow"]["mine"][number]["reviews"][number];
}

async function submitWorkspaceWithdrawal(
  messages: { workflow: { applyAbort: string } } = en,
) {
  const article = await screen.findByRole("article", { name: "Math" });
  fireEvent.click(within(article).getByRole("button", { name: new RegExp(messages.workflow.applyAbort) }));
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("data-action")).toBe("SURVEY_ABORT");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Synthetic renewed withdrawal reason" } });
  const confirm = within(dialog).getByRole("button", { name: "Confirm timed action" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

it.each(["en", "zh"])(
  "exposes both open sources with distinct controls and keeps terminal history in %s",
  async (locale) => {
    ownTwoRequests();
    const messages = locale === "zh" ? zh : en;
    remote.mine.mockResolvedValue([
      request,
      retainedRequest,
      {
        ...request,
        id: "closed-request",
        state: "RECALLED",
        subjects: [{ name: "History" }],
      },
    ]);
    mount(<StudentWorkspace />, locale);
    const first = await screen.findByRole("article", { name: "Math" });
    const second = screen.getByRole("article", { name: "English" });
    expect(
      screen.getByRole("heading", {
        name: messages.workflow.currentRequests,
        level: 2,
      }),
    ).toBeTruthy();
    for (const [region, subject] of [
      [first, "Math"],
      [second, "English"],
    ] as const) {
      expect(
        within(region).getByRole("heading", { name: subject, level: 3 }),
      ).toBeTruthy();
      expect(
        within(region).getByRole("heading", {
          name: messages.workflow.availability,
          level: 4,
        }),
      ).toBeTruthy();
      expect(
        within(region).getByRole("button", {
          name: new RegExp(`${messages.signupEditing.edit}.*${subject}`),
        }),
      ).toBeTruthy();
      expect(region.getAttribute("aria-describedby")).toBeTruthy();
    }
    expect(
      within(first).getByRole("button", {
        name: new RegExp(`${messages.workflow.applyAbort}.*Math`),
      }),
    ).toBeTruthy();
    expect(
      within(second).getByRole("button", {
        name: new RegExp(`${messages.workflow.recall}.*English`),
      }),
    ).toBeTruthy();
    const history = document.getElementById("request-history")!;
    expect(within(history).getByText("History")).toBeTruthy();
    expect(
      within(history).getByText(messages.workflow.state.RECALLED),
    ).toBeTruthy();
    expect(within(history).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("article", { name: "History" })).toBeNull();
    expect(document.querySelectorAll("#current-request")).toHaveLength(1);
    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.body.textContent).not.toContain(retainedRequest.id);
    expect(remote.signup).not.toHaveBeenCalled();
    expect(remote.withdraw).not.toHaveBeenCalled();
  },
);

it("keeps the second source's editor, version and draft bound through reorder, failed synchronization and independent reopenings", async () => {
  ownTwoRequests();
  let saved = retainedSignup();
  let unavailable = false;
  remote.signup.mockImplementation(async ({ id }: { id: string }) => {
    if (id !== retainedRequest.id) return signup();
    if (unavailable) throw new Error("English source unavailable");
    return saved;
  });
  remote.edit.mockImplementation(
    async (input: { id: string; answers: typeof saved.answers }) => {
      saved = { ...saved, version: 8, answers: input.answers };
      unavailable = true;
      return { ok: true, version: 8 };
    },
  );
  mount(<StudentWorkspace />);
  const english = await screen.findByRole("article", { name: "English" });
  fireEvent.click(
    within(english).getByRole("button", { name: /Edit signup answers/ }),
  );
  const dialog = screen.getByRole("dialog");
  const contact = await within(dialog).findByDisplayValue("English contact");
  fireEvent.change(contact, { target: { value: "English saved contact" } });
  remote.mine.mockResolvedValue([retainedRequest, request]);
  await refresh(["studentWorkflow", "mine"]);
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByDisplayValue("English saved contact")).toBe(
    contact,
  );
  expect(
    within(dialog).getByDisplayValue("original-english@example.test"),
  ).toBeTruthy();
  const form = within(dialog)
    .getByRole("button", { name: en.signupEditing.save })
    .closest("form")!;
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: en.signupEditing.save,
      }).disabled,
    ).toBe(false),
  );
  fireEvent.submit(form);
  await within(dialog).findByText(en.signupEditing.savedRefresh);
  expect(remote.edit.mock.calls[0]?.[0]).toMatchObject({
    id: retainedRequest.id,
    expectedVersion: 7,
    answers: {
      firstChoiceId: "english",
      preferredContact: "English saved contact",
    },
  });
  fireEvent.submit(form);
  expect(remote.edit).toHaveBeenCalledTimes(1);
  unavailable = false;
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.signupEditing.retryRefresh }),
  );
  await within(dialog).findByText(en.signupEditing.saved);
  expect(remote.edit).toHaveBeenCalledTimes(1);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.accountProfile.close }),
  );

  fireEvent.click(
    within(screen.getByRole("article", { name: "Math" })).getByRole("button", {
      name: /Edit signup answers/,
    }),
  );
  const mathDialog = screen.getByRole("dialog");
  const original =
    await within(mathDialog).findByDisplayValue("Original contact");
  fireEvent.change(original, { target: { value: "Unsaved math contact" } });
  fireEvent.click(
    within(mathDialog).getByRole("button", { name: en.accountProfile.close }),
  );
  fireEvent.click(
    within(screen.getByRole("article", { name: "English" })).getByRole(
      "button",
      { name: /Edit signup answers/ },
    ),
  );
  const reopened = screen.getByRole("dialog");
  await within(reopened).findByDisplayValue("English saved contact");
  expect(
    within(reopened).queryByDisplayValue("Unsaved math contact"),
  ).toBeNull();
  expect(remote.signup).toHaveBeenCalledWith({ id: request.id });
  expect(remote.signup).toHaveBeenCalledWith({ id: retainedRequest.id });
  expect(remote.edit).toHaveBeenCalledTimes(1);
});

it("preserves a pending source action after its card closes and recovers accepted writes without replay or another source's ticket", async () => {
  ownTwoRequests();
  let finish!: () => void;
  remote.withdraw.mockReturnValueOnce(
    new Promise<{ ok: boolean; reviewId: string }>((resolve) => {
      finish = () => resolve({ ok: true, reviewId: "withdrawal-review" });
    }),
  );
  remote.withdraw.mockResolvedValue({ ok: true });
  mount(<StudentWorkspace />);
  const english = await screen.findByRole("article", { name: "English" });
  fireEvent.click(
    within(english).getByRole("button", { name: /Recall request/ }),
  );
  expect(screen.getByRole("dialog").getAttribute("data-target")).toBe(
    retainedRequest.id,
  );
  expect(screen.getByRole("dialog").getAttribute("data-action")).toBe("RECALL");
  fireEvent.click(screen.getByRole("button", { name: "Cancel timed action" }));
  expect(remote.withdraw).not.toHaveBeenCalled();

  fireEvent.click(
    within(screen.getByRole("article", { name: "Math" })).getByRole("button", {
      name: /Request Withdrawal/,
    }),
  );
  const dialog = screen.getByRole("dialog");
  const reason = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
    name: en.workflow.reason,
  });
  fireEvent.change(reason, { target: { value: "Math withdrawal reason" } });
  const confirm = within(dialog).getByRole("button", {
    name: "Confirm timed action",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(remote.withdraw).toHaveBeenCalledTimes(1));
  expect(remote.withdraw.mock.calls[0]?.[0]).toEqual({
    id: request.id,
    reason: "Math withdrawal reason",
    ticket: "ticket",
  });
  const terminal = { ...request, state: "ABORTED", reviews: [withdrawalReview("withdrawal-review", "APPROVED")] };
  remote.mine.mockResolvedValue([retainedRequest, terminal]);
  await refresh(["studentWorkflow", "mine"]);
  expect(
    client
      .getQueryData<Array<{ id: string; state: string }>>(
        key(["studentWorkflow", "mine"]),
      )
      ?.find((row) => row.id === request.id)?.state,
  ).toBe("ABORTED");
  // Refetch resolves with the cache update; React Query batches the observer's
  // render separately. Wait for that commit before checking the retained dialog.
  await waitFor(() =>
    expect(screen.queryByRole("article", { name: "Math" })).toBeNull(),
  );
  expect(
    within(document.getElementById("request-history")!).getByText(
      en.workflow.state.ABORTED,
    ),
  ).toBeTruthy();
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(dialog.getAttribute("data-target")).toBe(request.id);
  expect(reason.value).toBe("Math withdrawal reason");
  expect(reason.disabled).toBe(true);
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Cancel timed action",
    }).disabled,
  ).toBe(true);

  remote.mine.mockRejectedValue(
    new Error("Accepted withdrawal status unavailable"),
  );
  await act(async () => finish());
  await screen.findByText(en.workflow.abortAccepted);
  expect(screen.queryByRole("dialog")).toBeNull();
  remote.mine.mockResolvedValue([retainedRequest, terminal]);
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.retryRefresh }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.workflow.abortAccepted)).toBeNull(),
  );
  expect(remote.withdraw).toHaveBeenCalledTimes(1);

  fireEvent.click(
    within(screen.getByRole("article", { name: "English" })).getByRole(
      "button",
      { name: en.workflow.recall },
    ),
  );
  expect(screen.getByRole("dialog").getAttribute("data-target")).toBe(
    retainedRequest.id,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm timed action" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(remote.withdraw.mock.calls[1]?.[0]).toEqual({
    id: retainedRequest.id,
    ticket: "ticket",
  });
  expect(
    within(
      screen.getByRole("article", { name: "English" }),
    ).getByRole<HTMLButtonElement>("button", { name: en.workflow.recall })
      .disabled,
  ).toBe(true);

  remote.mine.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await refresh(["studentWorkflow", "mine"]);
  await screen.findByText(en.participantRecovery.accessDenied);
  expect(screen.queryByRole("article")).toBeNull();
  remote.mine.mockResolvedValue([retainedRequest, terminal]);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  const restored = await screen.findByRole("article", { name: "English" });
  expect(
    within(restored).getByRole<HTMLButtonElement>("button", {
      name: en.workflow.recall,
    }).disabled,
  ).toBe(true);
  expect(remote.withdraw).toHaveBeenCalledTimes(2);
});

it.each(["en", "zh"])(
  "allows another withdrawal after its exact decline arrives through a sibling recall, without observing pending (%s)",
  async (locale) => {
    ownTwoRequests();
    const messages = locale === "zh" ? zh : en;
    const older = withdrawalReview("older-withdrawal", "DENIED");
    remote.mine.mockResolvedValue([{ ...request, reviews: [older] }, retainedRequest]);
    mount(<StudentWorkspace />, locale);
    await submitWorkspaceWithdrawal(messages);
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    const first = screen.getByRole("article", { name: "Math" });
    expect(within(first).getByRole<HTMLButtonElement>("button", { name: new RegExp(messages.workflow.applyAbort) }).disabled).toBe(true);
    expect(screen.getByText(messages.workflow.abortAccepted)).toBeTruthy();

    const declined = { ...request, reviews: [withdrawalReview("withdrawal-review", "DENIED"), older] };
    remote.withdraw.mockImplementationOnce(async () => {
      remote.mine.mockResolvedValue([{ ...retainedRequest, state: "RECALLED" }, declined]);
      return { ok: true };
    });
    fireEvent.click(within(screen.getByRole("article", { name: "English" })).getByRole("button", { name: new RegExp(messages.workflow.recall) }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm timed action" }));
    await waitFor(() => expect(within(screen.getByRole("article", { name: "Math" })).getByRole<HTMLButtonElement>("button", { name: messages.workflow.applyAbort }).disabled).toBe(false));
    expect(screen.queryByText(messages.workflow.abortAccepted)).toBeNull();
    expect(remote.withdraw).toHaveBeenCalledTimes(2);
    expect(remote.withdraw.mock.calls[1]?.[0]).toEqual({ id: retainedRequest.id, ticket: "ticket" });

    remote.withdraw.mockResolvedValue({ ok: true, reviewId: "renewed-withdrawal" });
    remote.mine.mockResolvedValue([{ ...declined, reviews: [withdrawalReview("renewed-withdrawal", "PENDING"), ...declined.reviews] }]);
    await submitWorkspaceWithdrawal(messages);
    await screen.findByText(messages.workflow.abortPending);
    expect(screen.queryByRole("button", { name: messages.workflow.applyAbort })).toBeNull();
    expect(screen.queryByText(messages.workflow.abortAccepted)).toBeNull();
    expect(remote.withdraw).toHaveBeenCalledTimes(3);
    expect(remote.withdraw.mock.calls[2]?.[0]).toEqual({ id: request.id, reason: "Synthetic renewed withdrawal reason", ticket: "ticket" });
  },
);

it("retains accepted withdrawal recovery through failed and manual cached reads, then clears it on a fresh exact decline", async () => {
  remote.withdraw.mockImplementation(async () => {
    remote.mine.mockRejectedValue(new Error("Synthetic accepted withdrawal refresh failure"));
    return { ok: true, reviewId: "withdrawal-review" };
  });
  mount(<StudentWorkspace />);
  await submitWorkspaceWithdrawal();
  expect(screen.getByText(en.workflow.abortAccepted)).toBeTruthy();
  const declined = { ...request, reviews: [withdrawalReview("withdrawal-review", "DENIED")] };
  await act(async () => { client.setQueryData(key(["studentWorkflow", "mine"]), [declined]); });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: en.workflow.applyAbort }).disabled).toBe(true);
  expect(screen.getByText(en.workflow.abortAccepted)).toBeTruthy();
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
  remote.mine.mockResolvedValue([declined]);
  await refresh(["studentWorkflow", "mine"]);
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: en.workflow.applyAbort }).disabled).toBe(false));
  expect(screen.queryByText(en.workflow.abortAccepted)).toBeNull();
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
});

it.each(["older decline", "approved", "terminal decline"])(
  "keeps an accepted withdrawal guarded after a fresh %s read",
  async (outcome) => {
    mount(<StudentWorkspace />);
    await submitWorkspaceWithdrawal();
    const review = withdrawalReview(outcome === "older decline" ? "older-withdrawal" : "withdrawal-review", outcome === "approved" ? "APPROVED" : "DENIED");
    remote.mine.mockResolvedValue([{ ...request, state: outcome === "terminal decline" ? "RECALLED" : "OPEN", reviews: [review] }]);
    await refresh(["studentWorkflow", "mine"]);
    // A terminal row followed by an obsolete OPEN read must not resurrect the action.
    if (outcome === "terminal decline") {
      await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
      remote.mine.mockResolvedValue([request]);
      await refresh(["studentWorkflow", "mine"]);
    }
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: en.workflow.applyAbort }).disabled).toBe(true));
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
  },
);

it("keeps the accepted withdrawal receipt during denied and failed recovery, then releases it after fresh authorization and its exact decline", async () => {
  mount(<StudentWorkspace />);
  await submitWorkspaceWithdrawal();
  remote.mine.mockRejectedValue(Object.assign(new Error("Synthetic denial"), { data: { code: "FORBIDDEN" } }));
  await refresh(["studentWorkflow", "mine"]);
  await screen.findByText(en.participantRecovery.accessDenied);
  expect(screen.queryByRole("article")).toBeNull();
  remote.mine.mockRejectedValue(new Error("Synthetic recovery unavailable"));
  fireEvent.click(screen.getByRole("button", { name: en.participantRecovery.retry }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByText(en.participantRecovery.accessDenied)).toBeTruthy();
  remote.mine.mockResolvedValue([request]);
  fireEvent.click(screen.getByRole("button", { name: en.participantRecovery.retry }));
  await screen.findByRole("article", { name: "Math" });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: en.workflow.applyAbort }).disabled).toBe(true);
  expect(screen.getByText(en.workflow.abortAccepted)).toBeTruthy();
  remote.mine.mockResolvedValue([{ ...request, reviews: [withdrawalReview("withdrawal-review", "DENIED")] }]);
  await refresh(["studentWorkflow", "mine"]);
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: en.workflow.applyAbort }).disabled).toBe(false));
  expect(screen.queryByText(en.workflow.abortAccepted)).toBeNull();
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
});

it.each(["en", "zh"])(
  "recovers an interrupted withdrawal through its exact read-only receipt without repeating submission (%s)",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    remote.withdraw.mockRejectedValue(
      new Error("Read the confirmation and wait for its timer"),
    );
    mount(<StudentWorkspace />, locale);
    await submitWorkspaceWithdrawal(messages);
    expect(screen.getByText(messages.workflow.abortUnconfirmed)).toBeTruthy();
    expect(screen.queryByText(messages.workflow.abortAccepted)).toBeNull();
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    expect(remote.abortReceipt).not.toHaveBeenCalled();
    expect(remote.cancelAction).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.workflow.applyAbort,
      }).disabled,
    ).toBe(true);

    remote.abortReceipt.mockRejectedValueOnce(
      new Error("Synthetic receipt unavailable"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.workflow.checkAbortSubmission,
      }),
    );
    await screen.findByText(messages.workflow.abortCheckFailed);
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    expect(remote.cancelAction).not.toHaveBeenCalled();
    remote.abortReceipt.mockResolvedValue({
      status: "ACCEPTED",
      reviewId: "withdrawal-review",
    });
    remote.mine.mockResolvedValue([
      {
        ...request,
        reviews: [withdrawalReview("withdrawal-review", "PENDING")],
      },
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.workflow.checkAbortSubmission,
      }),
    );
    await screen.findByText(messages.workflow.abortPending);
    expect(screen.queryByText(messages.workflow.abortUnconfirmed)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(remote.abortReceipt).toHaveBeenLastCalledWith(
      {
        id: request.id,
        ticket: "ticket",
        reasonHash: createHash("sha256")
          .update("Synthetic renewed withdrawal reason")
          .digest("hex"),
      },
      { staleTime: 0 },
    );
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    expect(remote.cancelAction).not.toHaveBeenCalled();
  },
);

it("retains an uncertain exact intent through unrelated and denied source reads, then permits a fresh attempt only after proven retirement", async () => {
  remote.withdraw.mockRejectedValue(
    new Error("Synthetic interrupted delivery"),
  );
  mount(<StudentWorkspace />);
  await submitWorkspaceWithdrawal();
  remote.mine.mockResolvedValue([
    { ...request, reviews: [withdrawalReview("older", "DENIED")] },
  ]);
  await refresh(["studentWorkflow", "mine"]);
  expect(screen.getByText(en.workflow.abortUnconfirmed)).toBeTruthy();
  remote.mine.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await refresh(["studentWorkflow", "mine"]);
  await screen.findByText(en.participantRecovery.accessDenied);
  expect(screen.queryByText(en.workflow.abortUnconfirmed)).toBeNull();
  remote.mine.mockResolvedValue([request]);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await screen.findByText(en.workflow.abortUnconfirmed);
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.checkAbortSubmission }),
  );
  await screen.findByText(en.workflow.abortNotConfirmed);
  expect(remote.cancelAction).not.toHaveBeenCalled();
  remote.abortReceipt.mockRejectedValueOnce(
    new Error("Synthetic read failure after retirement"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.freshAbortReview }),
  );
  await screen.findByText(en.workflow.abortCheckFailed);
  expect(remote.cancelAction).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.freshAbortReview }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Synthetic renewed withdrawal reason",
  );
  expect(remote.cancelAction).toHaveBeenCalledTimes(1);
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
  remote.withdraw.mockResolvedValue({ ok: true, reviewId: "fresh-review" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Confirm timed action" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(remote.withdraw).toHaveBeenCalledTimes(2);
});

it("does not turn a missing or consumed legacy proof into permission to replay an uncertain submission", async () => {
  remote.withdraw.mockRejectedValue(new Error("Synthetic interruption"));
  remote.cancelAction.mockResolvedValue({ count: 0 });
  remote.abortReceipt.mockResolvedValue({
    status: "UNCONFIRMED",
    canRetire: false,
  });
  mount(<StudentWorkspace />);
  await submitWorkspaceWithdrawal();
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.checkAbortSubmission }),
  );
  await screen.findByText(en.workflow.abortStillUnknown);
  expect(
    screen.queryByRole("button", { name: en.workflow.freshAbortReview }),
  ).toBeNull();
  expect(remote.cancelAction).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.workflow.applyAbort,
    }).disabled,
  ).toBe(true);
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
});

it("recovers acceptance that wins the retirement race and still releases only its exact later decline", async () => {
  remote.withdraw.mockRejectedValue(new Error("Synthetic interruption"));
  remote.cancelAction.mockResolvedValue({ count: 0 });
  mount(<StudentWorkspace />);
  await submitWorkspaceWithdrawal();
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.checkAbortSubmission }),
  );
  await screen.findByText(en.workflow.abortNotConfirmed);
  remote.abortReceipt.mockResolvedValue({
    status: "ACCEPTED",
    reviewId: "withdrawal-review",
  });
  remote.mine.mockResolvedValue([
    { ...request, reviews: [withdrawalReview("withdrawal-review", "DENIED")] },
  ]);
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.freshAbortReview }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.workflow.applyAbort,
      }).disabled,
    ).toBe(false),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(en.workflow.abortNotConfirmed)).toBeNull();
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
});

it("recovers a lost unused-proof retirement reply without resubmitting or retiring a second time", async () => {
  remote.withdraw.mockRejectedValue(new Error("Synthetic interrupted result"));
  remote.cancelAction.mockImplementationOnce(async () => {
    remote.abortReceipt.mockResolvedValue({ status: "NOT_ACCEPTED" });
    throw new Error("Synthetic lost retirement response");
  });
  mount(<StudentWorkspace />);
  await submitWorkspaceWithdrawal();
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.checkAbortSubmission }),
  );
  await screen.findByText(en.workflow.abortNotConfirmed);
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.freshAbortReview }),
  );
  await screen.findByText(en.workflow.abortCheckFailed);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.checkAbortSubmission }),
  );
  await screen.findByText(en.workflow.abortNotAccepted);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.freshAbortReview }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(dialog.getAttribute("data-action")).toBe("SURVEY_ABORT");
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Synthetic renewed withdrawal reason",
  );
  expect(remote.cancelAction).toHaveBeenCalledTimes(1);
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
});

it.each(["pending", "unassigned", "closed", "missing"] as const)(
  "retains a proved unaccepted attempt when the fresh source is %s, with no unavailable timed review",
  async (state) => {
    remote.withdraw.mockRejectedValue(
      new Error("Synthetic expired or collected proof"),
    );
    remote.abortReceipt.mockResolvedValue({ status: "NOT_ACCEPTED" });
    mount(<StudentWorkspace />);
    await submitWorkspaceWithdrawal();
    fireEvent.click(
      screen.getByRole("button", { name: en.workflow.checkAbortSubmission }),
    );
    await screen.findByRole("button", { name: en.workflow.freshAbortReview });
    remote.mine.mockResolvedValue(
      state === "missing"
        ? []
        : [
            {
              ...request,
              ...(state === "closed" ? { state: "ABORTED" } : {}),
              ...(state === "unassigned" ? { pairings: [] } : {}),
              ...(state === "pending"
                ? {
                    reviews: [
                      withdrawalReview("another-withdrawal", "PENDING"),
                    ],
                  }
                : {}),
            },
          ],
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.workflow.freshAbortReview }),
    );
    await screen.findByText(en.workflow.abortNotAccepted);
    await screen.findByText(
      state === "missing"
        ? en.workflow.abortFreshMissing
        : en.workflow.abortFreshUnavailable[state],
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: en.workflow.freshAbortReview }),
    ).toBeNull();
    expect(remote.cancelAction).not.toHaveBeenCalled();
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    if (state === "unassigned")
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: en.workflow.recall,
        }).disabled,
      ).toBe(false);
    remote.mine.mockResolvedValue([request]);
    fireEvent.click(
      screen.getByRole("button", { name: en.workflow.checkAbortSubmission }),
    );
    await screen.findByRole("button", { name: en.workflow.freshAbortReview });
    fireEvent.click(
      screen.getByRole("button", { name: en.workflow.freshAbortReview }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Synthetic renewed withdrawal reason",
    );
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    expect(remote.cancelAction).not.toHaveBeenCalled();
  },
);

// fireEvent does not synthesize Enter's click. Keep the initiating control focused
// and dispatch that activation explicitly; Edge verifies native Tab/close ordering.
function activateFromKeyboard(control: HTMLElement) {
  control.focus();
  fireEvent.keyDown(control, { key: "Enter", code: "Enter" });
  fireEvent.click(control);
}
async function beginKeyboardWithdrawal(messages = en) {
  const article = await screen.findByRole("article", { name: "Math" });
  const opener = within(article).getByRole<HTMLButtonElement>("button", {
    name: messages.workflow.applyAbort,
  });
  activateFromKeyboard(opener);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "Synthetic keyboard withdrawal reason" },
  });
  const confirm = within(dialog).getByRole("button", {
    name: "Confirm timed action",
  });
  activateFromKeyboard(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(remote.withdraw).toHaveBeenCalledTimes(1));
  return { opener, dialog };
}
async function settleFocusFrame() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
}

it.each(["en", "zh"])(
  "hands keyboard focus from an uncertain withdrawal to its read-only check and then its exact pending status (%s)",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    remote.withdraw.mockRejectedValue(
      new Error("Synthetic lost withdrawal response"),
    );
    mount(<StudentWorkspace />, locale);
    await beginKeyboardWithdrawal(messages);
    const check = await screen.findByRole("button", {
      name: messages.workflow.checkAbortSubmission,
    });
    await waitFor(() => expect(document.activeElement).toBe(check));
    expect(check.tabIndex).toBe(0);
    remote.abortReceipt.mockImplementation(async () => {
      remote.mine.mockResolvedValue([
        {
          ...request,
          reviews: [withdrawalReview("withdrawal-review", "PENDING")],
        },
      ]);
      return { status: "ACCEPTED", reviewId: "withdrawal-review" };
    });
    activateFromKeyboard(check);
    fireEvent.click(check);
    const pending = await screen.findByText(messages.workflow.abortPending);
    await waitFor(() => expect(document.activeElement).toBe(pending));
    expect(pending.tabIndex).toBe(-1);
    expect(
      screen.queryByRole("button", {
        name: messages.workflow.checkAbortSubmission,
      }),
    ).toBeNull();
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    expect(remote.abortReceipt).toHaveBeenCalledTimes(1);
    expect(remote.cancelAction).not.toHaveBeenCalled();
  },
);

it("hands direct withdrawal success to its pending status without an extra lookup or write", async () => {
  remote.withdraw.mockImplementation(async () => {
    remote.mine.mockResolvedValue([
      {
        ...request,
        reviews: [withdrawalReview("withdrawal-review", "PENDING")],
      },
    ]);
    return { ok: true, reviewId: "withdrawal-review" };
  });
  mount(<StudentWorkspace />);
  await beginKeyboardWithdrawal();
  const pending = await screen.findByText(en.workflow.abortPending);
  await waitFor(() => expect(document.activeElement).toBe(pending));
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
  expect(remote.abortReceipt).not.toHaveBeenCalled();
});

it("keeps an accepted refresh recovery reachable and hands its explicit refresh to the pending status", async () => {
  remote.withdraw.mockImplementation(async () => {
    remote.mine.mockRejectedValue(
      new Error("Synthetic accepted refresh failure"),
    );
    return { ok: true, reviewId: "withdrawal-review" };
  });
  mount(<StudentWorkspace />);
  await beginKeyboardWithdrawal();
  const retry = await screen.findByRole("button", {
    name: en.workflow.retryRefresh,
  });
  await waitFor(() => expect(document.activeElement).toBe(retry));
  remote.mine.mockResolvedValue([
    { ...request, reviews: [withdrawalReview("withdrawal-review", "PENDING")] },
  ]);
  activateFromKeyboard(retry);
  const pending = await screen.findByText(en.workflow.abortPending);
  await waitFor(() => expect(document.activeElement).toBe(pending));
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
  expect(remote.abortReceipt).not.toHaveBeenCalled();
});

it("hands an explicit accepted lookup to the owned history heading when that request has closed", async () => {
  remote.withdraw.mockRejectedValue(
    new Error("Synthetic interrupted submission"),
  );
  mount(<StudentWorkspace />);
  await beginKeyboardWithdrawal();
  const check = await screen.findByRole("button", {
    name: en.workflow.checkAbortSubmission,
  });
  await waitFor(() => expect(document.activeElement).toBe(check));
  remote.abortReceipt.mockResolvedValue({
    status: "ACCEPTED",
    reviewId: "withdrawal-review",
  });
  remote.mine.mockResolvedValue([
    {
      ...request,
      state: "ABORTED",
      reviews: [withdrawalReview("withdrawal-review", "APPROVED")],
    },
  ]);
  activateFromKeyboard(check);
  const history = screen.getByRole("heading", { name: en.workflow.processed });
  await waitFor(() => expect(document.activeElement).toBe(history));
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
  expect(remote.abortReceipt).toHaveBeenCalledTimes(1);
});

it("retains keyboard focus on a rejected attempt's check and leaves a fresh review's own focus alone", async () => {
  remote.withdraw.mockRejectedValue(new Error("Synthetic rejected submission"));
  remote.abortReceipt.mockResolvedValue({ status: "NOT_ACCEPTED" });
  mount(<StudentWorkspace />);
  await beginKeyboardWithdrawal();
  const check = await screen.findByRole("button", {
    name: en.workflow.checkAbortSubmission,
  });
  await waitFor(() => expect(document.activeElement).toBe(check));
  activateFromKeyboard(check);
  await screen.findByText(en.workflow.abortNotAccepted);
  await waitFor(() => expect(document.activeElement).toBe(check));
  activateFromKeyboard(
    screen.getByRole("button", { name: en.workflow.freshAbortReview }),
  );
  const reason = within(
    await screen.findByRole("dialog"),
  ).getByRole<HTMLTextAreaElement>("textbox");
  // The lightweight dialog mock has no native autofocus; model that initial focus.
  reason.focus();
  await settleFocusFrame();
  expect(document.activeElement).toBe(reason);
  expect(reason.value).toBe("Synthetic keyboard withdrawal reason");
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
  expect(remote.abortReceipt).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  "does not reclaim focus after the user moves outside a pending receipt lookup (outside target removed: %s)",
  async (removeOutside) => {
    let accept!: () => void;
    remote.withdraw.mockRejectedValue(
      new Error("Synthetic interrupted submission"),
    );
    remote.abortReceipt.mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = () =>
            resolve({ status: "ACCEPTED", reviewId: "withdrawal-review" });
        }),
    );
    const outside = document.createElement("button");
    outside.textContent = "Another page control";
    document.body.append(outside);
    try {
      mount(<StudentWorkspace />);
      await beginKeyboardWithdrawal();
      const check = await screen.findByRole("button", {
        name: en.workflow.checkAbortSubmission,
      });
      await waitFor(() => expect(document.activeElement).toBe(check));
      activateFromKeyboard(check);
      await waitFor(() => expect(remote.abortReceipt).toHaveBeenCalledTimes(1));
      outside.focus();
      if (removeOutside) outside.remove();
      remote.mine.mockResolvedValue([
        {
          ...request,
          reviews: [withdrawalReview("withdrawal-review", "PENDING")],
        },
      ]);
      await act(async () => accept());
      await screen.findByText(en.workflow.abortPending);
      await settleFocusFrame();
      expect(document.activeElement).toBe(
        removeOutside ? document.body : outside,
      );
      expect(remote.withdraw).toHaveBeenCalledTimes(1);
      expect(remote.abortReceipt).toHaveBeenCalledTimes(1);
    } finally {
      outside.remove();
    }
  },
);

it("does not queue focus into a disabled recovery or replay that handoff after a background read", async () => {
  let reject!: () => void;
  remote.withdraw.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = () => fail(new Error("Synthetic interrupted submission"));
      }),
  );
  mount(<StudentWorkspace />);
  await beginKeyboardWithdrawal();
  remote.mine.mockRejectedValue(new Error("Synthetic unavailable source"));
  await refresh(["studentWorkflow", "mine"]);
  await act(async () => reject());
  const check = await screen.findByRole<HTMLButtonElement>("button", {
    name: en.workflow.checkAbortSubmission,
  });
  expect(check.disabled).toBe(true);
  await settleFocusFrame();
  expect(document.activeElement).toBe(document.body);
  remote.mine.mockResolvedValue([request]);
  await refresh(["studentWorkflow", "mine"]);
  await settleFocusFrame();
  expect(check.disabled).toBe(false);
  expect(document.activeElement).toBe(document.body);
  expect(remote.withdraw).toHaveBeenCalledTimes(1);
  expect(remote.abortReceipt).not.toHaveBeenCalled();
});

it("does not move focus for ordinary recall or an unrelated background withdrawal read", async () => {
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    remote.mine.mockResolvedValue([{ ...request, pairings: [] }]);
    remote.withdraw.mockImplementation(async () => {
      remote.mine.mockResolvedValue([
        { ...request, state: "RECALLED", pairings: [] },
      ]);
      return { ok: true };
    });
    mount(<StudentWorkspace />);
    activateFromKeyboard(
      await screen.findByRole("button", { name: en.workflow.recall }),
    );
    activateFromKeyboard(
      screen.getByRole("button", { name: "Confirm timed action" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await settleFocusFrame();
    expect(document.activeElement).toBe(document.body);
    outside.focus();
    remote.mine.mockResolvedValue([
      {
        ...request,
        reviews: [withdrawalReview("different-review", "PENDING")],
      },
    ]);
    await refresh(["studentWorkflow", "mine"]);
    await settleFocusFrame();
    expect(document.activeElement).toBe(outside);
    expect(remote.withdraw).toHaveBeenCalledTimes(1);
    expect(remote.abortReceipt).not.toHaveBeenCalled();
  } finally {
    outside.remove();
  }
});

it("announces pending record and visibility reads without inventing empty or private states", async () => {
  remote.me.mockImplementation(() => new Promise(() => undefined));
  const view = mount(<StudentPortal view="attendance" />);
  expect(screen.getByText(en.participantRecovery.loading)).toBeTruthy();
  expect(screen.queryByText(en.workflows.empty)).toBeNull();
  view.unmount();
  client.setQueryData(key(["student", "me"], { page: 0 }), personal);
  client.removeQueries({ queryKey: [["student", "feedbackSettings"]] });
  remote.settings.mockImplementation(() => new Promise(() => undefined));
  mount(<StudentPortal view="attendance" />);
  await screen.findByText(en.workflows.feedbackVisibilityLoading);
  expect(screen.queryByText(en.workflows.privateFeedback)).toBeNull();
});

const disciplineRows = [
  {
    tuteeId: "student",
    englishName: "A very long participant name that must remain complete",
    validRed: 1,
    validYellow: 0,
    effectiveReds: 1,
    removalPending: false,
    pendingCount: 0,
    cards: [
      {
        id: "card",
        color: "RED",
        reviewStatus: "VALID",
        date: new Date("2026-10-01"),
        reason: "Never show this private reason to tutors",
      },
    ],
  },
];
it("distinguishes initial discipline loading/failure from successful empty, and retries only its read", async () => {
  let reject!: (reason: Error) => void;
  remote.discipline.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  mount(<TutorDiscipline />);
  expect(screen.getByText(en.participantRecovery.loading)).toBeTruthy();
  await act(async () => {
    reject(new Error("Offline"));
  });
  await screen.findByText(en.participantRecovery.loadFailed);
  remote.discipline.mockResolvedValue([]);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.tutor.discipline.title)).toBeNull(),
  );
});
it("keeps expanded, reason-free discipline history on failed refresh and revokes it on denial", async () => {
  remote.discipline.mockResolvedValue(disciplineRows);
  mount(<TutorDiscipline />);
  const name = await screen.findByText(disciplineRows[0]!.englishName);
  const details = name.closest("details")!;
  fireEvent.click(name.closest("summary")!);
  expect(details.open).toBe(true);
  expect(name.className).not.toContain("truncate");
  expect(screen.queryByText(disciplineRows[0]!.cards[0]!.reason)).toBeNull();
  remote.discipline.mockRejectedValue(new Error("Offline"));
  await refresh(["tutor", "myTuteeDiscipline"]);
  await screen.findByText(en.participantRecovery.refreshFailed);
  expect(details.isConnected).toBe(true);
  expect(details.open).toBe(true);
  remote.discipline.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await refresh(["tutor", "myTuteeDiscipline"]);
  await screen.findByText(en.participantRecovery.accessDenied);
  expect(name.isConnected).toBe(false);
  expect(
    client.getQueryData(key(["tutor", "myTuteeDiscipline"])),
  ).toBeUndefined();
  remote.discipline.mockRejectedValue(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByText(en.participantRecovery.accessDenied)).toBeTruthy();
  remote.discipline.mockResolvedValue(disciplineRows);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await screen.findByText(disciplineRows[0]!.englishName);
});

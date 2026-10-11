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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { StudentPortal } from "./student-portal";
import { StudentWorkspace } from "../student/student-workspace";
import { LegacyParticipation } from "../student/legacy-participation";
import { TutorDiscipline } from "../(tutor)/_components/tutor-discipline";

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
  discipline: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useMutation } = await import("@tanstack/react-query");
  const read = (path: string[], load: typeof remote.me) => ({
    _def: () => ({ path }),
    useQuery(input?: unknown, options?: { enabled?: boolean }) {
      return useQuery({
        queryKey: [
          path,
          { ...(input === undefined ? {} : { input }), type: "query" },
        ],
        queryFn: (): unknown => load(),
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
      tutor: {
        myTuteeDiscipline: read(
          ["tutor", "myTuteeDiscipline"],
          remote.discipline,
        ),
      },
      useUtils: () => ({
        studentWorkflow: {
          mine: { invalidate: vi.fn() },
          legacyParticipation: { invalidate: vi.fn() },
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
        mine: read(["studentWorkflow", "mine"], remote.mine),
        legacyParticipation: read(
          ["studentWorkflow", "legacyParticipation"],
          remote.legacy,
        ),
        editAvailability: write(remote.edit),
        recall: write(remote.withdraw),
        applyAbort: write(remote.withdraw),
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
  }: {
    children: ReactNode;
    canConfirm: boolean;
    onConfirm: (ticket: string) => void;
    onCancel: () => void;
  }) => (
    <div role="dialog">
      {children}
      <button disabled={!canConfirm} onClick={() => onConfirm("ticket")}>
        Confirm timed action
      </button>
      <button onClick={onCancel}>Cancel timed action</button>
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
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  vi.clearAllMocks();
  remote.me.mockResolvedValue(personal);
  remote.settings.mockResolvedValue(false);
  remote.mine.mockResolvedValue([request]);
  remote.legacy.mockResolvedValue([]);
  remote.options.mockResolvedValue({
    slots: [slot, { ...slot, id: "tue", dayOfWeek: 2 }],
  });
  remote.appeal.mockResolvedValue({});
  remote.feedback.mockResolvedValue({});
  remote.discipline.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  client.clear();
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
it.each([undefined, false, true])(
  "never claims a privacy audience on an unknown/failed read (cached %s)",
  async (cached) => {
    if (cached !== undefined)
      client.setQueryData(key(["student", "feedbackSettings"]), cached);
    remote.settings.mockRejectedValue(new Error("Offline"));
    mount(<StudentPortal view="attendance" />);
    await screen.findByText(en.workflows.attendance);
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
    await screen.findByRole("button", { name: zh.workflow.editAvailability }),
  );
  const choices = await screen.findAllByRole("checkbox");
  fireEvent.click(choices[1]!);
  expect(document.body.textContent).toContain("周一 15:30–16:30");
  remote.mine.mockRejectedValue(new Error("Offline"));
  await refresh(["studentWorkflow", "mine"]);
  await screen.findByText(zh.participantRecovery.refreshFailed);
  expect((choices[1] as HTMLInputElement).checked).toBe(true);
  expect(choices[1]!.isConnected).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: zh.workflow.saveAvailability,
    }).disabled,
  ).toBe(true);
  remote.mine.mockResolvedValue([request]);
  fireEvent.click(
    screen.getByRole("button", { name: zh.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: zh.workflow.saveAvailability,
      }).disabled,
    ).toBe(false),
  );
  expect((choices[1] as HTMLInputElement).checked).toBe(true);
  expect(remote.edit).not.toHaveBeenCalled();
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

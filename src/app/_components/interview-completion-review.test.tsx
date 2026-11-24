// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  InterviewCompletionReview,
  type InterviewRecord,
  type CompletionDraft,
} from "./interview-completion-review";

const state = vi.hoisted(() => ({ save: vi.fn(), pending: false }));
vi.mock("~/trpc/react", () => ({
  api: {
    interviewManagement: {
      complete: {
        useMutation: () => ({
          mutateAsync: state.save,
          isPending: state.pending,
        }),
      },
    },
  },
}));
const record = (patch: Partial<InterviewRecord> = {}) => {
  const application = {
    id: "interview",
    name: "Synthetic Applicant",
    status: "INTERVIEW",
    type: "INITIAL",
    updatedAt: new Date("2026-10-01"),
    interviewCompletedAt: null,
    interviewDurationMin: null,
    pendingDecision: false,
    pendingCompletion: false,
    registration: { state: "pendingDecision", href: null },
    interviewers: ["Alice", "Bob", "Carol"].map((name) => ({
      tutorId: name,
      tutor: { englishName: name },
      attended: false,
      isHead: name === "Alice",
    })),
    ...patch,
  };
  return {
    ...application,
    completionParticipants:
      patch.completionParticipants ??
      application.interviewers.map((person) => ({
        ...person,
        tutor: { ...person.tutor, status: "ACTIVE" },
        creditHours:
          application.interviewCompletedAt && person.attended
            ? (application.interviewDurationMin ?? 0) / 60
            : 0,
        currentPanel: true,
      })),
  } as InterviewRecord;
};
const close = vi.fn();
const refresh = vi.fn();
const reload = vi.fn();
const accessDenied = vi.fn();
const element = (
  application = record(),
  locale = "en",
  initialDraft?: CompletionDraft,
  readAvailable = true,
) => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "zh" ? zh : en}
    timeZone="Asia/Shanghai"
  >
    <InterviewCompletionReview
      application={application}
      initialDraft={initialDraft}
      onClose={close}
      refresh={refresh}
      reload={reload}
      onAccessDenied={accessDenied}
      readAvailable={readAvailable}
    />
  </NextIntlClientProvider>
);
const edit = (minutes = "45") => {
  fireEvent.change(screen.getByLabelText(en.workflows.interviewComplete), {
    target: { value: "2026-10-01T16:00" },
  });
  fireEvent.change(screen.getByLabelText(en.workflows.duration), {
    target: { value: minutes },
  });
  fireEvent.change(screen.getByLabelText(en.interviewReview.reason), {
    target: { value: "Verified actual attendance" },
  });
  for (const name of ["Alice", "Bob", "Carol"])
    fireEvent.click(screen.getByLabelText(name));
};
beforeEach(() => {
  vi.resetAllMocks();
  state.pending = false;
  state.save.mockResolvedValue({ ok: true });
  refresh.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("opening, editing, reviewing and cancelling perform no write and preserve the reviewed draft", () => {
  render(element());
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  expect(screen.getAllByText("0.75 hours")).toHaveLength(3);
  expect(screen.getByText("Total proposed credit: 2.25 hours")).toBeTruthy();
  expect(state.save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: en.interviewReview.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.back }),
  );
  expect(document.activeElement).toBe(
    screen.getByLabelText(en.workflows.interviewComplete),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
  expect(close).toHaveBeenCalledWith(
    expect.objectContaining({
      duration: "45",
      reason: "Verified actual attendance",
      attended: ["Alice", "Bob", "Carol"],
      version: new Date("2026-10-01"),
    }),
  );
});

it("guards duplicate clicks and separates an applied award from failed refresh, whose recovery only reads", async () => {
  refresh.mockRejectedValueOnce(new Error("offline"));
  render(element());
  edit("30");
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  const confirm = screen.getByRole("button", {
    name: en.interviewReview.confirmAward,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(screen.getByText(en.interviewReview.refreshFailed)).toBeTruthy(),
  );
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      durationMin: 30,
      expectedUpdatedAt: new Date("2026-10-01"),
    }),
  );
  expect(screen.getByText(en.interviewReview.awarded)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.interviewReview.refreshFailed)).toBeNull(),
  );
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(state.save).toHaveBeenCalledTimes(1);
});

it("queued approval is not an applied award and a pending write cannot dismiss", async () => {
  let reject!: (error: unknown) => void;
  state.save.mockImplementation(
    () =>
      new Promise((_resolve, failed) => {
        reject = failed;
      }),
  );
  render(element());
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmAward }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.back }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmAward }),
  );
  expect(screen.queryByLabelText(en.interviewReview.reason)).toBeNull();
  expect(state.save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
  expect(close).not.toHaveBeenCalled();
  reject({ data: { approvalId: "review" } });
  await waitFor(() =>
    expect(screen.getByText(en.approvals.queuedBody)).toBeTruthy(),
  );
  expect(screen.queryByText(en.interviewReview.awarded)).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.interviewReview.confirmAward }),
  ).toBeNull();
});

it("retains refresh-only recovery after closing and reopening a saved result", async () => {
  refresh.mockRejectedValueOnce(new Error("offline"));
  render(element());
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmAward }),
  );
  await waitFor(() =>
    expect(screen.getByText(en.interviewReview.refreshFailed)).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: en.common.close }));
  const saved = close.mock.calls[0]![0] as CompletionDraft;
  expect(saved.outcome).toBe("applied");
  cleanup();
  render(element(record(), "en", saved));
  expect(
    screen.queryByRole("button", { name: en.interviewReview.confirmAward }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.interviewReview.refreshFailed)).toBeNull(),
  );
  expect(state.save).toHaveBeenCalledTimes(1);
});

it("a cancelled draft retains its original panel evidence after background panel replacement", () => {
  render(element());
  edit();
  fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
  const saved = close.mock.calls[0]![0] as CompletionDraft;
  cleanup();
  render(
    element(
      record({
        interviewers: [
          {
            tutorId: "new",
            tutor: { englishName: "New Panelist" },
            attended: false,
            isHead: true,
          },
        ],
        updatedAt: new Date("2026-10-04"),
      }),
      "en",
      saved,
    ),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Alice").checked).toBe(true);
  expect(screen.queryByLabelText("New Panelist")).toBeNull();
  expect(saved.version).toEqual(new Date("2026-10-01"));
});

it("retains failed draft/version on background refresh and replaces it only after explicit successful reload", async () => {
  state.save.mockRejectedValueOnce(new Error("Evidence changed"));
  const view = render(element());
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmAward }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Evidence changed"),
  );
  view.rerender(element(record({ updatedAt: new Date("2026-10-02") })));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.back }),
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.interviewReview.reason).value,
  ).toBe("Verified actual attendance");
  reload.mockResolvedValue(
    record({ updatedAt: new Date("2026-10-03"), interviewDurationMin: 30 }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.reloadEvidence }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(en.interviewReview.reason)
        .value,
    ).toBe(""),
  );
});

it("previews correction deltas including removed attendees and keeps registration status separate", () => {
  const application = record({
    status: "REJECTED",
    interviewCompletedAt: new Date("2026-10-01"),
    interviewDurationMin: 30,
    interviewers: record().interviewers.map((p) => ({ ...p, attended: true })),
    registration: { state: "notEligible", href: null },
  });
  render(element(application));
  fireEvent.change(screen.getByLabelText(en.workflows.duration), {
    target: { value: "45" },
  });
  fireEvent.change(screen.getByLabelText(en.interviewReview.reason), {
    target: { value: "Correction evidence" },
  });
  fireEvent.click(screen.getByLabelText("Bob"));
  fireEvent.click(screen.getByLabelText("Carol"));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  expect(screen.getByText("0.5 → 0.75 hours (change 0.25)")).toBeTruthy();
  expect(screen.getAllByText("0.5 → 0 hours (change -0.5)")).toHaveLength(2);
  expect(screen.getByText(en.interviewReview.replacement)).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(
    screen.getByText(en.interviewReview.registration.notEligible),
  ).toBeTruthy();
});

it("uses Chinese copy and keyboard Escape returns cancellation without saving", () => {
  render(element(record(), "zh"));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(zh.interviewReview.evidence)).toBeTruthy();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(close).toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

it("blocks the account setup popup through both a deferred write and deferred refresh", async () => {
  let finishWrite!: (result: unknown) => void;
  let finishRefresh!: () => void;
  state.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      }),
  );
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  const href = "/admin/registration-codes#registration-code-authorized";
  render(
    element(
      record({
        status: "ACCEPTED",
        registration: { state: "codeActive", href },
      }),
    ),
  );
  expect(
    screen
      .getByRole("button", { name: en.interviewReview.registrationAction })
      .hasAttribute("disabled"),
  ).toBe(false);
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmAward }),
  );
  const pendingLink = screen.getByRole("button", {
    name: en.interviewReview.registrationAction,
  });
  expect(pendingLink.hasAttribute("disabled")).toBe(true);
  fireEvent.click(pendingLink);
  finishWrite({ ok: true });
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(
    screen
      .getByRole("button", { name: en.interviewReview.registrationAction })
      .hasAttribute("disabled"),
  ).toBe(true);
  finishRefresh();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: en.interviewReview.registrationAction })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(state.save).toHaveBeenCalledTimes(1);
});

it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "bubbles %s from saves and explicit evidence reloads to conceal the private host",
  async (code) => {
    state.save.mockRejectedValueOnce(
      Object.assign(new Error("Access revoked"), { data: { code } }),
    );
    render(element());
    edit();
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.review }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.confirmAward }),
    );
    await waitFor(() => expect(accessDenied).toHaveBeenCalledTimes(1));
    cleanup();
    accessDenied.mockClear();
    state.save.mockRejectedValueOnce(new Error("Evidence changed"));
    reload.mockRejectedValueOnce(
      Object.assign(new Error("Read access revoked"), { data: { code } }),
    );
    render(element());
    edit();
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.review }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.confirmAward }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.interviewReview.reloadEvidence }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.reloadEvidence }),
    );
    await waitFor(() => expect(accessDenied).toHaveBeenCalledTimes(1));
  },
);

const historicalRecord = () =>
  record({
    type: "ADDITIONAL_SUBJECT",
    interviewCompletedAt: new Date("2026-10-01T08:00:37.456Z"),
    interviewDurationMin: 30,
    interviewers: ["New Chair", "New Voter", "New Panelist"].map((name) => ({
      tutorId: name,
      tutor: { englishName: name },
      attended: false,
      isHead: name === "New Chair",
    })),
    completionParticipants: [
      {
        tutorId: "former-a",
        tutor: { englishName: "Former Alice", status: "GRADUATED" },
        attended: true,
        creditHours: 0.5,
        currentPanel: false,
      },
      {
        tutorId: "former-b",
        tutor: { englishName: "Former Bob", status: "OPTED_OUT" },
        attended: true,
        creditHours: 0.25,
        currentPanel: false,
      },
      {
        tutorId: "former-c",
        tutor: { englishName: "Former Carol", status: "ARCHIVED" },
        attended: false,
        creditHours: 0,
        currentPanel: false,
      },
    ],
  });

it.each(["en", "zh"] as const)(
  "reviews real ledger deltas for inactive former participants while every current voter differs (%s)",
  async (locale) => {
    const messages = locale === "en" ? en : zh;
    render(element(historicalRecord(), locale));
    expect(screen.getByText(messages.admin.tutorStatus.GRADUATED)).toBeTruthy();
    expect(screen.getByText(messages.admin.tutorStatus.OPTED_OUT)).toBeTruthy();
    expect(screen.getByText(messages.admin.tutorStatus.ARCHIVED)).toBeTruthy();
    expect(screen.queryByLabelText("New Chair")).toBeNull();
    expect(screen.getByText(/New Chair, New Voter, New Panelist/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(messages.workflows.duration), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByLabelText(messages.interviewReview.reason), {
      target: { value: "Reviewed original attendance evidence" },
    });
    fireEvent.click(screen.getByLabelText("Former Alice"));
    fireEvent.click(screen.getByLabelText("Former Carol"));
    fireEvent.click(
      screen.getByRole("button", { name: messages.interviewReview.review }),
    );
    const changes = messages.interviewReview.change;
    const expected = (before: string, after: string, delta: string) =>
      changes
        .replace("{before}", before)
        .replace("{after}", after)
        .replace("{delta}", delta);
    expect(screen.getByText(expected("0.5", "0", "-0.5"))).toBeTruthy();
    expect(screen.getByText(expected("0.25", "1", "0.75"))).toBeTruthy();
    expect(screen.getByText(expected("0", "1", "1"))).toBeTruthy();
    // Source credit hours, rather than old duration × attendance flags, own the
    // before values and total even when the supplied source amounts differ.
    const total = messages.interviewReview.correctionEvidence.totalChange
      .replace("{before}", "0.75")
      .replace("{after}", "2")
      .replace("{delta}", "1.25");
    expect(screen.getByText(total)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.interviewReview.confirmCorrection,
      }),
    );
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(state.save).toHaveBeenCalledWith({
      applicationId: "interview",
      durationMin: 60,
      completedAt: new Date("2026-10-01T08:00:37.456Z"),
      attendedTutorIds: ["former-b", "former-c"],
      reason: "Reviewed original attendance evidence",
      expectedUpdatedAt: new Date("2026-10-01"),
    });
  },
);

it("never reconstructs missing completed-service evidence from the current voting panel", () => {
  const application = historicalRecord();
  delete application.completionParticipants;
  render(element(application));
  expect(
    screen.getByText(en.interviewReview.correctionEvidence.missingEvidence),
  ).toBeTruthy();
  expect(screen.queryByLabelText("New Chair")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.interviewReview.review,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(document.getElementById("interview-completion-editor")!);
  expect(
    screen.queryByRole("button", {
      name: en.interviewReview.confirmCorrection,
    }),
  ).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});

it("blocks review and a retained confirmation while the owning read fails, then retries reads without losing edits", async () => {
  const application = historicalRecord();
  const view = render(element(application, "en", undefined, false));
  fireEvent.change(screen.getByLabelText(en.interviewReview.reason), {
    target: { value: "Retained historical correction" },
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.interviewReview.review,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(document.getElementById("interview-completion-editor")!);
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  view.rerender(element(application, "en", undefined, true));
  expect(
    screen.getByDisplayValue("Retained historical correction"),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  view.rerender(element(application, "en", undefined, false));
  const confirm = screen.getByRole<HTMLButtonElement>("button", {
    name: en.interviewReview.confirmCorrection,
  });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(state.save).not.toHaveBeenCalled();
  view.rerender(element(application, "en", undefined, true));
  fireEvent.click(confirm);
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
});

it("retains former-participant evidence and version after a rejected correction and a background replacement", async () => {
  state.save.mockRejectedValueOnce(new Error("Historical evidence changed"));
  const application = historicalRecord();
  const view = render(element(application));
  fireEvent.change(screen.getByLabelText(en.interviewReview.reason), {
    target: { value: "Retain historical review draft" },
  });
  fireEvent.click(screen.getByLabelText("Former Alice"));
  fireEvent.click(screen.getByLabelText("Former Carol"));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmCorrection }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Historical evidence changed",
    ),
  );
  view.rerender(element(record({ updatedAt: new Date("2026-10-05") })));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.back }),
  );
  expect(
    screen.getByDisplayValue("Retain historical review draft"),
  ).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Former Bob").checked).toBe(
    true,
  );
  expect(screen.getByLabelText<HTMLInputElement>("Former Carol").checked).toBe(
    true,
  );
  expect(screen.queryByLabelText("Alice")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmCorrection }),
  );
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedUpdatedAt: new Date("2026-10-01"),
      attendedTutorIds: ["former-b", "former-c"],
    }),
  );
});

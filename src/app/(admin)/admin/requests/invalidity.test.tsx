// @vitest-environment jsdom
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
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import zh from "../../../../../messages/zh.json";
import en from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { StudentRequestBoard } from "./student-request-board";
import RequestsPage from "./page";
import type { RequestEmailOwner } from "./request-email-status";

const mocks = vi.hoisted(() => ({
  survey: true,
  invalid: true,
  source: "SELF_SERVICE",
  assigned: false,
  verified: true,
  edited: false,
  legacyEmail: null as string | null,
  legacyUser: null as RequestEmailOwner | null,
  legacyOwner: null as RequestEmailOwner | null,
  unnamed: false,
  username: null as string | null,
  periodLoading: false,
  role: "HEAD",
  state: "OPEN",
  currentVersion: 2,
  extraSubjects: [] as { id: string; name: string }[],
  pairings: null as
    | {
        id: string;
        subject: string;
        tutor: { englishName: string; user?: { username: string | null } };
      }[]
    | null,
  invalidateRequests: vi.fn(),
  invalidateTutees: vi.fn(),
  invalidatePairings: vi.fn(),
  unassign: vi.fn(),
  assign: vi.fn(),
  assignError: null as Error | null,
  assignmentConfirm: null as ((overrideTicket?: string) => unknown) | null,
  fetchRequests: vi.fn(),
  fetchTutees: vi.fn(),
  changeSurvey: vi.fn(),
  changeSignup: vi.fn(),
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: () => null,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/app/_components/timed-action-dialog", () => ({
  // Keep review ownership and callbacks real; timing/native modality have their
  // own suites. A stable node reveals accidental card-child remounts on refresh.
  TimedActionDialog: ({
    target,
    title,
    busy,
    error,
    onConfirm,
    onCancel,
  }: {
    target: string;
    title: string;
    busy?: boolean;
    error?: string;
    onConfirm: (ticket: string) => unknown;
    onCancel: () => void;
  }) => (
    <div role="dialog" aria-label={title} data-target={target} aria-busy={busy}>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={() =>
          void Promise.resolve(onConfirm("release-ticket")).catch(
            () => undefined,
          )
        }
      >
        Confirm release
      </button>
      <button disabled={busy} onClick={onCancel}>
        Cancel release
      </button>
    </div>
  ),
}));
vi.mock("~/app/_components/qualified-tutor-select", () => ({
  // Preserve caller-owned companions so these page tests exercise their placement.
  QualifiedTutorSelect: ({
    label,
    leading,
    actions,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    leading?: ReactNode;
    actions?: ReactNode;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      {leading}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose</option>
        <option value="chosen-tutor">Chosen Tutor</option>
      </select>
      {actions}
    </div>
  ),
}));
vi.mock("~/app/_components/assignment-workload", () => ({
  // Exercise the feature-owned write lifecycle; native modality, qualification
  // preparation and automatic admission are covered by their component suites.
  WorkloadAssignmentConfirmation: ({
    payload,
    busy,
    error,
    onConfirm,
    onCancel,
  }: {
    payload: unknown;
    busy: boolean;
    error?: string;
    onConfirm: (overrideTicket?: string) => unknown;
    onCancel: () => void;
  }) => {
    mocks.assignmentConfirm = onConfirm;
    return (
      <div
        role="dialog"
        aria-label="Assignment consequences"
        aria-busy={busy}
        data-payload={JSON.stringify(payload)}
      >
        {error && <p role="alert">{error}</p>}
        <button
          disabled={busy}
          onClick={() =>
            void Promise.resolve(onConfirm("qualification-ticket")).catch(
              () => undefined,
            )
          }
        >
          Confirm assignment
        </button>
        <button disabled={busy} onClick={onCancel}>
          Cancel assignment
        </button>
      </div>
    );
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    notification: {
      requestEmailStatus: {
        useQuery: () => ({
          data: null,
          isSuccess: true,
          isFetching: false,
          refetch: async () => ({ data: null, error: null }),
        }),
      },
      retryRequestEmail: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      declineRequestAppeal: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({
      studentWorkflow: {
        adminRequests: {
          invalidate: mocks.invalidateRequests,
          fetch: mocks.fetchRequests,
        },
      },
      admin: {
        pairings: { invalidate: mocks.invalidatePairings },
        tutees: {
          invalidate: mocks.invalidateTutees,
          fetch: mocks.fetchTutees,
        },
      },
    }),
    account: { me: { useQuery: () => ({ data: { role: mocks.role } }) } },
    studentWorkflow: {
      headUnassign: { useMutation: () => ({ mutateAsync: mocks.unassign }) },
      resolveSignupAppeal: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      adminRequests: {
        useQuery: () => ({
          data: mocks.survey
            ? [
                {
                  id: "survey-1",
                  name: mocks.unnamed ? "" : "Public survey student",
                  username: mocks.username,
                  email: "student@example.test",
                  contact: "Email",
                  state: mocks.state,
                  currentVersion: mocks.currentVersion,
                  confirmedAt: mocks.verified ? new Date("2026-10-01") : null,
                  submittedAt: new Date("2026-10-01"),
                  editedAt: mocks.edited ? new Date("2026-10-20") : null,
                  verificationDueAt: null,
                  subjects: [
                    { id: "math", name: "Mathematics" },
                    ...mocks.extraSubjects,
                  ],
                  slots: [],
                  reviews: [],
                  pairings:
                    mocks.pairings ??
                    (mocks.assigned
                      ? [
                          {
                            id: "existing-math-pairing",
                            subject: "Mathematics",
                            tutor: { englishName: "Existing Tutor" },
                          },
                        ]
                      : []),
                  isInvalid: mocks.invalid,
                  invalidReason: mocks.invalid ? "Private staff reason" : null,
                  invalidatedAt: mocks.invalid ? new Date("2026-10-10") : null,
                  invalidatedByName: mocks.invalid ? "Staff Reviewer" : null,
                  invalidityVersion: mocks.invalid ? 1 : 0,
                },
              ]
            : [],
        }),
      },
      legacyReviews: { useQuery: () => ({ data: [] }) },
      resend: { useMutation: () => ({ mutate: vi.fn() }) },
      assign: {
        useMutation: () => ({
          mutateAsync: mocks.assign,
          error: mocks.assignError,
        }),
      },
      setRequestInvalidity: {
        useMutation: () => ({ mutateAsync: mocks.changeSurvey }),
      },
    },
    admin: {
      tutors: {
        useQuery: () => ({
          data: [
            {
              id: "chosen-tutor",
              englishName: "Chosen Tutor",
              status: "ACTIVE",
            },
          ],
        }),
      },
      currentPeriod: {
        useQuery: () => ({
          data: mocks.periodLoading ? undefined : { termId: "term-1" },
          isLoading: mocks.periodLoading,
        }),
      },
      pairings: {
        useQuery: () => ({
          data: mocks.assigned
            ? [
                {
                  id: "legacy-pairing",
                  subject: "Mathematics",
                  tutorId: "existing-tutor",
                  tutor: { englishName: "Existing Tutor" },
                  tutees: [{ tutee: { id: "legacy-1" } }],
                },
              ]
            : [],
        }),
      },
      tutees: {
        useQuery: () => ({
          data: [
            {
              id: "legacy-1",
              status: "PENDING",
              intakeTermId: "term-1",
              englishName: mocks.unnamed ? "" : "Legacy public student",
              user:
                mocks.username || mocks.legacyUser
                  ? { username: mocks.username, ...mocks.legacyUser }
                  : null,
              owner: mocks.legacyOwner,
              signupSource: mocks.source,
              signupSubmittedAt: new Date("2026-10-01"),
              createdAt: new Date("2026-10-01"),
              updatedAt: new Date("2026-10-01"),
              isInvalid: mocks.invalid,
              invalidReason: mocks.invalid ? "Private staff reason" : null,
              invalidatedAt: mocks.invalid ? new Date("2026-10-10") : null,
              invalidatedByName: mocks.invalid ? "Staff Reviewer" : null,
              invalidityVersion: mocks.invalid ? 1 : 0,
              gradeLevel: null,
              email: mocks.legacyEmail,
              phone: null,
              preferredContact: null,
              signedRulebook: false,
              // The real roster read has no `unverified` flag; its absence is not proof.
              signatureName: null,
              firstChoice: { id: "math", name: "Mathematics" },
              secondChoice: null,
              availabilities: [],
              bannedMatch: null,
            },
          ],
        }),
      },
      assignSignup: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteTutee: { useMutation: () => ({ mutate: vi.fn() }) },
      setSignupInvalidity: {
        useMutation: () => ({ mutateAsync: mocks.changeSignup }),
      },
    },
  },
}));
const content = (
  legacy = false,
  viewer = false,
  locale: "en" | "zh" = "en",
) => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "zh" ? zh : en}
    timeZone="Asia/Shanghai"
  >
    <ReadOnlyProvider value={viewer}>
      {legacy ? <RequestsPage /> : <StudentRequestBoard />}
    </ReadOnlyProvider>
  </NextIntlClientProvider>
);
const show = (legacy = false, viewer = false) => {
  const view = render(content(legacy, viewer));
  if (mocks.invalid)
    fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  return view;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.survey = true;
  mocks.invalid = true;
  mocks.source = "SELF_SERVICE";
  mocks.assigned = false;
  mocks.verified = true;
  mocks.edited = false;
  mocks.legacyEmail = null;
  mocks.legacyUser = null;
  mocks.legacyOwner = null;
  mocks.unnamed = false;
  mocks.username = null;
  mocks.periodLoading = false;
  mocks.role = "HEAD";
  mocks.state = "OPEN";
  mocks.currentVersion = 2;
  mocks.extraSubjects = [];
  mocks.pairings = null;
  mocks.assignError = null;
  mocks.assignmentConfirm = null;
  mocks.assign.mockResolvedValue({ ok: true, emailSent: true });
  mocks.invalidateRequests.mockResolvedValue(undefined);
  mocks.invalidateTutees.mockResolvedValue(undefined);
  mocks.invalidatePairings.mockResolvedValue(undefined);
  mocks.unassign.mockResolvedValue({ ok: true, version: 3 });
  mocks.changeSurvey.mockResolvedValue({ ok: true });
  mocks.changeSignup.mockResolvedValue({ ok: true });
  const fresh = (id: string) => [
    {
      id,
      isInvalid: mocks.invalid,
      invalidReason: mocks.invalid ? "Private staff reason" : null,
      invalidatedAt: mocks.invalid ? new Date("2026-10-10") : null,
      invalidatedByName: mocks.invalid ? "Staff Reviewer" : null,
      invalidityVersion: 2,
    },
  ];
  mocks.fetchRequests.mockImplementation(async () => fresh("survey-1"));
  mocks.fetchTutees.mockImplementation(async () => fresh("legacy-1"));
});
afterEach(cleanup);

it.each([
  { locale: "en" as const, label: "Edited", viewer: false },
  { locale: "zh" as const, label: "已修改", viewer: false },
  { locale: "en" as const, label: "Edited", viewer: true },
  { locale: "zh" as const, label: "已修改", viewer: true },
])(
  "keeps the edited badge unbracketed for $locale viewer=$viewer",
  ({ locale, label, viewer }) => {
    mocks.invalid = false;
    const view = render(content(false, viewer, locale));
    expect(screen.queryByText(label)).toBeNull();

    mocks.edited = true;
    view.rerender(content(false, viewer, locale));
    expect(screen.getByText(label).classList.contains("badge-amber")).toBe(
      true,
    );
    expect(screen.queryByText(`[${label}]`)).toBeNull();

    mocks.edited = false;
    view.rerender(content(false, viewer, locale));
    expect(screen.queryByText(label)).toBeNull();
  },
);

it.each([false, true])(
  "renders current unnamed requests with a handle or localized fallback (legacy=%s), preserving original labels when supplied",
  (legacy) => {
    mocks.survey = !legacy;
    mocks.invalid = false;
    mocks.unnamed = true;
    mocks.username = "learner-handle";
    const page = render(content(legacy));
    expect(screen.getByText("learner-handle")).toBeTruthy();
    mocks.username = null;
    page.rerender(content(legacy));
    expect(screen.getByText(en.participantNames.unnamed)).toBeTruthy();
    page.rerender(content(legacy, false, "zh"));
    expect(screen.getByText(zh.participantNames.unnamed)).toBeTruthy();
    mocks.unnamed = false;
    page.rerender(content(legacy));
    expect(
      screen.getByText(
        legacy ? /Legacy public student/ : "Public survey student",
      ),
    ).toBeTruthy();
    expect(mocks.changeSurvey).not.toHaveBeenCalled();
    expect(mocks.changeSignup).not.toHaveBeenCalled();
  },
);

it.each(
  [false, true].flatMap((verified) =>
    [false, true].flatMap((viewer) =>
      (["en", "zh"] as const).map((locale) => ({
        verified,
        viewer,
        locale,
      })),
    ),
  ),
)(
  "shows the submission email badge for verified=$verified viewer=$viewer locale=$locale",
  ({ verified, viewer, locale }) => {
    mocks.invalid = false;
    mocks.verified = verified;
    const messages = locale === "zh" ? zh : en;
    const view = render(content(false, viewer, locale));
    const badge = screen.getByText(
      messages.workflow[verified ? "verified" : "emailPending"],
    );
    expect(
      badge.classList.contains(verified ? "badge-green" : "badge-amber"),
    ).toBe(true);
    expect(badge.parentElement?.textContent).toContain("Public survey student");
    expect(
      screen.queryByText(
        messages.workflow[verified ? "emailPending" : "verified"],
      ),
    ).toBeNull();

    // A refreshed proof replaces the badge without leaving stale pending status.
    mocks.verified = !verified;
    view.rerender(content(false, viewer, locale));
    expect(
      screen.queryByText(
        messages.workflow[verified ? "verified" : "emailPending"],
      ),
    ).toBeNull();
    expect(
      screen.getByText(
        messages.workflow[verified ? "emailPending" : "verified"],
      ),
    ).toBeTruthy();
  },
);

it.each(
  (["en", "zh"] as const).flatMap((locale) =>
    (
      [
        "unknown",
        "verified",
        "unverified",
        "different-address",
        "missing-metadata",
      ] as const
    ).map((evidence) => ({ locale, evidence })),
  ),
)(
  "uses actual legacy email evidence in $locale ($evidence)",
  ({ locale, evidence }) => {
    mocks.survey = false;
    mocks.invalid = false;
    mocks.legacyEmail = "learner@example.test";
    if (evidence !== "unknown") {
      mocks.legacyUser = {
        email:
          evidence === "different-address"
            ? "other@example.test"
            : "learner@example.test",
        ...(evidence === "missing-metadata"
          ? {}
          : {
              emailVerifiedAt:
                evidence === "unverified" ? null : new Date("2026-10-01"),
            }),
      };
    }
    const messages = locale === "zh" ? zh : en;
    const status =
      evidence === "verified"
        ? messages.admin.requests.emailVerifiedShort
        : evidence === "unverified"
          ? messages.admin.requests.emailUnverifiedShort
          : messages.admin.requests.emailUnknownShort;
    render(content(true, false, locale));
    expect(
      screen.getByText(
        messages.workflow.emailStatus.replace("{status}", status),
      ),
    ).toBeTruthy();
    // Contact uncertainty must not alter the existing manual-intake assignment rules.
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    expect(screen.queryByText(messages.workflow.verified)).toBeNull();
  },
);

it("uses retained ownership only without a current user and refreshes contact evidence", () => {
  mocks.survey = false;
  mocks.invalid = false;
  mocks.legacyEmail = "learner@example.test";
  mocks.legacyOwner = {
    email: "LEARNER@example.test",
    emailVerifiedAt: new Date("2026-10-01"),
  };
  const view = render(content(true));
  expect(screen.getByText("Email: Verified")).toBeTruthy();
  mocks.legacyUser = {
    email: "different@example.test",
    emailVerifiedAt: new Date("2026-10-01"),
  };
  view.rerender(content(true));
  expect(screen.getByText("Email: Verification not recorded")).toBeTruthy();
  expect(screen.queryByText("Email: Verified")).toBeNull();
  mocks.legacyUser = { email: "learner@example.test", emailVerifiedAt: null };
  view.rerender(content(true));
  expect(screen.getByText("Email: Unverified")).toBeTruthy();
  mocks.legacyUser.emailVerifiedAt = new Date("2026-10-02");
  view.rerender(content(true));
  expect(screen.getByText("Email: Verified")).toBeTruthy();
});

it.each([null, "", "   "])(
  "does not label a missing legacy email as verified (%s)",
  (email) => {
    mocks.survey = false;
    mocks.invalid = false;
    mocks.legacyEmail = email;
    mocks.legacyUser = {
      email: "learner@example.test",
      emailVerifiedAt: new Date("2026-10-01"),
    };
    render(content(true));
    expect(screen.queryByText(/^Email:/)).toBeNull();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  },
);

it("does not compare masked owner/contact addresses for read-only observers", () => {
  mocks.survey = false;
  mocks.invalid = false;
  mocks.legacyEmail = "Private";
  mocks.legacyUser = {
    email: "Private",
    emailVerifiedAt: new Date("2026-10-01"),
  };
  render(content(true, true));
  expect(screen.queryByText(/^Email:/)).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it.each([true, false])(
  "preserves independent invalid and closed request badges (verified=%s)",
  (verified) => {
    mocks.verified = verified;
    mocks.state = "INVALID_REJECTED";
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Processed/ }));
    expect(
      screen.getByText(en.workflow[verified ? "verified" : "emailPending"]),
    ).toBeTruthy();
    expect(screen.getByText("Invalid entry")).toBeTruthy();
    expect(screen.getByText(en.signupAppeal.rejectedTitle)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: en.workflow.resend }),
    ).toBeNull();
  },
);

it("keeps a flagged public request visible in its original queue without assignment controls or inline private reason", () => {
  show();
  expect(screen.getByText("Public survey student")).toBeTruthy();
  expect(screen.getByText("Invalid entry")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Review invalid flag" }),
  ).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByText("Private staff reason")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Active entries" }));
  expect(screen.queryByText("Public survey student")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  expect(screen.getByText("Public survey student")).toBeTruthy();
});

it("retains prior assignment evidence for an invalid request", () => {
  mocks.assigned = true;
  show();
  fireEvent.click(screen.getByRole("tab", { name: /Assigned.*1/ }));
  expect(screen.getByText("Existing Tutor")).toBeTruthy();
  expect(screen.getByText("Invalid entry")).toBeTruthy();
});

it("allows matching an unflagged request and excludes it from the invalid filter", () => {
  mocks.invalid = false;
  show();
  expect(screen.getByRole("combobox")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  expect(screen.queryByText("Public survey student")).toBeNull();
});

it("includes legacy public signups in the invalid filter and blocks further assignment", () => {
  mocks.survey = false;
  show(true);
  fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  expect(screen.getByText(/Legacy public student/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Review invalid flag" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.admin.requests.decline }),
  ).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("does not offer invalid flags for staff-created intake rows", () => {
  mocks.survey = false;
  mocks.invalid = false;
  mocks.source = "STAFF";
  show(true);
  expect(screen.queryByRole("button", { name: "Flag invalid" })).toBeNull();
});

it("keeps the viewer's legacy summary free of private flag actions and reasons", () => {
  mocks.survey = false;
  show(true, true);
  expect(screen.getByText("Invalid entry")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Review invalid flag" }),
  ).toBeNull();
  expect(screen.queryByText("Private staff reason")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it.each([
  { legacy: false, change: "validity" },
  { legacy: false, change: "group" },
  { legacy: true, change: "validity" },
  { legacy: true, change: "group" },
])(
  "retains the $legacy legacy request draft when background $change moves its card",
  async ({ legacy, change }) => {
    mocks.survey = !legacy;
    mocks.invalid = false;
    const name = legacy ? "Legacy public student" : "Public survey student";
    const mutation = legacy ? mocks.changeSignup : mocks.changeSurvey;
    const view = show(legacy);
    fireEvent.click(screen.getByRole("button", { name: "Active entries" }));
    fireEvent.click(screen.getByRole("button", { name: "Flag invalid" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox"), {
      target: { value: "My pending signup review" },
    });
    if (change === "validity") mocks.invalid = true;
    else mocks.assigned = true;
    view.rerender(content(legacy));
    expect(
      within(screen.getByRole("tabpanel")).queryByText(new RegExp(name)),
    ).toBeNull();
    const dialog = screen.getByRole("dialog", {
      name: `Flag ${name} as Invalid?`,
    });
    expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "My pending signup review",
    );
    mutation.mockRejectedValueOnce(new Error("Signup changed"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Flag invalid" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Signup changed")).toBeTruthy(),
    );
    expect(mutation).toHaveBeenCalledExactlyOnceWith({
      id: legacy ? "legacy-1" : "survey-1",
      invalid: true,
      reason: "My pending signup review",
      expectedInvalidityVersion: 0,
    });
    expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "My pending signup review",
    );
  },
);

it.each([
  { legacy: false, clearing: false },
  { legacy: false, clearing: true },
  { legacy: true, clearing: false },
  { legacy: true, clearing: true },
])(
  "retains read-only refresh recovery outside a filtered signup card (legacy=$legacy, clearing=$clearing)",
  async ({ legacy, clearing }) => {
    mocks.survey = !legacy;
    mocks.invalid = clearing;
    const name = legacy ? "Legacy public student" : "Public survey student";
    const mutation = legacy ? mocks.changeSignup : mocks.changeSurvey;
    const primary = legacy ? mocks.invalidateTutees : mocks.invalidateRequests;
    const sibling = legacy ? mocks.invalidateRequests : mocks.invalidateTutees;
    const fetch = legacy ? mocks.fetchTutees : mocks.fetchRequests;
    const view = show(legacy);
    fireEvent.click(
      screen.getByRole("button", {
        name: clearing ? "Invalid entries" : "Active entries",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: clearing ? "Review invalid flag" : "Flag invalid",
      }),
    );
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox"), {
      target: { value: "Reviewed signup evidence" },
    });
    let rejectSibling!: (error: Error) => void;
    const held = new Promise<void>((_resolve, reject) => {
      rejectSibling = reject;
    });
    sibling.mockImplementationOnce(() => held);
    // The canonical list succeeds and drops this row before the other reader
    // fails. Recovery must survive both the card's removal and closing the dialog.
    primary.mockImplementation(async () => {
      mocks.invalid = !clearing;
      view.rerender(content(legacy));
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: clearing ? "Clear invalid flag" : "Flag invalid",
      }),
    );
    await waitFor(() => expect(primary).toHaveBeenCalledOnce());
    expect(
      within(screen.getByRole("tabpanel")).queryByText(new RegExp(name)),
    ).toBeNull();
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      rejectSibling(new Error("Related signup refresh failed"));
    });
    await waitFor(() =>
      expect(screen.getByText(en.requestInvalidity.refreshFailed)).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", {
        name: clearing ? "Clear invalid flag" : "Flag invalid",
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const recovery = screen.getByRole("region", { name });
    expect(
      within(recovery).getByText("Related signup refresh failed"),
    ).toBeTruthy();
    fireEvent.click(
      within(recovery).getByRole("button", { name: "Retry refresh" }),
    );
    await waitFor(() =>
      expect(screen.getByText(en.requestInvalidity.saved)).toBeTruthy(),
    );
    expect(screen.queryByText(en.requestInvalidity.refreshFailed)).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledExactlyOnceWith({
      id: legacy ? "legacy-1" : "survey-1",
      invalid: !clearing,
      reason: "Reviewed signup evidence",
      expectedInvalidityVersion: clearing ? 1 : 0,
    });
  },
);

it.each(["en", "zh"] as const)(
  "keeps the %s legacy disclosure explicit and independent from invalidity",
  (locale) => {
    render(content(true, true, locale));
    const messages = locale === "zh" ? zh : en;
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.requestInvalidity.filter.invalid,
      }),
    );
    const control = screen.getByRole<HTMLButtonElement>("button", {
      name: messages.admin.requests.collapse,
    });
    control.focus();
    expect(control.type).toBe("button");
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(control.className).toContain("control-compact");
    const ids = control.getAttribute("aria-controls")!.split(" ");
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => !!document.getElementById(id))).toBe(true);
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("aria-label")).toBe(
      messages.admin.requests.expand,
    );
    expect(document.activeElement).toBe(control);
    expect(screen.getByText("Legacy public student")).toBeTruthy();
    expect(screen.queryByText("Private staff reason")).toBeNull();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(control.getAttribute("aria-label")).toBe(
      messages.admin.requests.collapse,
    );
    expect(mocks.changeSignup).not.toHaveBeenCalled();
  },
);
it("starts fulfilled legacy requests collapsed and auto-collapses after fulfillment", () => {
  mocks.invalid = false;
  const view = render(content(true, true));
  const control = screen.getByRole("button", {
    name: en.admin.requests.collapse,
  });
  mocks.assigned = true;
  view.rerender(content(true, true));
  expect(control.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(control);
  expect(control.getAttribute("aria-expanded")).toBe("true");
  cleanup();
  render(content(true, true));
  expect(
    screen
      .getByRole("button", { name: en.admin.requests.expand })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("lets an observer choose the static invalidity filter while its period read loads", () => {
  mocks.periodLoading = true;
  render(content(true, true));
  const invalid = screen.getByRole("button", {
    name: en.requestInvalidity.filter.invalid,
  });
  fireEvent.click(invalid);
  expect(invalid.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByText("Legacy public student")).toBeNull();
  expect(mocks.changeSignup).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)(
  "keeps the %s verification and edit actions in one ordered request header",
  (locale) => {
    mocks.invalid = false;
    mocks.verified = false;
    render(content(false, false, locale));
    const messages = locale === "zh" ? zh : en;
    const card = screen
      .getByRole("heading", { name: "Public survey student" })
      .closest("article")!;
    const header = card.querySelector("header")!;
    expect(
      within(header)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      messages.requestInvalidity.flag,
      messages.workflow.resend,
      messages.signupEditing.edit,
    ]);
    expect(
      within(card).getAllByRole("button", {
        name: messages.signupEditing.edit,
      }),
    ).toHaveLength(1);
    expect(within(header).queryByRole("combobox")).toBeNull();
  },
);

it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "keeps every assignment with its subject and tutor, including duplicate and removed choices (%s)",
  (role) => {
    mocks.invalid = false;
    mocks.role = role;
    mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
    mocks.pairings = [
      {
        id: "math-a",
        subject: "Mathematics",
        tutor: { englishName: "First Tutor" },
      },
      {
        id: "math-b",
        subject: "Mathematics",
        tutor: { englishName: "", user: { username: "second.tutor" } },
      },
      {
        id: "history-c",
        subject: "History",
        tutor: { englishName: "History Tutor" },
      },
    ];
    render(content());
    const action =
      role === "HEAD" || role === "ADMIN"
        ? en.signupAppeal.unassign
        : en.signupAppeal.proposeUnassign;
    const mathRows = screen.getAllByRole("group", {
      name: "Mathematics",
    });
    expect(mathRows).toHaveLength(2);
    for (const [index, tutor] of ["First Tutor", "second.tutor"].entries()) {
      expect(within(mathRows[index]!).getByText(tutor)).toBeTruthy();
      expect(
        within(mathRows[index]!).getAllByRole("button", {
          name: action,
        }),
      ).toHaveLength(1);
      expect(within(mathRows[index]!).queryByRole("button", {
        name: role === "COORDINATOR" ? en.signupAppeal.unassign : en.signupAppeal.proposeUnassign,
      })).toBeNull();
      expect(mathRows[index]!.children[0]?.textContent).toBe("Mathematics");
    }
    const historicalChoice = screen.getByRole("group", {
      name: "History",
    });
    expect(within(historicalChoice).getByText("History Tutor")).toBeTruthy();
    expect(
      within(historicalChoice).getByRole("button", {
        name: action,
      }),
    ).toBeTruthy();
    expect(historicalChoice.children[0]?.textContent).toBe("History");
    const pendingChoice = screen.getByRole("group", {
      name: "Physics",
    });
    expect(within(pendingChoice).getByRole("combobox")).toBeTruthy();
    expect(
      within(pendingChoice).getByRole<HTMLButtonElement>("button", {
        name: en.workflow.assign,
      }).disabled,
    ).toBe(true);
    const header = screen
      .getByRole("heading", { name: "Public survey student" })
      .closest("article")!
      .querySelector("header")!;
    expect(
      within(header).queryByRole("button", { name: new RegExp(action) }),
    ).toBeNull();
  },
);

it("keeps assignment evidence readable for observers without exposing edit or release controls", () => {
  mocks.invalid = false;
  mocks.role = "VIEWER";
  mocks.pairings = [
    {
      id: "math",
      subject: "Mathematics",
      tutor: { englishName: "Visible Tutor" },
    },
  ];
  render(content(false, true));
  fireEvent.click(screen.getByRole("tab", { name: /Assigned.*1/ }));
  const row = screen.getByRole("group", { name: "Mathematics" });
  expect(within(row).getByText("Visible Tutor")).toBeTruthy();
  expect(within(row).queryByRole("button")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.signupEditing.edit }),
  ).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it.each(["en", "zh"] as const)(
  "keeps short %s release buttons scoped to their tutor rows and full subjects in review titles",
  (locale) => {
    mocks.invalid = false;
    mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
    mocks.pairings = [
      {
        id: "math-first",
        subject: "Mathematics",
        tutor: { englishName: "First Tutor" },
      },
      {
        id: "math-second",
        subject: "Mathematics",
        tutor: { englishName: "Second Tutor" },
      },
      {
        id: "history",
        subject: "History",
        tutor: { englishName: "History Tutor" },
      },
    ];
    render(content(false, false, locale));
    const messages = locale === "zh" ? zh : en;
    for (const pairing of mocks.pairings) {
      const row = screen
        .getAllByRole("group", { name: pairing.subject })
        .find((group) => within(group).queryByText(pairing.tutor.englishName))!;
      const release = within(row).getByRole("button", {
        name: messages.signupAppeal.unassign,
      });
      expect(release.textContent).toBe(messages.signupAppeal.unassign);
      fireEvent.click(release);
      const dialog = screen.getByRole("dialog", {
        name: `${messages.signupAppeal.unassign} · ${pairing.subject}`,
      });
      expect(dialog.getAttribute("data-target")).toBe(`survey-1:${pairing.id}`);
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Cancel release" }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    expect(mocks.unassign).not.toHaveBeenCalled();
  },
);

it("keeps invalid unverified requests reviewable while disabling resend and matching", () => {
  mocks.verified = false;
  show();
  const card = screen
    .getByRole("heading", { name: "Public survey student" })
    .closest("article")!;
  const header = card.querySelector("header")!;
  expect(
    within(header).getByRole("button", { name: en.requestInvalidity.review }),
  ).toBeTruthy();
  expect(
    within(header).getByRole<HTMLButtonElement>("button", {
      name: en.workflow.resend,
    }).disabled,
  ).toBe(true);
  expect(
    within(header).getByRole("button", { name: en.signupEditing.edit }),
  ).toBeTruthy();
  expect(within(card).queryByRole("combobox")).toBeNull();
});

it.each(["RECALLED", "DISQUALIFIED", "ABORTED", "INVALID_REJECTED"])(
  "keeps terminal %s requests out of matching and release flows while retaining staff editing",
  (state) => {
    mocks.invalid = false;
    mocks.verified = false;
    mocks.state = state;
    mocks.pairings = [
      {
        id: "retained",
        subject: "Mathematics",
        tutor: { englishName: "Prior Tutor" },
      },
    ];
    render(content());
    fireEvent.click(screen.getByRole("tab", { name: /Processed.*1/ }));
    const card = screen
      .getByRole("heading", { name: "Public survey student" })
      .closest("article")!;
    expect(
      within(card).getByRole("button", { name: en.signupEditing.edit }),
    ).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: en.workflow.resend }),
    ).toBeNull();
    expect(
      within(card).queryByRole("button", {
        name: /Release assignment|Propose releasing assignment/,
      }),
    ).toBeNull();
    expect(within(card).queryByRole("combobox")).toBeNull();
  },
);

it("preserves a release review and captured version while its pairing moves between chosen and unmatched subjects", async () => {
  mocks.invalid = false;
  // Two choices keep this request in the matching panel throughout regrouping,
  // isolating child identity from intentional board-tab disposal.
  mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
  const pairing = {
    id: "stable-pairing",
    subject: "Mathematics",
    tutor: { englishName: "Retained Tutor" },
  };
  mocks.pairings = [pairing];
  const page = render(content());
  fireEvent.click(
    screen.getByRole("button", {
      name: en.signupAppeal.unassign,
    }),
  );
  const dialog = screen.getByRole("dialog");
  expect(
    screen.getByRole("dialog", {
      name: `${en.signupAppeal.unassign} · Mathematics`,
    }),
  ).toBe(dialog);
  expect(dialog.getAttribute("data-target")).toBe("survey-1:stable-pairing");

  mocks.currentVersion = 9;
  mocks.pairings = [{ ...pairing, subject: "History" }];
  page.rerender(content());
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByRole("group", { name: "History" }).contains(dialog)).toBe(
    true,
  );
  expect(mocks.unassign).not.toHaveBeenCalled();

  let rejectWrite!: (failure: Error) => void;
  mocks.unassign.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectWrite = reject;
      }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Confirm release" }),
  );
  await waitFor(() => expect(mocks.unassign).toHaveBeenCalledOnce());
  mocks.pairings = [{ ...pairing, subject: "Physics" }];
  page.rerender(content());
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Cancel release",
    }).disabled,
  ).toBe(true);
  await act(async () => rejectWrite(new Error("Assignment version changed")));
  expect(
    await within(dialog).findByText("Assignment version changed"),
  ).toBeTruthy();
  expect(dialog.getAttribute("data-target")).toBe("survey-1:stable-pairing");
  expect(mocks.unassign.mock.calls[0]?.[0]).toMatchObject({
    id: "survey-1",
    pairingId: "stable-pairing",
    expectedVersion: 2,
    signedTicket: "release-ticket",
  });

  // Retrying a rejected write preserves the original intent rather than silently
  // adopting the version that arrived during the review.
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Confirm release" }),
  );
  await waitFor(() => expect(mocks.unassign).toHaveBeenCalledTimes(2));
  expect(mocks.unassign.mock.calls[1]?.[0]).toEqual(
    mocks.unassign.mock.calls[0]?.[0],
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("retains accepted-release refresh recovery across subject regrouping without repeating the write", async () => {
  mocks.invalid = false;
  mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
  const pairing = {
    id: "stable-pairing",
    subject: "Mathematics",
    tutor: { englishName: "Retained Tutor" },
  };
  mocks.pairings = [pairing];
  mocks.invalidateRequests.mockRejectedValue(
    new Error("Offline after acceptance"),
  );
  const page = render(content());
  fireEvent.click(
    screen.getByRole("button", {
      name: en.signupAppeal.unassign,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm release" }));
  await screen.findByText(en.signupEditing.savedRefresh);
  mocks.pairings = [{ ...pairing, subject: "History" }];
  mocks.currentVersion = 9;
  page.rerender(content());
  const row = screen.getByRole("group", { name: "History" });
  expect(within(row).getByText(en.signupEditing.savedRefresh)).toBeTruthy();
  expect(
    within(row).getByRole<HTMLButtonElement>("button", {
      name: en.signupAppeal.unassign,
    }).disabled,
  ).toBe(true);
  mocks.invalidateRequests.mockResolvedValue(undefined);
  fireEvent.click(
    within(row).getByRole("button", { name: en.signupEditing.retryRefresh }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.signupEditing.savedRefresh)).toBeNull(),
  );
  expect(mocks.unassign).toHaveBeenCalledOnce();
});

const assignedMath = {
  id: "new-math-pairing",
  subject: "Mathematics",
  tutor: { englishName: "Chosen Tutor" },
};

function openSubjectAssignment(locale: "en" | "zh" = "en") {
  const messages = locale === "zh" ? zh : en;
  const row = screen.getByRole("group", { name: "Mathematics" });
  fireEvent.change(within(row).getByRole("combobox"), {
    target: { value: "chosen-tutor" },
  });
  fireEvent.click(
    within(row).getByRole("button", { name: messages.workflow.assign }),
  );
  return screen.getByRole("dialog");
}

function reviewSubjectAssignment(locale: "en" | "zh" = "en") {
  fireEvent.click(
    within(openSubjectAssignment(locale)).getByRole("button", {
      name: "Confirm release",
    }),
  );
  return screen.getByRole("dialog", { name: "Assignment consequences" });
}

it.each(["en", "zh"] as const)(
  "retains the accessible %s failed-email outcome after the first of two subjects becomes assigned",
  async (locale) => {
    mocks.invalid = false;
    mocks.verified = false;
    mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
    mocks.assign.mockResolvedValue({ ok: true, emailSent: false });
    const page = render(content(false, false, locale));
    mocks.invalidateRequests.mockImplementation(async () => {
      mocks.pairings = [assignedMath];
      page.rerender(content(false, false, locale));
    });
    fireEvent.click(
      within(reviewSubjectAssignment(locale)).getByRole("button", {
        name: "Confirm assignment",
      }),
    );
    const messages = locale === "zh" ? zh : en;
    const warning = await screen.findByText(messages.workflow.resendFailed);
    expect(warning.getAttribute("role")).toBe("status");
    expect(warning.closest("article")).toBe(
      screen
        .getByRole("heading", { name: "Public survey student" })
        .closest("article"),
    );
    expect(screen.getAllByRole("group", { name: "Mathematics" })).toHaveLength(
      1,
    );
    expect(
      within(screen.getByRole("group", { name: "Mathematics" })).queryByRole(
        "combobox",
      ),
    ).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "Physics" })).getByRole(
        "combobox",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith({
      id: "survey-1",
      subjectId: "math",
      tutorId: "chosen-tutor",
      ticket: "release-ticket",
      overrideTicket: "qualification-ticket",
    });
  },
);

it("emits no duplicate subject row or empty layout wrapper for an idle paired controller", () => {
  mocks.invalid = false;
  mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
  mocks.pairings = [assignedMath];
  render(content());
  const math = screen.getByRole("group", { name: "Mathematics" });
  const physics = screen.getByRole("group", { name: "Physics" });
  expect(math.parentElement).toBe(physics.parentElement);
  expect([...math.parentElement!.children]).toEqual([math, physics]);
  expect(screen.queryByText(en.workflow.resendFailed)).toBeNull();
});

it("retains read-only accepted-assignment recovery when pairing arrival succeeds but another refresh fails", async () => {
  mocks.invalid = false;
  mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
  mocks.invalidateTutees.mockRejectedValue(
    new Error("Offline after acceptance"),
  );
  const page = render(content());
  mocks.invalidateRequests.mockImplementation(async () => {
    mocks.pairings = [assignedMath];
    page.rerender(content());
  });
  fireEvent.click(
    within(reviewSubjectAssignment()).getByRole("button", {
      name: "Confirm assignment",
    }),
  );
  await screen.findByText(en.signupEditing.savedRefresh);
  expect(screen.getByRole("group", { name: "Mathematics" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  // Even a stale retained callback cannot resubmit an accepted proof.
  await act(async () => {
    await mocks.assignmentConfirm?.("qualification-ticket");
  });
  mocks.invalidateTutees.mockResolvedValue(undefined);
  fireEvent.click(
    screen.getByRole("button", { name: en.signupEditing.retryRefresh }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.signupEditing.savedRefresh)).toBeNull(),
  );
  expect(mocks.assign).toHaveBeenCalledOnce();
  expect(mocks.invalidateTutees).toHaveBeenCalledTimes(2);
});

it("preserves open and pending assignment reviews across external pairing refresh, guarding duplicate admission", async () => {
  mocks.invalid = false;
  mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
  const page = render(content());
  const timed = openSubjectAssignment();
  mocks.currentVersion = 9;
  mocks.pairings = [assignedMath];
  page.rerender(content());
  expect(screen.getByRole("dialog")).toBe(timed);
  expect(mocks.assign).not.toHaveBeenCalled();
  fireEvent.click(
    within(timed).getByRole("button", { name: "Confirm release" }),
  );
  const review = screen.getByRole("dialog", {
    name: "Assignment consequences",
  });
  const captured = review.getAttribute("data-payload");
  let rejectWrite!: (failure: Error) => void;
  mocks.assign.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectWrite = reject;
      }),
  );
  const confirm = mocks.assignmentConfirm!;
  let first!: Promise<unknown>;
  act(() => {
    first = Promise.resolve(confirm("qualification-ticket"));
    void first.catch(() => undefined);
    void confirm("qualification-ticket");
  });
  expect(mocks.assign).toHaveBeenCalledOnce();
  mocks.currentVersion = 10;
  page.rerender(content());
  expect(screen.getByRole("dialog")).toBe(review);
  expect(review.getAttribute("aria-busy")).toBe("true");
  expect(
    within(review).getByRole<HTMLButtonElement>("button", {
      name: "Cancel assignment",
    }).disabled,
  ).toBe(true);
  const failure = new Error(
    "This subject is already assigned. Refresh the page.",
  );
  mocks.assignError = failure;
  await act(async () => {
    rejectWrite(failure);
    await first.catch(() => undefined);
  });
  expect(within(review).getByRole("alert").textContent).toBe(failure.message);
  expect(review.getAttribute("data-payload")).toBe(captured);
  expect(mocks.assign).toHaveBeenCalledOnce();
  mocks.assign.mockRejectedValue(failure);
  fireEvent.click(
    within(review).getByRole("button", { name: "Confirm assignment" }),
  );
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
  expect(mocks.assign.mock.calls[1]?.[0]).toEqual(
    mocks.assign.mock.calls[0]?.[0],
  );
});

it("does not resurrect an assignment confirmation after explicit read-only revocation and restored access", async () => {
  mocks.invalid = false;
  mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
  const page = render(content());
  reviewSubjectAssignment();
  const captured = mocks.assignmentConfirm!;
  page.rerender(content(false, true));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    await captured("qualification-ticket");
  });
  expect(mocks.assign).not.toHaveBeenCalled();
  page.rerender(content());
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    await captured("qualification-ticket");
  });
  expect(mocks.assign).not.toHaveBeenCalled();
});

it("treats a queued assignment proposal as accepted and retries only its failed reads", async () => {
  mocks.invalid = false;
  mocks.role = "ADMIN";
  mocks.extraSubjects = [{ id: "physics", name: "Physics" }];
  mocks.assign.mockRejectedValue({
    data: { approvalId: "assignment-proposal" },
  });
  mocks.invalidateTutees.mockRejectedValue(new Error("Offline after queue"));
  render(content());
  fireEvent.click(
    within(reviewSubjectAssignment()).getByRole("button", {
      name: "Confirm assignment",
    }),
  );
  await screen.findByRole("button", { name: en.signupEditing.retryRefresh });
  expect(
    screen
      .getByRole("link", { name: en.signupEditing.queued })
      .getAttribute("href"),
  ).toBe("/admin/approvals?request=assignment-proposal");
  expect(screen.queryByText(en.signupEditing.savedRefresh)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(en.workflow.resendFailed)).toBeNull();
  expect(
    within(
      screen.getByRole("group", { name: "Mathematics" }),
    ).getByRole<HTMLButtonElement>("button", { name: en.workflow.assign })
      .disabled,
  ).toBe(true);
  mocks.invalidateTutees.mockResolvedValue(undefined);
  fireEvent.click(
    screen.getByRole("button", { name: en.signupEditing.retryRefresh }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: en.signupEditing.retryRefresh }),
    ).toBeNull(),
  );
  expect(
    screen.getAllByRole("link", { name: en.signupEditing.queued }),
  ).toHaveLength(1);
  expect(mocks.assign).toHaveBeenCalledOnce();
});

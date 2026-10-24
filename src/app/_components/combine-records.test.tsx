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
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { CombineRecords } from "./combine-records";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";

const fixture = vi.hoisted(() => ({
  preview: vi.fn(),
  reviewGroup: vi.fn(),
  finalize: vi.fn(),
  mutate: vi.fn<(input: RouterInputs["personCombine"]["combine"]) => void>(),
  refresh: vi.fn<() => Promise<void>>(),
  receipt: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
  pending: vi.fn(),
  invitationQuery: vi.fn(),
  invitationRefetch: vi.fn(),
  invitationCancel: vi.fn(),
  invitationSend: vi.fn(),
  invitationStatus: null as RouterOutputs["tuteeHistory"]["exactInvitationStatus"],
  candidateError: null as null | { message: string; data?: { code: string } },
  candidateSuccess: true,
  candidateFetching: false,
  callbacks: null as null | {
    onSuccess: (result: unknown) => Promise<void>;
    onError: (error: unknown) => void;
    onSettled: () => void;
  },
  finalizeCallbacks: null as null | {
    onSuccess: (result: unknown) => Promise<void>;
    onError: (error: unknown) => void;
    onSettled: () => void;
  },
}));
const candidates = [
  {
    ref: { kind: "TUTOR", id: "archive-tutor" },
    name: "Alex",
    email: null,
    status: "ARCHIVED",
    personId: null,
    hasLogin: false,
  },
  {
    ref: { kind: "TUTEE", id: "archive-tutee" },
    name: "Alex",
    email: null,
    status: "INACTIVE",
    personId: null,
    hasLogin: false,
  },
  {
    ref: { kind: "USER", id: "login" },
    name: "Alex",
    email: "alex@example.test",
    status: "STUDENT",
    personId: null,
    hasLogin: true,
  },
];
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        accounts: { invalidate: fixture.refresh },
        accountDetails: { invalidate: fixture.refresh },
        tutors: { invalidate: fixture.refresh },
        tutees: { invalidate: fixture.refresh },
      },
      tuteeHistory: { invalidate: fixture.refresh },
      historicalAcademics: { invalidate: fixture.refresh },
      personCombine: {
        candidates: { invalidate: fixture.refresh },
        preview: { fetch: fixture.preview },
        review: { fetch: fixture.reviewGroup },
        receipt: { fetch: fixture.receipt },
      },
    }),
    personCombine: {
      finalize: {
        useMutation: (callbacks: typeof fixture.finalizeCallbacks) => { fixture.finalizeCallbacks = callbacks; return { mutate: fixture.finalize, isPending: false }; },
      },
      candidates: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.query(input, options);
          return {
            data: candidates,
            error: fixture.candidateError,
            refetch: fixture.refetch,
            isSuccess: fixture.candidateSuccess,
            isFetching: fixture.candidateFetching,
          };
        },
      },
      combine: {
        useMutation: (callbacks: typeof fixture.callbacks) => {
          fixture.callbacks = callbacks;
          return { mutate: fixture.mutate, isPending: false };
        },
      },
    },
    tuteeHistory: {
      exactInvitationStatus: {
        useQuery: (input: unknown) => {
          fixture.invitationQuery(input);
          return { data: fixture.invitationStatus, error: null, isFetching: false, isLoading: false, refetch: fixture.invitationRefetch };
        },
      },
      inviteExact: { useMutation: () => ({ mutate: fixture.invitationSend, isPending: false }) },
      cancelExactInvitation: { useMutation: () => ({ mutateAsync: fixture.invitationCancel, isPending: false }) },
    },
  },
}));
const preview = () => ({
  fingerprint: "a".repeat(64),
  sources: candidates.slice(0, 2),
  accounts: [],
  retainedUserId: null,
  requiresHead: false,
  alreadyTogether: false,
  conflicts: [],
  warnings: [],
  canRetireLogins: false,
  retireDuplicateLogins: false,
  outcome: "GROUPED",
  counts: { users: 0, tutors: 1, tutees: 1 },
  authoritySummary: "Admin or Head",
});
const result = {
  ok: true,
  personId: "person",
  receiptId: "receipt",
  outcome: "GROUPED",
  retiredUserIds: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  fixture.refresh.mockReset().mockResolvedValue(undefined);
  fixture.preview.mockReset().mockResolvedValue(preview());
  fixture.reviewGroup.mockReset().mockResolvedValue({ ...preview(), personId: "review-person", alreadyTogether: true, requiresHead: true, blockers: [] });
  fixture.receipt.mockReset().mockResolvedValue(null);
  fixture.candidateError = null;
  fixture.candidateSuccess = true;
  fixture.candidateFetching = false;
  fixture.invitationStatus = null;
  fixture.invitationRefetch.mockReset().mockImplementation(async () => ({ data: fixture.invitationStatus }));
  fixture.invitationCancel.mockReset().mockResolvedValue({ cancelled: true });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(cleanup);

it("reads an existing group's participation without searching or writing, then explicitly finalizes", async () => {
  render(element(true, "en", "review-person"));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.reviewParticipation }));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  await screen.findByText(en.personParticipation.clear);
  expect(fixture.reviewGroup).toHaveBeenCalledWith({ personId: "review-person", retainedUserId: undefined, retireDuplicateLogins: false }, { staleTime: 0 });
  expect(fixture.query).toHaveBeenLastCalledWith({ search: "" }, { enabled: false });
  expect(fixture.finalize).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(en.combineRecords.evidence), { target: { value: "Current assignments resolved through their original workflow" } });
  fireEvent.change(screen.getByLabelText(en.combineRecords.password), { target: { value: "head-password" } });
  fireEvent.click(screen.getByLabelText(en.combineRecords.acknowledge));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.finalizeParticipation }));
  expect(fixture.finalize).toHaveBeenCalledWith(expect.objectContaining({ personId: "review-person", fingerprint: "a".repeat(64), confirmPassword: "head-password", acknowledged: true }));
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("keeps finalization blocked while a typed current assignment remains", async () => {
  fixture.reviewGroup.mockResolvedValue({ ...preview(), personId: "review-person", alreadyTogether: true, requiresHead: true, outcome: "REVIEW_REQUIRED", blockers: [{ id: "assignment", reason: "CURRENT_ASSIGNMENT", sources: [candidates[0]!.ref], work: [{ kind: "PAIRING", id: "pairing-original", dueAt: null }], destination: "/admin/pairings", blocksFinalization: true, blocksRetirement: true, field: null }] });
  render(element(true, "en", "review-person"));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.reviewParticipation }));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  await screen.findByText(en.personParticipation.reason.CURRENT_ASSIGNMENT);
  expect(screen.getByRole("link", { name: en.personParticipation.destination.pairings }).getAttribute("href")).toBe("/admin/pairings");
  fireEvent.change(screen.getByLabelText(en.combineRecords.evidence), { target: { value: "Identity confirmed, assignment remains unresolved" } });
  fireEvent.change(screen.getByLabelText(en.combineRecords.password), { target: { value: "head-password" } });
  fireEvent.click(screen.getByLabelText(en.combineRecords.acknowledge));
  const button = screen.getByRole<HTMLButtonElement>("button", { name: en.combineRecords.finalizeParticipation });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(fixture.finalize).not.toHaveBeenCalled();
});

it("cancels the original invitation scope after a group grows and requires a fresh participation review", async () => {
  const originalSources = [
    { kind: "TUTOR" as const, id: "archive-tutor" },
    { kind: "TUTEE" as const, id: "archive-tutee" },
  ];
  const blocker = {
    id: "pending-exact-invitation",
    reason: "PENDING_HISTORY_INVITATION",
    sources: originalSources,
    work: [{ kind: "HISTORICAL_RECORD_INVITATION", id: "original-scope-key", dueAt: new Date("2026-11-01") }],
    destination: "/admin/users",
    blocksFinalization: true,
    blocksRetirement: true,
    field: null,
  };
  const pendingReview = { ...preview(), personId: "review-person", alreadyTogether: true, outcome: "REVIEW_REQUIRED", blockers: [blocker] };
  fixture.reviewGroup.mockResolvedValue(pendingReview);
  fixture.invitationStatus = {
    revision: "b".repeat(64),
    invitation: { email: "original@example.test", expiresAt: new Date("2026-11-01") },
    attempt: { attemptId: "original-attempt", status: "PUBLISHED", email: "original@example.test", expiresAt: new Date("2026-11-01") },
  };
  render(element(true, "en", "review-person"));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.reviewParticipation }));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  const summary = await screen.findByText(en.combineRecords.pendingInvitation, { selector: "summary" });
  expect(fixture.invitationQuery).not.toHaveBeenCalled();
  fireEvent.click(summary);
  const email = await screen.findByLabelText<HTMLInputElement>(en.tuteeHistory.email);
  fireEvent.change(email, { target: { value: "unfinished-draft@example.test" } });
  expect(fixture.invitationQuery).toHaveBeenLastCalledWith({ sources: originalSources });

  const added = { ...candidates[0]!, ref: { kind: "TUTOR", id: "later-group-member" }, name: "Later historical record" };
  fixture.reviewGroup.mockResolvedValue({ ...pendingReview, sources: [...pendingReview.sources, added], counts: { users: 0, tutors: 2, tutees: 1 } });
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  await screen.findAllByText("Later historical record");
  expect(screen.getByLabelText<HTMLInputElement>(en.tuteeHistory.email)).toBe(email);
  expect(email.value).toBe("unfinished-draft@example.test");
  expect(fixture.invitationQuery).toHaveBeenLastCalledWith({ sources: originalSources });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: en.combineRecords.finalizeParticipation }).disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }));
  const confirmation = screen.getByRole("dialog", { name: en.tuteeHistory.cancelInvitation });
  fixture.invitationStatus = null;
  fireEvent.click(within(confirmation).getByRole("button", { name: en.tuteeHistory.cancelInvitation }));
  await within(confirmation).findByText(en.actionReview.applied);
  expect(fixture.invitationCancel).toHaveBeenCalledTimes(1);
  expect(fixture.invitationCancel).toHaveBeenCalledWith({ sources: originalSources, revision: "b".repeat(64) });
  expect(screen.queryByRole("button", { name: en.combineRecords.finalizeParticipation })).toBeNull();
  expect(fixture.reviewGroup).toHaveBeenCalledTimes(2);
  expect(fixture.finalize).not.toHaveBeenCalled();
  expect(fixture.mutate).not.toHaveBeenCalled();
  expect(fixture.invitationSend).not.toHaveBeenCalled();

  fireEvent.click(within(confirmation).getByRole("button", { name: en.actionReview.close }));
  fixture.reviewGroup.mockResolvedValue({ ...pendingReview, outcome: "GROUPED", blockers: [] });
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  await screen.findByText(en.personParticipation.clear);
  expect(fixture.reviewGroup).toHaveBeenCalledTimes(3);
  expect(fixture.finalize).not.toHaveBeenCalled();
  expect(fixture.invitationCancel).toHaveBeenCalledTimes(1);
});

it("keeps legacy invitations in their original workflow without inventing an exact scope", async () => {
  fixture.reviewGroup.mockResolvedValue({
    ...preview(), personId: "review-person", outcome: "REVIEW_REQUIRED",
    blockers: [{ id: "legacy-invitation", reason: "PENDING_HISTORY_INVITATION", sources: [{ kind: "TUTEE", id: "archive-tutee" }], work: [{ kind: "TUTEE_HISTORY_INVITATION", id: "archive-tutee", dueAt: null }], destination: "/admin/tutees", blocksFinalization: true, blocksRetirement: true, field: null }],
  });
  render(element(true, "en", "review-person"));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.reviewParticipation }));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  expect((await screen.findByRole("link", { name: en.personParticipation.destination.tutees })).getAttribute("href")).toBe("/admin/tutees");
  expect(screen.queryByText(en.combineRecords.pendingInvitation, { selector: "summary" })).toBeNull();
  expect(fixture.invitationQuery).not.toHaveBeenCalled();
  expect(fixture.invitationCancel).not.toHaveBeenCalled();
});
const element = (isHead = false, locale: "en" | "zh" = "en", reviewPersonId?: string) => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "en" ? en : zh}
    timeZone="UTC"
  >
    <CombineRecords isHead={isHead} onPendingChange={fixture.pending} reviewPersonId={reviewPersonId} />
  </NextIntlClientProvider>
);
function mount(isHead = false, locale: "en" | "zh" = "en") {
  return render(element(isHead, locale));
}
async function review(locale: "en" | "zh" = "en") {
  const copy = (locale === "en" ? en : zh).combineRecords;
  fireEvent.click(screen.getByRole("button", { name: copy.open }));
  fireEvent.click(screen.getByRole("checkbox", { name: /archive-tutor/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /archive-tutee/ }));
  fireEvent.click(screen.getByRole("button", { name: copy.preview }));
  await screen.findByRole("heading", { name: copy.result });
}
function confirm() {
  fireEvent.change(
    screen.getByRole("textbox", { name: en.combineRecords.evidence }),
    { target: { value: "Verified both original school records" } },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.combineRecords.acknowledge }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.confirm }),
  );
}

it.each(["en", "zh"] as const)(
  "reviews two accountless record types in %s without inventing a login",
  async (locale) => {
    const copy = (locale === "en" ? en : zh).combineRecords;
    mount(false, locale);
    expect(fixture.query).toHaveBeenLastCalledWith(
      { search: "" },
      { enabled: false },
    );
    await review(locale);
    expect(screen.getByText(copy.resultNoLogin)).toBeTruthy();
    expect(screen.queryByLabelText(copy.retainedLogin)).toBeNull();
    expect(screen.queryByLabelText(copy.password)).toBeNull();
    expect(fixture.preview).toHaveBeenCalledWith(
      {
        sources: [candidates[0]!.ref, candidates[1]!.ref],
        retainedUserId: undefined,
        retireDuplicateLogins: false,
      },
      { staleTime: 0 },
    );
  },
);

it("preserves selected records across a new search and guards duplicate submission", async () => {
  mount();
  await review();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.combineRecords.search }),
    { target: { value: "another person" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.searchAction }),
  );
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: /archive-tutor/ })
      .checked,
  ).toBe(true);
  confirm();
  expect(fixture.mutate).toHaveBeenCalledOnce();
  expect(fixture.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      acknowledged: true,
      sources: [candidates[0]!.ref, candidates[1]!.ref],
      retireDuplicateLogins: false,
      reason: "Verified both original school records",
    }),
  );
  expect(fixture.mutate.mock.calls[0]![0].operationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.confirm }),
  );
  expect(fixture.mutate).toHaveBeenCalledOnce();
});

it("lets Admin inspect Head-required cases without claiming approval was submitted", async () => {
  fixture.preview.mockResolvedValue({
    ...preview(),
    requiresHead: true,
    outcome: "REVIEW_REQUIRED",
    conflicts: ["Current participation conflicts"],
  });
  mount();
  await review();
  expect(screen.getByText(en.combineRecords.headRequired)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.combineRecords.confirmPending }),
  ).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("retains accepted grouping through failed synchronization and retries only reads", async () => {
  mount();
  await review();
  confirm();
  fixture.refresh.mockRejectedValue(new Error("Offline"));
  await act(async () => {
    await fixture.callbacks!.onSuccess(result);
    fixture.callbacks!.onSettled();
  });
  expect(screen.getByText(en.combineRecords.refreshFailed)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.combineRecords.confirm }),
  ).toBeNull();
  fixture.refresh.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() =>
    expect(screen.queryByText(en.combineRecords.refreshFailed)).toBeNull(),
  );
  expect(fixture.mutate).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: en.combineRecords.combineMore }),
  ).toBeTruthy();
});

it("recovers an interrupted response from its durable receipt without repeating the write", async () => {
  mount();
  await review();
  confirm();
  await act(async () => {
    fixture.callbacks!.onError({ message: "Connection lost" });
    fixture.callbacks!.onSettled();
  });
  expect(screen.getByText(en.combineRecords.uncertain)).toBeTruthy();
  expect(fixture.pending).toHaveBeenLastCalledWith(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.combineRecords.close,
    }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.combineRecords.checkOutcome,
    }).disabled,
  ).toBe(false);
  expect(
    screen.getByText(
      `Operation reference: ${fixture.mutate.mock.calls[0]![0].operationId}`,
    ),
  ).toBeTruthy();
  fixture.receipt.mockResolvedValue(result);
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.checkOutcome }),
  );
  await screen.findByText(en.combineRecords.saved);
  expect(fixture.receipt).toHaveBeenCalledWith(
    { operationId: fixture.mutate.mock.calls[0]![0].operationId },
    { staleTime: 0 },
  );
  expect(fixture.mutate).toHaveBeenCalledOnce();
  await waitFor(() => expect(fixture.pending).toHaveBeenLastCalledWith(false));
});

it("reuses the identical operation ID when no receipt is found after an interrupted response", async () => {
  mount();
  await review();
  confirm();
  const submitted = fixture.mutate.mock.calls[0]![0];
  await act(async () => {
    fixture.callbacks!.onError({ message: "Connection lost" });
    fixture.callbacks!.onSettled();
  });
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: en.combineRecords.evidence,
    }).disabled,
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.combineRecords.preview })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.checkOutcome }),
  );
  await screen.findByText(en.combineRecords.notRecordedYet);
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.combineRecords.acknowledge }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.retryExact }),
  );
  expect(fixture.mutate).toHaveBeenCalledTimes(2);
  expect(fixture.mutate.mock.calls[1]![0]).toEqual(submitted);
});

it("reopens a grouped pending result for another authoritative review", async () => {
  fixture.preview.mockResolvedValue({
    ...preview(),
    requiresHead: true,
    outcome: "REVIEW_REQUIRED",
    conflicts: ["Current participation needs review"],
  });
  mount(true);
  await review();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.combineRecords.evidence }),
    { target: { value: "Verified both original school records" } },
  );
  fireEvent.change(screen.getByLabelText(en.combineRecords.password), {
    target: { value: "Head-password" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.combineRecords.acknowledge }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.confirmPending }),
  );
  await act(async () => {
    await fixture.callbacks!.onSuccess({
      ...result,
      outcome: "REVIEW_REQUIRED",
    });
    fixture.callbacks!.onSettled();
  });
  expect(screen.getByText(en.combineRecords.savedPending)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.reviewAgain }),
  );
  fixture.preview.mockResolvedValue({ ...preview(), alreadyTogether: true });
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.preview }),
  );
  await screen.findByText(en.combineRecords.alreadyTogether);
  expect(fixture.preview).toHaveBeenCalledTimes(2);
  expect(fixture.mutate).toHaveBeenCalledOnce();
});

it("conceals a cached selection/review after denied search and does not restore it on network failure", async () => {
  const view = mount();
  await review();
  fixture.candidateError = {
    message: "Forbidden",
    data: { code: "FORBIDDEN" },
  };
  fixture.candidateSuccess = false;
  view.rerender(element());
  expect(
    screen.queryByRole("heading", { name: en.combineRecords.result }),
  ).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  expect(
    screen
      .getByRole<HTMLButtonElement>("button", { name: en.uiPatterns.retry })
      .matches(":disabled"),
  ).toBe(false);
  fixture.candidateError = { message: "Network failed" };
  view.rerender(element());
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(fixture.refetch).toHaveBeenCalledOnce();
});

it("conceals selected private records when the preview endpoint denies access", async () => {
  fixture.preview.mockRejectedValue(
    Object.assign(new Error("Forbidden"), { data: { code: "FORBIDDEN" } }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.open }));
  fireEvent.click(screen.getByRole("checkbox", { name: /archive-tutor/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /archive-tutee/ }));
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.preview }),
  );
  await screen.findByText(en.combineRecords.denied);
  expect(screen.queryByRole("table")).toBeNull();
});

it("blocks unsafe credential retirement while preserving grouping as an explicit separate choice", async () => {
  const accountPreview = {
    ...preview(),
    requiresHead: true,
    accounts: [
      { id: "one", name: "Alex", email: "one@example.test", ready: true },
      { id: "two", name: "Alex", email: "two@example.test", ready: true },
    ],
    retainedUserId: "one",
    canRetireLogins: false,
  };
  fixture.preview.mockResolvedValue(accountPreview);
  mount(true);
  await review();
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.combineRecords.retireLogins }),
  );
  fixture.preview.mockResolvedValue({
    ...accountPreview,
    retireDuplicateLogins: true,
    outcome: "REVIEW_REQUIRED",
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.combineRecords.preview }),
  );
  await screen.findByText(en.combineRecords.cannotRetire);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.combineRecords.confirmPending,
    }).disabled,
  ).toBe(true);
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("recovers a denied group review through its own fresh read without trusting disabled candidate cache", async () => {
  fixture.candidateError = { message: "old candidate denial", data: { code: "FORBIDDEN" } };
  fixture.candidateSuccess = false;
  fixture.reviewGroup.mockRejectedValueOnce(Object.assign(new Error("review denied"), { data: { code: "FORBIDDEN" } }));
  render(element(true, "en", "review-person"));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.reviewParticipation }));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  await screen.findByText(en.combineRecords.denied);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await screen.findByText(en.personParticipation.clear);
  expect(fixture.reviewGroup).toHaveBeenCalledTimes(2);
  expect(fixture.refetch).not.toHaveBeenCalled();
  expect(fixture.finalize).not.toHaveBeenCalled();
});

it("retains an accepted finalization receipt and retries failed synchronization without offering another finalization", async () => {
  render(element(true, "en", "review-person"));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.reviewParticipation }));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  await screen.findByText(en.personParticipation.clear);
  fireEvent.change(screen.getByLabelText(en.combineRecords.evidence), { target: { value: "Existing domain workflows resolved every current conflict" } });
  fireEvent.change(screen.getByLabelText(en.combineRecords.password), { target: { value: "head-password" } });
  fireEvent.click(screen.getByLabelText(en.combineRecords.acknowledge));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.finalizeParticipation }));
  fixture.refresh.mockRejectedValue(new Error("read failed"));
  await act(async () => { await fixture.finalizeCallbacks!.onSuccess(result); fixture.finalizeCallbacks!.onSettled(); });
  expect(screen.getByText(en.combineRecords.saved)).toBeTruthy();
  expect(screen.getByText(en.combineRecords.refreshFailed)).toBeTruthy();
  fixture.refresh.mockResolvedValue(undefined);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry })); });
  expect(screen.queryByRole("button", { name: en.combineRecords.combineMore })).toBeNull();
  expect(screen.queryByRole("button", { name: en.combineRecords.finalizeParticipation })).toBeNull();
  expect(fixture.finalize).toHaveBeenCalledTimes(1);
});

it("shows retained current work without falsely labelling it as a retirement blocker", async () => {
  fixture.reviewGroup.mockResolvedValue({ ...preview(), personId: "review-person", blockers: [{ id: "retained-assignment", reason: "CURRENT_ASSIGNMENT", sources: [candidates[0]!.ref], work: [{ kind: "PAIRING", id: "retained-pairing", dueAt: null }], destination: "/admin/pairings", blocksFinalization: false, blocksRetirement: false, field: null }] });
  render(element(true, "en", "review-person"));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.reviewParticipation }));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.refreshParticipation }));
  await screen.findByText(en.personParticipation.reason.CURRENT_ASSIGNMENT);
  expect(screen.queryByText(en.personParticipation.blocksRetirement)).toBeNull();
  expect(screen.queryByText(en.personParticipation.blocksFinalization)).toBeNull();
});

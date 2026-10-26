/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { TutorHistorySection } from "./tutor-history-link";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";

const mock = vi.hoisted(() => ({
  preview: vi.fn(),
  link: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
  close: vi.fn(),
  combine:
    vi.fn<
      (
        input: RouterInputs["personCombine"]["combine"],
      ) => Promise<RouterOutputs["personCombine"]["combine"]>
    >(),
  combinePreview: vi.fn(),
  receipt: vi.fn(),
  permissions: ((): {
    data: { canLink: boolean; isHead: boolean } | undefined;
    error: Error | null;
    isFetching: boolean;
  } => ({
    data: { canLink: true, isHead: true },
    error: null,
    isFetching: false,
  }))(),
  candidateError: null as Error | null,
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({
        tutorHistory: { preview: { fetch: mock.preview } },
        admin: {
          tutors: { invalidate: mock.refresh },
          accounts: { invalidate: mock.refresh },
          accountDetails: { invalidate: mock.refresh },
        },
        tuteeHistory: {
          invalidate: mock.refresh,
          myTutorRecords: { invalidate: mock.refresh },
          myTutorDetails: { invalidate: mock.refresh },
        },
        historicalAcademics: { invalidate: mock.refresh },
        personCombine: {
          candidates: { invalidate: mock.refresh },
          preview: { fetch: mock.combinePreview },
          receipt: { fetch: mock.receipt },
        },
      }),
      personCombine: {
        finalize: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        candidates: {
          useQuery: () => ({
            data: [
              {
                ref: { kind: "TUTEE", id: "archive-tutee" },
                name: "Original Archive",
                status: "INACTIVE",
                hasLogin: false,
                email: null,
                personId: null,
              },
            ],
            isSuccess: true,
            isFetching: false,
          }),
        },
        combine: {
          useMutation: (options: object) =>
            useMutation({ mutationFn: mock.combine, ...options }),
        },
      },
      tutorHistory: {
        permissions: {
          useQuery: () => ({ ...mock.permissions, refetch: mock.retry }),
        },
        candidates: {
          useQuery: () => ({
            data: [
              {
                id: "owner",
                name: "Verified Person",
                email: "owner@example.test",
              },
            ],
            error: mock.candidateError,
            isFetching: false,
            refetch: mock.retry,
          }),
        },
        link: {
          useMutation: (options: object) =>
            useMutation({ mutationFn: mock.link, ...options }),
        },
      },
    },
  };
});
let client: QueryClient;
const original = () => ({
  fingerprint: "a".repeat(64),
  conflict: false,
  currentConflict: false,
  alreadyLinked: false,
  previousOwner: null,
  record: {
    id: "archive",
    name: "Archive Person",
    status: "ARCHIVED",
    counts: { sessions: 5, meetingAttendances: 3, adjustments: 2 },
  },
  account: {
    id: "owner",
    name: "Verified Person",
    email: "owner@example.test",
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.permissions = {
    data: { canLink: true, isHead: true },
    error: null,
    isFetching: false,
  };
  mock.candidateError = null;
  mock.preview.mockResolvedValue(original());
  mock.link.mockResolvedValue({ ok: true });
  mock.refresh.mockResolvedValue(undefined);
  mock.combine.mockReset();
  mock.combinePreview.mockReset().mockResolvedValue({
    fingerprint: "a".repeat(64),
    sources: [
      { ref: { kind: "TUTOR", id: "archive" }, name: "Original Archive" },
      { ref: { kind: "TUTEE", id: "archive-tutee" }, name: "Original Archive" },
    ],
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
  mock.receipt.mockReset().mockResolvedValue({
    ok: true,
    personId: "person",
    receiptId: "receipt",
    outcome: "GROUPED",
    retiredUserIds: [],
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function Sibling({ pending }: { pending: boolean }) {
  const busy = useDialogPending(pending);
  return <button disabled={busy}>Sibling save</button>;
}
const ui = (
  locale = "en",
  siblingPending = false,
  unified = false,
  historical = false,
) => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
    >
      <ProfileDialog title="Tutor editor" onClose={mock.close}>
        <Sibling pending={siblingPending} />
        <TutorHistorySection
          tutorId="archive"
          unified={unified}
          historical={historical}
        />
      </ProfileDialog>
    </NextIntlClientProvider>
  </QueryClientProvider>
);

it.each([true, false])(
  "retains an exact historical-owner correction for Head only (head=%s)",
  (head) => {
    mock.permissions.data = { canLink: true, isHead: head };
    render(ui("en", false, true, true));
    expect(
      screen.getByRole("button", { name: en.combineRecords.open }),
    ).toBeTruthy();
    expect(!!screen.queryByText(en.combineRecords.correctOwner)).toBe(head);
  },
);

it("does not offer historical-owner correction for a current tutor profile", () => {
  render(ui("en", false, true, false));
  expect(screen.queryByText(en.combineRecords.correctOwner)).toBeNull();
});

it("retains an uncertain combination and its receipt reference across transient and denied parent permission reads", async () => {
  mock.combine.mockRejectedValue(new Error("Connection interrupted"));
  const view = render(ui("en", false, true, true));
  const panel = () =>
    within(
      screen.getByRole("region", {
        name: en.combineRecords.title,
      }),
    );
  fireEvent.click(
    panel().getByRole("button", { name: en.combineRecords.open }),
  );
  fireEvent.click(panel().getByRole("checkbox", { name: /archive-tutee/ }));
  fireEvent.click(
    panel().getByRole("button", { name: en.combineRecords.preview }),
  );
  await panel().findByRole("heading", { name: en.combineRecords.result });
  fireEvent.change(panel().getByLabelText(en.combineRecords.evidence), {
    target: { value: "Reviewed original participant evidence" },
  });
  fireEvent.click(panel().getByLabelText(en.combineRecords.acknowledge));
  fireEvent.click(
    panel().getByRole("button", { name: en.combineRecords.confirm }),
  );
  await panel().findByText(en.combineRecords.uncertain);
  const operationId = mock.combine.mock.calls[0]![0].operationId;
  mock.permissions.error = new Error("Temporary network error");
  view.rerender(ui("en", false, true, true));
  expect(panel().getByText(`Operation reference: ${operationId}`)).toBeTruthy();
  expect(
    panel().getByLabelText<HTMLTextAreaElement>(en.combineRecords.evidence)
      .value,
  ).toBe("Reviewed original participant evidence");
  expect(
    panel().getByRole<HTMLButtonElement>("button", {
      name: en.combineRecords.checkOutcome,
    }).disabled,
  ).toBe(false);
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  mock.permissions.error = Object.assign(new Error("Forbidden"), {
    data: { code: "FORBIDDEN" },
  });
  view.rerender(ui("en", false, true, true));
  expect(panel().queryByRole("table")).toBeNull();
  expect(panel().getByText(`Operation reference: ${operationId}`)).toBeTruthy();
  mock.permissions.error = new Error("Still offline");
  view.rerender(ui("en", false, true, true));
  expect(panel().queryByRole("table")).toBeNull();
  fireEvent.click(
    panel().getByRole("button", { name: en.combineRecords.checkOutcome }),
  );
  await panel().findByText(en.combineRecords.saved);
  expect(mock.receipt).toHaveBeenCalledWith({ operationId }, { staleTime: 0 });
  expect(mock.combine).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false"),
  );
});

it("preserves a Head correction draft during permission read failure and conceals it after Head authority is removed", async () => {
  const view = render(ui("en", false, true, true));
  const details = screen
    .getByText(en.combineRecords.correctOwner, { selector: "summary" })
    .closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  fireEvent.change(screen.getByLabelText(en.tutorHistory.evidence), {
    target: { value: "Preserve this exact-owner correction draft" },
  });
  mock.permissions.error = new Error("Temporary permission read failure");
  view.rerender(ui("en", false, true, true));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.tutorHistory.evidence).value,
  ).toBe("Preserve this exact-owner correction draft");
  expect(
    screen.getByLabelText(en.tutorHistory.evidence).matches(":disabled"),
  ).toBe(true);
  mock.permissions.error = null;
  mock.permissions.data = { canLink: true, isHead: false };
  view.rerender(ui("en", false, true, true));
  expect(screen.queryByLabelText(en.tutorHistory.evidence)).toBeNull();
  mock.permissions.data = { canLink: true, isHead: true };
  view.rerender(ui("en", false, true, true));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.tutorHistory.evidence).value,
  ).toBe("Preserve this exact-owner correction draft");
});
async function open(locale = "en") {
  const copy = locale === "zh" ? zh.tutorHistory : en.tutorHistory;
  const summary = screen.getByText(copy.title, { selector: "summary" });
  fireEvent.click(summary);
  fireEvent(summary.closest("details")!, new Event("toggle"));
  await screen.findByLabelText(copy.evidence);
  return copy;
}
async function review(locale = "en") {
  const copy = await open(locale);
  fireEvent.change(screen.getByLabelText(copy.chooseAccount), {
    target: { value: "owner" },
  });
  fireEvent.change(screen.getByLabelText(copy.evidence), {
    target: { value: "Original archive identity checked by staff" },
  });
  fireEvent.click(screen.getByRole("button", { name: copy.preview }));
  await screen.findByRole("region", { name: copy.reviewTitle });
  return copy;
}

it.each(["en", "zh"])(
  "reviews exact record, evidence and acknowledgment in %s",
  async (locale) => {
    render(ui(locale));
    const copy = await review(locale);
    const confirm = screen.getByRole("button", { name: copy.confirm });
    expect(confirm.matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(copy.confirmIdentity));
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mock.link).toHaveBeenCalledTimes(1));
    expect(mock.link.mock.calls[0]?.[0]).toEqual({
      tutorId: "archive",
      userId: "owner",
      fingerprint: "a".repeat(64),
      reason: "Original archive identity checked by staff",
      acknowledged: true,
    });
    await screen.findByText(copy.saved);
  },
);

it("does not render linking for unauthorized roles and exposes permission failure recovery", () => {
  mock.permissions.data = { canLink: false, isHead: false };
  const view = render(ui());
  expect(screen.queryByText(en.tutorHistory.title)).toBeNull();
  mock.permissions = {
    data: undefined,
    error: new Error("failed"),
    isFetching: false,
  };
  view.rerender(ui());
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(mock.retry).toHaveBeenCalledOnce();
});

it("retains the draft through collapse, refresh errors and failed writes; new review is required", async () => {
  render(ui());
  const copy = await review();
  mock.link.mockRejectedValueOnce(new Error("HISTORY_STALE"));
  fireEvent.click(screen.getByLabelText(copy.confirmIdentity));
  fireEvent.click(screen.getByRole("button", { name: copy.confirm }));
  await screen.findByText(copy.HISTORY_STALE);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(copy.evidence).value,
  ).toContain("Original archive");
  expect(screen.queryByRole("button", { name: copy.confirm })).toBeNull();
  const details = screen
    .getByText(copy.title, { selector: "summary" })
    .closest("details")!;
  details.open = false;
  fireEvent(details, new Event("toggle"));
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(copy.evidence).value,
  ).toContain("Original archive");
  fireEvent.click(screen.getByRole("button", { name: copy.preview }));
  await screen.findByLabelText(copy.confirmIdentity);
  expect(
    screen.getByLabelText<HTMLInputElement>(copy.confirmIdentity).checked,
  ).toBe(false);
});

it.each(["current", "retained", "owned"])(
  "blocks an unsupported %s ownership action",
  async (kind) => {
    mock.permissions.data = { canLink: true, isHead: false };
    mock.preview.mockResolvedValue({
      ...original(),
      currentConflict: kind === "current",
      conflict: kind === "retained",
      alreadyLinked: kind === "owned",
    });
    render(ui());
    await review();
    expect(
      screen.queryByRole("button", { name: en.tutorHistory.confirm }),
    ).toBeNull();
    expect(
      screen.getByText(
        kind === "current"
          ? en.tutorHistory.HISTORY_USE_MERGE
          : kind === "retained"
            ? en.tutorHistory.HISTORY_HEAD_REQUIRED
            : en.tutorHistory.alreadyLinked,
      ),
    ).toBeTruthy();
  },
);

it("requires a Head password for correction and discards the review when evidence changes", async () => {
  mock.preview.mockResolvedValue({
    ...original(),
    conflict: true,
    previousOwner: {
      id: "previous",
      name: "Prior",
      email: "prior@example.test",
    },
  });
  render(ui());
  const copy = await review();
  fireEvent.click(screen.getByLabelText(copy.confirmIdentity));
  expect(
    screen.getByRole("button", { name: copy.confirm }).matches(":disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(copy.password), {
    target: { value: "head password" },
  });
  expect(
    screen.getByRole("button", { name: copy.confirm }).matches(":disabled"),
  ).toBe(false);
  fireEvent.change(screen.getByLabelText(copy.evidence), {
    target: { value: "Changed evidence" },
  });
  expect(screen.queryByLabelText(copy.password)).toBeNull();
  expect(screen.queryByRole("button", { name: copy.confirm })).toBeNull();
});

it("blocks parent dismissal and siblings during a write, then releases after settlement", async () => {
  let finish!: () => void;
  mock.link.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(ui());
  const copy = await review();
  fireEvent.click(screen.getByLabelText(copy.confirmIdentity));
  fireEvent.click(screen.getByRole("button", { name: copy.confirm }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Sibling save" }).matches(":disabled"),
    ).toBe(true),
  );
  expect(
    screen
      .getByRole("button", { name: en.accountProfile.close })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(mock.close).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Sibling save" }).matches(":disabled"),
    ).toBe(false),
  );
  view.rerender(ui("en", true));
  expect(screen.getByLabelText(copy.evidence).matches(":disabled")).toBe(true);
});

it("retries only reads after a saved link fails to refresh", async () => {
  mock.refresh.mockRejectedValueOnce(new Error("refresh failed"));
  render(ui());
  const copy = await review();
  fireEvent.click(screen.getByLabelText(copy.confirmIdentity));
  fireEvent.click(screen.getByRole("button", { name: copy.confirm }));
  await screen.findByText(copy.refreshFailed);
  expect(screen.getByLabelText(copy.evidence).matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() =>
    expect(screen.queryByText(copy.refreshFailed)).toBeNull(),
  );
  expect(mock.link).toHaveBeenCalledOnce();
});

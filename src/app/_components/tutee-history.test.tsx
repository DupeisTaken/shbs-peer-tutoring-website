/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { academicSummary } from "~/lib/academics";
import type { RouterOutputs } from "~/trpc/react";
import {
  TuteeHistoryContent,
  TuteeHistoryDialog,
  TuteeHistoryLinkForm,
} from "./tutee-history";
import { Modal } from "./ui/modal";
import { HistoryClaim } from "../history/claim/history-claim";
type HistoryQuery = {
  data: unknown;
  error?: { message: string } | null;
  isLoading?: boolean;
  isFetching?: boolean;
  refetch?: () => unknown;
};
type InviteReceipt = RouterOutputs["tuteeHistory"]["invite"];
type MutationError = { message: string; data?: { code?: string } };
type InviteInput = { email: string };
const mock = vi.hoisted(() => ({
  preview: vi.fn(),
  link: vi.fn(),
  invite: vi.fn(),
  claim: vi.fn(),
  cancel: vi.fn(),
  details: null as RouterOutputs["tuteeHistory"]["myDetails"] | null,
  invitation: null as
    RouterOutputs["tuteeHistory"]["invitationStatus"] | undefined,
  invitationError: null as MutationError | null,
  invitationFetching: false,
  candidateError: null as MutationError | null,
  invitationRefetch: vi.fn(),
  invitePending: false,
  cancelPending: false,
  inviteSuccess: undefined as
    undefined | ((result: InviteReceipt, input: InviteInput) => Promise<void>),
  inviteError: undefined as
    undefined | ((error: MutationError, input: InviteInput) => void),
  inviteSettled: undefined as undefined | (() => void),
  cancelSuccess: undefined as
    undefined | ((result: { cancelled: boolean }) => Promise<void>),
  cancelError: undefined as undefined | ((error: MutationError) => void),
  cancelSettled: undefined as undefined | (() => void),
  success: undefined as undefined | (() => Promise<void>),
  linkError: undefined as undefined | ((error: MutationError) => void),
  invalidate: vi.fn<() => Promise<void>>(async () => undefined),
  pending: false,
  staffDetails: vi.fn<(input: unknown, options: unknown) => HistoryQuery>(),
  ownDetails: vi.fn<(input: unknown, options: unknown) => HistoryQuery>(),
}));
vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        tutees: { invalidate: mock.invalidate },
        tuteeStats: { invalidate: mock.invalidate },
        pairings: { invalidate: mock.invalidate },
        accounts: { invalidate: mock.invalidate },
        accountDetails: { invalidate: mock.invalidate },
      },
      student: { invalidate: mock.invalidate },
      tuteeHistory: {
        invalidate: mock.invalidate,
        preview: { fetch: mock.preview },
      },
    }),
    tuteeHistory: {
      details: {
        useQuery: (input: unknown, options: unknown) =>
          mock.staffDetails(input, options),
      },
      myDetails: {
        useQuery: (input: unknown, options: unknown) =>
          mock.ownDetails(input, options),
      },
      invitationStatus: {
        useQuery: () => ({
          data: mock.invitation,
          error: mock.invitationError,
          isFetching: mock.invitationFetching,
          refetch: mock.invitationRefetch,
        }),
      },
      cancelInvitation: {
        useMutation: (options: {
          onSuccess: typeof mock.cancelSuccess;
          onError: typeof mock.cancelError;
          onSettled: typeof mock.cancelSettled;
        }) => {
          mock.cancelSuccess = options.onSuccess;
          mock.cancelError = options.onError;
          mock.cancelSettled = options.onSettled;
          return { mutate: mock.cancel, isPending: mock.cancelPending };
        },
      },
      candidates: {
        useQuery: () => ({
          error: mock.candidateError,
          data: [
            {
              id: "account",
              name: "Alex Verified",
              email: "alex@example.test",
            },
          ],
        }),
      },
      link: {
        useMutation: (options: {
          onSuccess: () => Promise<void>;
          onError: typeof mock.linkError;
        }) => {
          mock.success = options.onSuccess;
          mock.linkError = options.onError;
          return { mutate: mock.link, isPending: mock.pending };
        },
      },
      invite: {
        useMutation: (options: {
          onSuccess: typeof mock.inviteSuccess;
          onError: typeof mock.inviteError;
          onSettled: typeof mock.inviteSettled;
        }) => {
          mock.inviteSuccess = options.onSuccess;
          mock.inviteError = options.onError;
          mock.inviteSettled = options.onSettled;
          return { mutate: mock.invite, isPending: mock.invitePending };
        },
      },
      inspectClaim: {
        useQuery: () => ({ data: { name: "Alex Historical", sessions: 6 } }),
      },
      claim: { useMutation: () => ({ mutate: mock.claim }) },
    },
  },
}));
const row = {
  id: "record",
  englishName: "Alex Historical",
  updatedAt: new Date("2024-10-01"),
  user: null,
  owner: null,
} as unknown as RouterOutputs["admin"]["tutees"][number];
const mount = (head = false, locale: "en" | "zh" = "en") =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <TuteeHistoryLinkForm
        row={row}
        canCorrectOwnership={head}
        onLinked={() => undefined}
      />
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mock.invalidate.mockReset().mockResolvedValue(undefined);
  mock.pending = false;
  const details = {
    data: {
      record: {
        id: "record",
        name: "Alex Historical",
        gradeLevel: "Grade 9",
        academicallyGraduated: false,
      },
      term: { name: "2024 Autumn" },
      owner: null,
      count: 1,
      sessions: [
        {
          status: "PRESENT",
          session: {
            id: "session",
            date: new Date("2024-10-01"),
            schoolYear: "24-25",
            quarter: "Q1",
            pairing: { subject: "Mathematics" },
            tutor: { englishName: "Taylor Tutor" },
          },
        },
      ],
    },
  };
  mock.details = null;
  mock.staffDetails.mockImplementation(() =>
    mock.details ? { data: mock.details } : details,
  );
  mock.ownDetails.mockImplementation(() =>
    mock.details ? { data: mock.details } : details,
  );
  mock.invitation = null;
  mock.invitationError = null;
  mock.invitationFetching = false;
  mock.candidateError = null;
  mock.invitePending = false;
  mock.cancelPending = false;
  mock.invitationRefetch.mockImplementation(async () => ({
    data: mock.invitation,
    error: mock.invitationError,
  }));
  mock.preview.mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Alex Historical", sessions: 6 },
    account: { name: "Alex Verified", email: "alex@example.test" },
    conflict: false,
    currentConflict: false,
  });
});

it("shows invitation delivery metadata and cancels the exact displayed grant without losing the identity draft", () => {
  mock.invitation = {
    invitation: {
      email: "alumni@example.test",
      expiresAt: new Date("2026-10-09T00:00:00Z"),
    },
    attempt: null,
    revision: "b".repeat(64),
  };
  mount();
  const evidence = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.tuteeHistory.evidence,
  });
  fireEvent.change(evidence, {
    target: { value: "Reviewed identity evidence stays in this draft" },
  });
  expect(screen.getByText(/alumni@example.test/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  expect(mock.cancel).toHaveBeenCalledWith({
    tuteeId: "record",
    revision: "b".repeat(64),
  });
  // Even before the mutation hook reports pending, duplicate/cross-action dispatch
  // must not reuse the displayed cancellation grant or submit an invitation.
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  expect(mock.cancel).toHaveBeenCalledOnce();
  const email = screen.getByLabelText<HTMLInputElement>(en.tuteeHistory.email);
  fireEvent.change(email, { target: { value: "another@example.test" } });
  fireEvent.submit(email.closest("form")!);
  expect(evidence.value).toBe("Reviewed identity evidence stays in this draft");
  expect(mock.invite).not.toHaveBeenCalled();
});
afterEach(cleanup);

it.each([false, true])(
  "provides a named keyboard-scrollable read-only history region (personal=%s)",
  (personal) => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <TuteeHistoryDialog
          tuteeId="record"
          personal={personal}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    const region = screen.getByRole("region", {
      name: en.tuteeHistory.details,
    });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.textContent).toContain("Mathematics");
    expect(region.textContent).toContain("24-25");
    expect(screen.getByText(en.tuteeHistory.scrollHint)).toBeTruthy();
    expect(mock.staffDetails).toHaveBeenCalledWith(
      { tuteeId: "record", page: 0 },
      { enabled: !personal, refetchOnMount: "always" },
    );
    expect(mock.ownDetails).toHaveBeenCalledWith(
      { tuteeId: "record", page: 0 },
      { enabled: personal, refetchOnMount: "always" },
    );
  },
);

it("registers historical writes with the parent dialog and locks the whole historical form", () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  const close = vi.fn();
  const contents = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <Modal title="Profile" onClose={close} footer={null}>
        <TuteeHistoryLinkForm row={row} canCorrectOwnership={false} onLinked={vi.fn()} />
      </Modal>
    </NextIntlClientProvider>
  );
  const view = render(contents());
  const evidence = screen.getByRole("textbox", {
    name: en.tuteeHistory.evidence,
  });
  fireEvent.change(evidence, {
    target: { value: "Verified archive evidence" },
  });
  mock.pending = true;
  view.rerender(contents());
  expect(
    screen.getByRole("dialog", { name: "Profile" }).getAttribute("aria-busy"),
  ).toBe("true");
  expect(evidence.closest("fieldset")?.disabled).toBe(true);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(close).not.toHaveBeenCalled();
  for (const form of document.querySelectorAll("form")) fireEvent.submit(form);
  expect(mock.invite).not.toHaveBeenCalled();
  mock.pending = false;
  view.rerender(contents());
  expect(evidence.closest("fieldset")?.disabled).toBe(false);
  expect((evidence as HTMLTextAreaElement).value).toBe(
    "Verified archive evidence",
  );
});
it.each(["en", "zh"])(
  "does not imply current-grade confirmation is required for personal history (%s)",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    mock.details = {
      historicalAcademics: [],
      record: {
        id: "past",
        name: "Alex",
        gradeLevel: "9",
        academicallyGraduated: false,
        updatedAt: new Date(),
        alternativeNames: null,
      },
      owner: {
        id: "owner",
        name: "Alex",
        username: null,
        emailVerified: true,
        academic: academicSummary(null),
      },
      term: null,
      count: 0,
      sessions: [],
      page: 0,
    };
    const content = (personal: boolean) => (
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="UTC"
      >
        <TuteeHistoryDialog
          tuteeId="past"
          personal={personal}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    const view = render(content(true));
    expect(
      screen.getByText(messages.tuteeHistory.currentAcademicsOptional),
    ).toBeTruthy();
    expect(screen.queryByText(messages.academics.needsConfirmation)).toBeNull();
    // Staff still sees the unresolved profile; the personal-view copy changes no evidence.
    view.rerender(content(false));
    expect(screen.getByText(messages.academics.needsConfirmation)).toBeTruthy();
    expect(mock.details.owner?.academic.needsConfirmation).toBe(true);
  },
);
async function review() {
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "account" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review Link" }));
  await screen.findByRole("checkbox", {
    name: en.tuteeHistory.confirmIdentity,
  });
}

it.each(["en", "zh"])(
  "retains loaded history during failed refresh and retries only the selected authority (%s)",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const refetch = vi.fn();
    const cached = mock.staffDetails({}, {}).data;
    mock.staffDetails.mockReturnValue({
      data: cached,
      error: { message: "Failed background refresh" },
      isFetching: false,
      refetch,
    });
    const content = () => (
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <TuteeHistoryContent tuteeId="record" />
      </NextIntlClientProvider>
    );
    const view = render(content());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Taylor Tutor")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      messages.tuteeHistory.failed,
    );
    fireEvent.click(
      screen.getByRole("button", { name: messages.uiPatterns.retry }),
    );
    expect(refetch).toHaveBeenCalledOnce();
    mock.staffDetails.mockReturnValue({
      data: cached,
      isFetching: false,
      refetch,
    });
    view.rerender(content());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Taylor Tutor")).toBeTruthy();
  },
);

it("shows retry after an initial history failure and disables duplicate reads while fetching", () => {
  const refetch = vi.fn();
  mock.staffDetails.mockReturnValue({
    data: undefined,
    error: { message: "SIGNUP_RETRY" },
    isFetching: true,
    refetch,
  });
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TuteeHistoryContent tuteeId="record" />
    </NextIntlClientProvider>,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    en.tuteeHistory.HISTORY_RATE_LIMIT,
  );
  const retry = screen.getByRole<HTMLButtonElement>("button", {
    name: en.uiPatterns.retry,
  });
  expect(retry.disabled).toBe(true);
  fireEvent.click(retry);
  expect(refetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("table")).toBeNull();
});

it("keeps the personal-history dialog on its own retry endpoint", () => {
  const ownRefetch = vi.fn();
  const staffRefetch = vi.fn();
  mock.staffDetails.mockReturnValue({ data: undefined, refetch: staffRefetch });
  mock.ownDetails.mockReturnValue({
    data: undefined,
    error: { message: "Personal history unavailable" },
    refetch: ownRefetch,
  });
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TuteeHistoryDialog
        tuteeId="personal-record"
        personal
        onClose={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(ownRefetch).toHaveBeenCalledOnce();
  expect(staffRefetch).not.toHaveBeenCalled();
  expect(mock.staffDetails).toHaveBeenLastCalledWith(
    { tuteeId: "personal-record", page: 0 },
    { enabled: false, refetchOnMount: "always" },
  );
});

it.each([false, true])(
  "paginates staff/personal history without changing authority (personal=%s)",
  (personal) => {
    const cached = mock.staffDetails({}, {}).data as Record<string, unknown>;
    const query = personal ? mock.ownDetails : mock.staffDetails;
    query.mockReturnValue({
      data: { ...cached, count: 51 },
      isFetching: false,
    });
    const content = () => (
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <TuteeHistoryContent tuteeId="record" personal={personal} />
      </NextIntlClientProvider>
    );
    const view = render(content());
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.tuteeHistory.previous,
      }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.next }));
    expect(query).toHaveBeenLastCalledWith(
      { tuteeId: "record", page: 1 },
      { enabled: true, refetchOnMount: "always" },
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.tuteeHistory.next,
      }).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: en.tuteeHistory.previous }),
    );
    expect(query).toHaveBeenLastCalledWith(
      { tuteeId: "record", page: 0 },
      { enabled: true, refetchOnMount: "always" },
    );
    query.mockReturnValue({ data: { ...cached, count: 51 }, isFetching: true });
    view.rerender(content());
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.tuteeHistory.next,
      }).disabled,
    ).toBe(true);
  },
);
it("requires a concrete preview, identity acknowledgement and staff evidence, then discards preview on reselection", async () => {
  mount();
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  await review();
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Confirm Link",
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.tuteeHistory.confirmIdentity }),
  );
  expect(button.disabled).toBe(true);
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.evidence }),
    { target: { value: "Checked school archive and verified participant" } },
  );
  fireEvent.click(button);
  expect(mock.link).toHaveBeenCalledWith({
    tuteeId: "record",
    userId: "account",
    fingerprint: "a".repeat(64),
    reason: "Checked school archive and verified participant",
    acknowledged: true,
  });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
});
it("blocks an Admin from resolving a retained-owner conflict", async () => {
  mock.preview.mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Alex Historical", sessions: 6 },
    account: { name: "Alex Verified" },
    conflict: true,
    currentConflict: false,
  });
  mount();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "account" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review Link" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      en.tuteeHistory.HISTORY_HEAD_REQUIRED,
    ),
  );
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  expect(mock.link).not.toHaveBeenCalled();
});
it("does not claim a historical record on page load or before explicit confirmation", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <HistoryClaim token={"a".repeat(64)} />
    </NextIntlClientProvider>,
  );
  expect(mock.claim).not.toHaveBeenCalled();
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Link My History",
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.tuteeHistory.claimConfirm }),
  );
  fireEvent.click(button);
  expect(mock.claim).toHaveBeenCalledWith({ token: "a".repeat(64) });
});
it("provides the Head password action for a retained-owner correction", async () => {
  mock.preview.mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Alex Historical", sessions: 6 },
    account: { name: "Alex Verified" },
    conflict: true,
    currentConflict: false,
  });
  mount(true);
  await review();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.evidence }),
    {
      target: {
        value: "Verified correction against the original school archive",
      },
    },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.tuteeHistory.confirmIdentity }),
  );
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Confirm Link",
  });
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.password), {
    target: { value: "Synthetic-password!" },
  });
  fireEvent.click(button);
  expect(mock.link).toHaveBeenCalledWith(
    expect.objectContaining({
      confirmPassword: "Synthetic-password!",
      userId: "account",
    }),
  );
});
it("sends an exact-record invitation from the website with staff evidence", () => {
  mount();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.evidence }),
    {
      target: {
        value: "Verified identity and email against the school archive",
      },
    },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.email }),
    { target: { value: "new@example.test" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.sendInvitation }),
  );
  expect(mock.invite).toHaveBeenCalledWith({
    tuteeId: "record",
    email: "new@example.test",
    expectedUpdatedAt: row.updatedAt,
    reason: "Verified identity and email against the school archive",
  });
});

it("clears a completed ownership preview and refreshes dependent views while remaining mounted", async () => {
  mount();
  await review();
  expect(screen.getByRole("button", { name: "Confirm Link" })).toBeTruthy();
  await act(async () => {
    await mock.success!();
  });
  expect(mock.invalidate).toHaveBeenCalledTimes(7);
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  expect(screen.getByRole("button", { name: "Review Link" })).toBeTruthy();
});

it("retains an accepted link through failed synchronization and retries only reads", async () => {
  mount();
  await review();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.evidence }),
    {
      target: { value: "Checked school archive and verified participant" },
    },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.tuteeHistory.confirmIdentity }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm Link" }));
  expect(mock.link).toHaveBeenCalledOnce();
  mock.invalidate.mockRejectedValue(new Error("Read failed"));
  await act(async () => {
    await mock.success!();
  });
  expect(screen.getByText(en.tuteeHistory.linkRefreshFailed)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Review Link" })
      .disabled,
  ).toBe(true);
  let finish!: () => void;
  const recovery = new Promise<void>((resolve) => {
    finish = resolve;
  });
  mock.invalidate.mockImplementation(() => recovery);
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.refreshLinkedHistory }),
  );
  expect(screen.getByText(en.tuteeHistory.linkRefreshFailed)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.tuteeHistory.refreshLinkedHistory,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    finish();
  });
  await waitFor(() =>
    expect(screen.queryByText(en.tuteeHistory.linkRefreshFailed)).toBeNull(),
  );
  expect(mock.link).toHaveBeenCalledOnce();
});

/** Delivery receipts and current live invitations are deliberately independent. */
function invitationAttempt(
  status: InviteReceipt["status"],
  email = "new@example.test",
) {
  return {
    attemptId: "attempt-1",
    status,
    expiresAt: status === "PUBLISHED" ? new Date("2026-10-26T00:00:00Z") : null,
    email,
  };
}
function fillInvitation(messages = en) {
  fireEvent.change(screen.getByLabelText(messages.tuteeHistory.evidence), {
    target: { value: "Verified identity against the original school archive" },
  });
  fireEvent.change(screen.getByLabelText(messages.tuteeHistory.email), {
    target: { value: "new@example.test" },
  });
  return screen.getByLabelText(messages.tuteeHistory.email).closest("form")!;
}

it.each(["en", "zh"] as const)(
  "reports each delivery outcome truthfully and preserves drafts (%s)",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    for (const status of [
      "PUBLISHED",
      "DELIVERY_FAILED",
      "SUPERSEDED",
      "UNCERTAIN",
    ] as const) {
      mount(false, locale);
      const form = fillInvitation(messages);
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect(mock.invite).toHaveBeenCalledOnce();
      const attempt = invitationAttempt(status);
      mock.invitation = {
        invitation:
          status === "PUBLISHED"
            ? { email: attempt.email, expiresAt: attempt.expiresAt! }
            : null,
        attempt,
        revision: "revision-1",
      };
      await act(async () => {
        await mock.inviteSuccess!(attempt, { email: attempt.email });
        mock.inviteSettled!();
      });
      expect(
        screen.getByText(messages.tuteeHistory[`invitation_${status}`]),
      ).toBeTruthy();
      expect(screen.queryByText(messages.tuteeHistory.sent)).toBeNull();
      expect(
        screen.getByLabelText<HTMLInputElement>(messages.tuteeHistory.email)
          .value,
      ).toBe("new@example.test");
      expect(
        screen.getByLabelText<HTMLTextAreaElement>(
          messages.tuteeHistory.evidence,
        ).value,
      ).toContain("original school archive");
      const send = screen.getByRole<HTMLButtonElement>("button", {
        name: messages.tuteeHistory.sendInvitation,
      });
      expect(send.disabled).toBe(
        status === "PUBLISHED" || status === "UNCERTAIN",
      );
      fireEvent.change(screen.getByLabelText(messages.tuteeHistory.email), {
        target: { value: "changed@example.test" },
      });
      expect(send.disabled).toBe(status === "UNCERTAIN");
      if (status === "UNCERTAIN") {
        fireEvent.submit(form);
        expect(mock.invite).toHaveBeenCalledOnce();
      }
      cleanup();
      mock.invite.mockClear();
      mock.invitation = null;
    }
  },
);

it.each(["en", "zh"] as const)(
  "recovers an accepted write through reads only after refresh fails (%s)",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    mount(false, locale);
    const form = fillInvitation(messages);
    fireEvent.submit(form);
    const attempt = invitationAttempt("PUBLISHED");
    mock.invitationRefetch.mockRejectedValueOnce(
      new Error("Network unavailable"),
    );
    await act(async () => {
      await mock.inviteSuccess!(attempt, { email: attempt.email });
      mock.inviteSettled!();
    });
    expect(
      screen.getByText(messages.tuteeHistory.invitation_PUBLISHED),
    ).toBeTruthy();
    expect(
      screen.getByText(messages.tuteeHistory.invitationRefreshFailed),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(messages.tuteeHistory.email), {
      target: { value: "changed@example.test" },
    });
    fireEvent.submit(form);
    expect(mock.invite).toHaveBeenCalledOnce();
    mock.invitation = {
      invitation: { email: attempt.email, expiresAt: attempt.expiresAt! },
      attempt,
      revision: "revision-new",
    };
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.tuteeHistory.refreshInvitation,
        }),
      );
    });
    expect(mock.invitationRefetch).toHaveBeenCalledTimes(2);
    expect(mock.invite).toHaveBeenCalledOnce();
    expect(
      screen.queryByText(messages.tuteeHistory.invitationRefreshFailed),
    ).toBeNull();
  },
);

it.each(["en", "zh"] as const)(
  "cancels an uncertain first send without a live invitation and clears its guard (%s)",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    mock.invitation = {
      invitation: null,
      attempt: invitationAttempt("UNCERTAIN"),
      revision: "pending-revision",
    };
    mount(false, locale);
    const form = fillInvitation(messages);
    fireEvent.submit(form);
    expect(mock.invite).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.tuteeHistory.cancelInvitation,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.tuteeHistory.cancelInvitation,
      }),
    );
    expect(mock.cancel).toHaveBeenCalledExactlyOnceWith({
      tuteeId: "record",
      revision: "pending-revision",
    });
    mock.invitation = {
      invitation: null,
      attempt: invitationAttempt("SUPERSEDED"),
      revision: "cancelled-revision",
    };
    await act(async () => {
      await mock.cancelSuccess!({ cancelled: true });
      mock.cancelSettled!();
    });
    expect(
      screen.getByText(messages.tuteeHistory.invitationCancelled),
    ).toBeTruthy();
    fireEvent.submit(form);
    expect(mock.invite).toHaveBeenCalledOnce();
  },
);

it("requires explicit read recovery after a stale cancellation, preserving its draft and not adopting a fresh revision", async () => {
  mock.invitation = {
    invitation: null,
    attempt: invitationAttempt("UNCERTAIN"),
    revision: "old-revision",
  };
  const view = mount();
  fillInvitation();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  act(() => {
    mock.cancelError!({ message: "HISTORY_STALE" });
    mock.cancelSettled!();
  });
  mock.invitation = {
    invitation: null,
    attempt: invitationAttempt("UNCERTAIN"),
    revision: "new-revision",
  };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TuteeHistoryLinkForm row={row} canCorrectOwnership={false} onLinked={vi.fn()} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  expect(mock.cancel).toHaveBeenCalledExactlyOnceWith({
    tuteeId: "record",
    revision: "old-revision",
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.tuteeHistory.refreshInvitation }),
    );
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  expect(mock.cancel).toHaveBeenLastCalledWith({
    tuteeId: "record",
    revision: "new-revision",
  });
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.tuteeHistory.evidence).value,
  ).toContain("original school archive");
});

it.each(["en", "zh"] as const)(
  "retries initial read failures and hides cached receipts only after authoritative denial (%s)",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    mock.invitation = undefined;
    mock.invitationError = { message: "Offline" };
    const view = mount(false, locale);
    const form = fillInvitation(messages);
    fireEvent.submit(form);
    expect(mock.invite).not.toHaveBeenCalled();
    mock.invitation = {
      invitation: null,
      attempt: invitationAttempt("UNCERTAIN", "private@example.test"),
      revision: "r",
    };
    mock.invitationError = null;
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.tuteeHistory.refreshInvitation,
        }),
      );
    });
    expect(screen.getByText(/private@example.test/)).toBeTruthy();
    const content = () => (
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="UTC"
      >
        <TuteeHistoryLinkForm row={row} canCorrectOwnership={false} onLinked={vi.fn()} />
      </NextIntlClientProvider>
    );
    mock.invitationError = { message: "Offline" };
    view.rerender(content());
    expect(screen.getByText(/private@example.test/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.tuteeHistory.cancelInvitation,
      }),
    );
    expect(mock.cancel).not.toHaveBeenCalled();
    mock.invitationError = {
      message: "Access revoked",
      data: { code: "FORBIDDEN" },
    };
    view.rerender(content());
    expect(screen.queryByText(/private@example.test/)).toBeNull();
    expect(
      screen.queryByText(messages.tuteeHistory.invitation_UNCERTAIN),
    ).toBeNull();
    expect(
      screen.getByText(messages.tuteeHistory.invitationDenied),
    ).toBeTruthy();
    fireEvent.submit(form);
    expect(mock.invite).not.toHaveBeenCalled();
  },
);

it("blocks resending an unknown mutation outcome even after editing the recipient, then recovers only by status read", async () => {
  mount();
  const form = fillInvitation();
  fireEvent.submit(form);
  act(() => {
    mock.inviteError!(
      { message: "Response lost" },
      { email: "new@example.test" },
    );
    mock.inviteSettled!();
  });
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.email), {
    target: { value: "changed@example.test" },
  });
  fireEvent.submit(form);
  expect(mock.invite).toHaveBeenCalledOnce();
  expect(screen.getByText(en.tuteeHistory.invitation_UNCERTAIN)).toBeTruthy();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.tuteeHistory.refreshInvitation }),
    );
  });
  expect(mock.invite).toHaveBeenCalledOnce();
  expect(screen.queryByText(en.tuteeHistory.invitation_UNCERTAIN)).toBeNull();
  fireEvent.submit(form);
  expect(mock.invite).toHaveBeenCalledTimes(2);
});

it("does not present a historical published receipt as an active grant or block a new deliberate send", () => {
  mock.invitation = {
    invitation: null,
    attempt: invitationAttempt("PUBLISHED"),
    revision: "historical",
  };
  mount();
  const form = fillInvitation();
  expect(
    screen.queryByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  ).toBeNull();
  expect(screen.queryByText(/Expires:/)).toBeNull();
  fireEvent.submit(form);
  expect(mock.invite).toHaveBeenCalledOnce();
});

it("keeps the initiating dialog busy through SMTP and releases dismissal after a failed read, without latching sibling pending", async () => {
  const close = vi.fn();
  const content = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <Modal title="Invitation editor" onClose={close} footer={null}>
        <TuteeHistoryLinkForm row={row} canCorrectOwnership={false} onLinked={vi.fn()} />
      </Modal>
    </NextIntlClientProvider>
  );
  const view = render(content());
  const form = fillInvitation();
  fireEvent.submit(form);
  mock.invitePending = true;
  view.rerender(content());
  const dialog = screen.getByRole("dialog", { name: "Invitation editor" });
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  mock.invitationRefetch.mockRejectedValueOnce(new Error("Read failed"));
  await act(async () => {
    await mock.inviteSuccess!(invitationAttempt("PUBLISHED"), {
      email: "new@example.test",
    });
    mock.inviteSettled!();
  });
  mock.invitePending = false;
  view.rerender(content());
  expect(dialog.getAttribute("aria-busy")).not.toBe("true");
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  expect(mock.invite).toHaveBeenCalledOnce();
});

it("retains an existing live invitation while a replacement fails, and makes full cancellation scope explicit", () => {
  mock.invitation = {
    invitation: {
      email: "old@example.test",
      expiresAt: new Date("2026-10-26T00:00:00Z"),
    },
    attempt: invitationAttempt("DELIVERY_FAILED"),
    revision: "old-still-live",
  };
  mount();
  expect(screen.getByText(/old@example.test/)).toBeTruthy();
  expect(
    screen.getByText(en.tuteeHistory.invitation_DELIVERY_FAILED),
  ).toBeTruthy();
  expect(screen.getByText(en.tuteeHistory.cancelInvitationHelp)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  expect(mock.cancel).toHaveBeenCalledWith({
    tuteeId: "record",
    revision: "old-still-live",
  });
});

it.each(["status", "candidates", "preview", "link"] as const)(
  "conceals cached candidate and preview details after %s authority is revoked",
  async (source) => {
    const view = mount();
    await review();
    expect(screen.getByText(/Link Alex Historical/)).toBeTruthy();
    if (source === "status")
      mock.invitationError = { message: "Denied", data: { code: "FORBIDDEN" } };
    if (source === "candidates")
      mock.candidateError = {
        message: "Denied",
        data: { code: "UNAUTHORIZED" },
      };
    if (source === "preview") {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "account" },
      });
      mock.preview.mockRejectedValueOnce(
        Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: en.tuteeHistory.preview }),
        );
      });
    }
    if (source === "link") {
      // The real mutation callback is captured separately from its transport mock.
      act(() =>
        mock.linkError!({ message: "Denied", data: { code: "FORBIDDEN" } }),
      );
    }
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <TuteeHistoryLinkForm row={row} canCorrectOwnership={false} onLinked={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Link Alex Historical/)).toBeNull();
    expect(screen.queryByText(/alex@example.test/)).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.tuteeHistory.preview,
      }).disabled,
    ).toBe(true);
  },
);

it("detects a failed refetch result even when its promise resolves, and does not replay the accepted write", async () => {
  mount();
  const form = fillInvitation();
  fireEvent.submit(form);
  mock.invitationRefetch.mockResolvedValueOnce({
    data: null,
    error: new Error("Read result failed"),
    isError: true,
  });
  await act(async () => {
    await mock.inviteSuccess!(invitationAttempt("DELIVERY_FAILED"), {
      email: "new@example.test",
    });
    mock.inviteSettled!();
  });
  expect(
    screen.getByText(en.tuteeHistory.invitationRefreshFailed),
  ).toBeTruthy();
  fireEvent.submit(form);
  expect(mock.invite).toHaveBeenCalledOnce();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.tuteeHistory.refreshInvitation }),
    );
  });
  expect(mock.invitationRefetch).toHaveBeenCalledTimes(2);
  expect(mock.invite).toHaveBeenCalledOnce();
  fireEvent.submit(form);
  expect(mock.invite).toHaveBeenCalledTimes(2);
});

it.each([
  ["CONFLICT", "HISTORY_STALE"],
  ["PRECONDITION_FAILED", "HISTORY_EMAIL_UNAVAILABLE"],
] as const)(
  "does not describe an authoritative pre-delivery %s rejection as an uncertain send",
  (code, message) => {
    mount();
    const form = fillInvitation();
    fireEvent.submit(form);
    act(() => {
      mock.inviteError!(
        { message, data: { code } },
        { email: "new@example.test" },
      );
      mock.inviteSettled!();
    });
    expect(screen.queryByText(en.tuteeHistory.invitation_UNCERTAIN)).toBeNull();
    expect(screen.getByText(en.tuteeHistory[message])).toBeTruthy();
    fireEvent.submit(form);
    expect(mock.invite).toHaveBeenCalledOnce();
  },
);

it("uses an explicit successful status read to recover permission without losing the private draft", async () => {
  mock.invitation = {
    invitation: null,
    attempt: invitationAttempt("UNCERTAIN", "private@example.test"),
    revision: "r",
  };
  const view = mount();
  fillInvitation();
  act(() =>
    mock.linkError!({ message: "Denied", data: { code: "FORBIDDEN" } }),
  );
  expect(screen.queryByText(/private@example.test/)).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.tuteeHistory.refreshInvitation }),
    );
  });
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TuteeHistoryLinkForm row={row} canCorrectOwnership={false} onLinked={vi.fn()} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(/private@example.test/)).toBeTruthy();
  expect(screen.getByRole("combobox")).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.tuteeHistory.evidence).value,
  ).toContain("original school archive");
});

it("uses a newer background attempt instead of a previous local publication receipt", async () => {
  const view = mount();
  const form = fillInvitation();
  fireEvent.submit(form);
  const published = invitationAttempt("PUBLISHED");
  mock.invitation = {
    invitation: { email: published.email, expiresAt: published.expiresAt! },
    attempt: published,
    revision: "published",
  };
  await act(async () => {
    await mock.inviteSuccess!(published, { email: published.email });
    mock.inviteSettled!();
  });
  mock.invitation = {
    invitation: { email: published.email, expiresAt: published.expiresAt! },
    attempt: {
      ...invitationAttempt("UNCERTAIN", "replacement@example.test"),
      attemptId: "replacement",
    },
    revision: "replacement-pending",
  };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TuteeHistoryLinkForm row={row} canCorrectOwnership={false} onLinked={vi.fn()} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(en.tuteeHistory.invitation_UNCERTAIN)).toBeTruthy();
  expect(screen.queryByText(en.tuteeHistory.invitation_PUBLISHED)).toBeNull();
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.email), {
    target: { value: "third@example.test" },
  });
  fireEvent.submit(form);
  expect(mock.invite).toHaveBeenCalledOnce();
  expect(screen.getByText(/new@example.test/)).toBeTruthy();
  expect(screen.getByText(/replacement@example.test/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  expect(mock.cancel).toHaveBeenCalledExactlyOnceWith({
    tuteeId: "record",
    revision: "replacement-pending",
  });
});

it("preserves a resolved non-Error refetch denial code when concealing cached receipt evidence", async () => {
  mock.invitation = {
    invitation: null,
    attempt: invitationAttempt("UNCERTAIN", "private@example.test"),
    revision: "private-revision",
  };
  mount();
  expect(screen.getByText(/private@example.test/)).toBeTruthy();
  mock.invitationRefetch.mockResolvedValueOnce({
    data: mock.invitation,
    error: { message: "Denied", data: { code: "FORBIDDEN" } },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  await act(async () => {
    await mock.cancelSuccess!({ cancelled: true });
    mock.cancelSettled!();
  });
  expect(screen.queryByText(/private@example.test/)).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText(en.tuteeHistory.invitationDenied)).toBeTruthy();
});

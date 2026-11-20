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
import { NextIntlClientProvider } from "next-intl";
import { QueryClientProvider } from "@tanstack/react-query";
import type {
  InvalidateOptions,
  InvalidateQueryFilters,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { createQueryClient } from "~/trpc/query-client";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { emptyUserFilters } from "~/lib/user-filters";
import { userDirectoryView } from "~/lib/management-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import messages from "../../../../../messages/en.json";
import UsersPage from "./page";

type TransferInput = RouterInputs["personCombine"]["participationTransfer"];
type TransferReceipt = RouterOutputs["personCombine"]["participationTransfer"];
type TransferPreview = RouterOutputs["personCombine"]["participationPreview"];
type DetailsInput = RouterInputs["admin"]["accountDetails"];
type CandidatesInput = RouterInputs["personCombine"]["candidates"];

const fixture = vi.hoisted(() => ({
  transferred: false,
  groupMissing: false,
  groupChanged: false,
  displayName: "Original private login",
  affiliation: null as string | null,
  candidateWork: undefined as Promise<void> | undefined,
  detailReads: vi.fn<(input: DetailsInput) => void>(),
  directoryError: null as Error | null,
  preview: vi.fn<() => Promise<TransferPreview>>(),
  transfer: vi.fn<(input: TransferInput) => Promise<TransferReceipt>>(),
  outcome: vi.fn<
    (input: { operationId: string }) => Promise<TransferReceipt | null>
  >(),
  historyRefresh: vi.fn<() => Promise<void>>(),
}));

const personId = "retained-login-person";
const oldLoginId = "original-login";
const retainedLoginId = "retained-login";
const originalName = "Original private login";
const retainedName = "Canonical private login";
const exactSearch = "old.login";
const transferCopy = messages.personParticipationTransfer;
const combineCopy = messages.combineRecords;
const participationSources: TransferPreview["sources"] = [
  { kind: "TUTOR", id: "tutor-original", name: "Original Tutor" },
  { kind: "TUTOR", id: "tutor-active", name: "Canonical Tutor" },
  { kind: "TUTEE", id: "tutee-original", name: "Original Tutee" },
  { kind: "TUTEE", id: "tutee-active", name: "Canonical Tutee" },
];

function directoryMember(current: boolean, old: boolean) {
  return {
    userId: old ? oldLoginId : retainedLoginId,
    name: old ? fixture.displayName : retainedName,
    affiliation: old ? fixture.affiliation : null,
    username: old ? exactSearch : "canonical.login",
    role: "STUDENT",
    tutorId: current ? (old ? "tutor-original" : "tutor-active") : null,
    tutorStatus: current ? "ACTIVE" : null,
    tutorAccessRevoked: false,
    tuteeMember: current,
    currentTutee: current,
    hasTutorHistory: !current,
    hasTuteeHistory: !current,
    account: "registered",
    emailVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  };
}

function accountsData() {
  const original = directoryMember(!fixture.transferred, true);
  const canonical = directoryMember(true, false);
  return {
    caller: { id: "receipt-reviewer", role: "HEAD" },
    rows: [
      {
        ...(fixture.transferred ? canonical : original),
        personId,
        combinedRecordCount: 6,
        tutor: null,
        tutorHasEmail: false,
        suspended: false,
        academic: {},
        // One independent member must satisfy both the exact search and Tutor
        // filter. After handover only the other login has current participation.
        directoryMembers: [original, canonical],
        tutorDestinations: [],
      },
    ],
  };
}

function detailsData() {
  return {
    membership: null,
    attached: [],
    retained: [],
    group: fixture.groupMissing
      ? null
      : {
          id: fixture.groupChanged ? "refreshed-person" : personId,
          resolutionState: "GROUPED",
          users: [
            {
              id: oldLoginId,
              name: originalName,
              email: "original@example.test",
              role: "STUDENT",
              tutorId: fixture.transferred ? null : "tutor-original",
              tutor: fixture.transferred ? null : { status: "ACTIVE" },
            },
            {
              id: retainedLoginId,
              name: retainedName,
              email: "canonical@example.test",
              role: "STUDENT",
              tutorId: "tutor-active",
              tutor: { status: "ACTIVE" },
            },
          ],
          tutors: groupProfiles("tutor", "Tutor"),
          tutees: groupProfiles("tutee", "Tutee"),
        },
  };
}

function groupProfiles(kind: "tutor" | "tutee", label: string) {
  return ["original", "active"].map((source) => ({
    id: `${kind}-${source}`,
    englishName: `Private ${source === "original" ? "original" : "canonical"} ${label}`,
    status: source === "original" && fixture.transferred ? "TRANSFERRED" : "ACTIVE",
  }));
}

const candidates = [
  {
    ref: { kind: "USER", id: retainedLoginId },
    name: retainedName,
    personId,
    hasLogin: true,
    email: "canonical@example.test",
    status: "TUTOR",
  },
  ...participationSources.map(({ kind, id, name }) => ({
    ref: { kind, id },
    name,
    personId,
    hasLogin: true,
    email: null,
    status: "ACTIVE",
  })),
];

function preview(): TransferPreview {
  return {
    personId,
    retainedUserId: retainedLoginId,
    activeTutorId: "tutor-active",
    activeTuteeId: "tutee-active",
    fingerprint: "a".repeat(64),
    canTransfer: true,
    blockers: [],
    sourceRestrictions: [],
    discipline: { validYellow: 0, validRed: 0, willRemove: false },
    accessChanges: [],
    sources: participationSources,
    assignments: [],
    publishedWork: [],
    qualificationTuples: [],
    preferences: {
      willingnessSourceTutorId: "tutor-active",
      availabilitySourceTutorId: "tutor-active",
      willingness: [],
      availability: [],
    },
    intake: [],
  };
}

const receipt = (operationId: string): TransferReceipt => ({
  ok: true,
  receiptId: operationId,
  personId,
  retainedUserId: retainedLoginId,
  tutorId: "tutor-active",
  tuteeId: "tutee-active",
  successorPairingIds: ["successor-pairing"],
});

vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  const mutation = {
    useMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      reset: vi.fn(),
    }),
  };
  return {
    api: {
      useUtils: () => {
        const client = useQueryClient();
        const invalidate =
          (queryKey: QueryKey) =>
          (
            _input?: undefined,
            filters?: InvalidateQueryFilters,
            options?: InvalidateOptions,
          ) => client.invalidateQueries({ ...filters, queryKey }, options);
        return {
          account: { me: { invalidate: vi.fn() } },
          admin: {
            accounts: { invalidate: invalidate(accountsKey()) },
            accountDetails: {
              invalidate: invalidate([["admin", "accountDetails"]]),
            },
            appeals: { invalidate: invalidate(appealsKey()) },
            tutors: { invalidate: vi.fn() },
            tutees: { invalidate: vi.fn() },
          },
          personCombine: {
            invalidate: invalidate([["personCombine"]]),
            participationPreview: { fetch: fixture.preview },
            participationReceipt: { fetch: fixture.outcome },
          },
          tuteeHistory: { invalidate: fixture.historyRefresh },
        };
      },
      admin: {
        accounts: {
          _def: () => ({ path: ["admin", "accounts"] }),
          useQuery: () =>
            useQuery({ queryKey: accountsKey(), queryFn: readAccounts }),
        },
        accountDetails: {
          _def: () => ({ path: ["admin", "accountDetails"] }),
          useQuery: (
            input: DetailsInput,
            options: { refetchOnMount: "always" },
          ) =>
            useQuery({
              ...options,
              queryKey: getQueryKey(api.admin.accountDetails, input, "query"),
              queryFn: async () => {
                fixture.detailReads(input);
                return detailsData();
              },
            }),
        },
        appeals: {
          _def: () => ({ path: ["admin", "appeals"] }),
          useQuery: (_input: undefined, options: { enabled: boolean }) =>
            useQuery({
              ...options,
              queryKey: appealsKey(),
              queryFn: async () => [],
            }),
        },
        tutors: { useQuery: () => ({ data: [], isLoading: false }) },
        backfillStudentUsernames: mutation,
        suspendUser: mutation,
        reinstateUser: mutation,
        decideAppeal: mutation,
        sendTutorSetup: mutation,
      },
      personCombine: {
        candidates: {
          _def: () => ({ path: ["personCombine", "candidates"] }),
          useQuery: (
            input: CandidatesInput,
            options: { enabled: boolean; refetchOnMount: "always" },
          ) =>
            useQuery({
              ...options,
              queryKey: getQueryKey(api.personCombine.candidates, input, "query"),
              queryFn: async () => {
                await fixture.candidateWork;
                return candidates;
              },
            }),
        },
        participationTransfer: {
          useMutation: () => useMutation({ mutationFn: fixture.transfer }),
        },
      },
    },
  };
});

// Other editors retain their own suites. Keep the production route, details,
// transfer, query lifecycle and native-dialog implementation at this boundary.
vi.mock("~/app/_components/combine-records", () => ({ CombineRecords: () => null }));
vi.mock("~/app/_components/person-partition", () => ({ PersonPartition: () => null }));
vi.mock("~/app/_components/person-history-correction", () => ({ PersonHistoryCorrection: () => null }));
vi.mock("~/app/_components/historical-record-invitation", () => ({ HistoricalRecordInvitation: () => null }));
vi.mock("~/app/_components/account-deletion", () => ({ AccountDeletion: () => null }));
vi.mock("~/app/_components/acceptance-records", () => ({ AcceptanceRecords: () => null }));
vi.mock("~/app/_components/tutor-profile-editor", () => ({ TutorProfileEditor: () => null }));
vi.mock("~/app/_components/tutee-editor", () => ({ TuteeEditor: () => null }));
vi.mock("~/app/_components/tutor-details", () => ({
  TutorDetailsButton: () => <button>Tutor reader</button>,
}));
vi.mock("~/app/_components/tutee-history", () => ({ TuteeHistoryDialog: () => null }));
vi.mock("~/app/_components/account-profile-editor", async () => {
  const { ProfileDialog } = await import("~/app/_components/profile-dialog");
  return {
    AccountProfileEditor: ({ onClose }: { onClose: () => void }) => (
      <ProfileDialog title="Private profile editor" onClose={onClose}>
        <label>
          Private sibling profile draft
          <input defaultValue="Unsaved private draft" />
        </label>
      </ProfileDialog>
    ),
  };
});
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ dialog: null, confirm: vi.fn(), promptText: vi.fn() }),
}));

let queryClient: QueryClient;
const accountsKey = () => getQueryKey(api.admin.accounts, undefined, "query");
const appealsKey = () => getQueryKey(api.admin.appeals, undefined, "query");
const storageKey = viewStateKey(
  "receipt-reviewer:HEAD",
  "/admin/users",
  "user-directory-v1",
  "",
);
async function readAccounts() {
  if (fixture.directoryError) throw fixture.directoryError;
  return accountsData();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function mount() {
  const filters = emptyUserFilters();
  filters.role.include = ["TUTOR"];
  writeViewState(
    sessionStorage,
    storageKey,
    userDirectoryView(filters, exactSearch),
  );
  queryClient.setQueryData(accountsKey(), accountsData());
  queryClient.setQueryData(appealsKey(), []);
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SessionViewProvider
          identity="receipt-reviewer:HEAD"
          pathname="/admin/users"
          verified
        >
          <UsersPage />
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function openAndReview() {
  const page = mount();
  const opener = await screen.findByRole("button", {
    name: `${messages.accountProfile.showDetails}: ${originalName}`,
  });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog");
  const disclosure = (
    await within(dialog).findByText(transferCopy.title, { selector: "summary" })
  ).closest("details")!;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  for (const { id } of participationSources) {
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: new RegExp(id) }),
    );
  }
  fireEvent.click(
    within(dialog).getByRole("radio", { name: new RegExp(retainedLoginId) }),
  );
  fireEvent.change(
    within(dialog).getByRole("combobox", { name: transferCopy.activeTutor }),
    { target: { value: "tutor-active" } },
  );
  fireEvent.change(
    within(dialog).getByRole("combobox", { name: transferCopy.activeTutee }),
    { target: { value: "tutee-active" } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: transferCopy.review }));
  await within(dialog).findByRole("heading", { name: transferCopy.reviewTitle });
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: combineCopy.evidence }),
    { target: { value: "Reviewed both original and canonical participation" } },
  );
  fireEvent.change(within(dialog).getByLabelText(combineCopy.password), {
    target: { value: "Synthetic-password-773!" },
  });
  fireEvent.click(
    within(dialog).getByRole("checkbox", { name: transferCopy.acknowledge }),
  );
  return { ...page, opener, dialog };
}

async function submit(dialog: HTMLElement) {
  const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: transferCopy.confirm,
  });
  // Native button activation plus the controller's admission ref covers two
  // immediate activations before React can publish its disabled state.
  act(() => {
    confirm.click();
    confirm.click();
  });
  await waitFor(() => expect(fixture.transfer).toHaveBeenCalledTimes(1));
  const input = fixture.transfer.mock.calls[0]![0];
  expect(input).toMatchObject({
    personId,
    retainedUserId: retainedLoginId,
    activeTutorId: "tutor-active",
    activeTuteeId: "tutee-active",
    tutorIds: ["tutor-active", "tutor-original"],
    tuteeIds: ["tutee-active", "tutee-original"],
    acknowledged: true,
  });
  return input;
}

const operationText = (operationId: string) =>
  combineCopy.operationReference.replace("{id}", operationId);
const receiptText = (operationId: string) =>
  combineCopy.receipt.replace("{id}", operationId);
const closeButton = (dialog: HTMLElement) =>
  within(dialog).getByRole<HTMLButtonElement>("button", {
    name: messages.accountProfile.close,
  });

async function publishDirectoryRead() {
  // Complete a real Query read, so denial/recovery uses the same receipt
  // mechanism as production rather than a fabricated cached status.
  await act(async () => {
    await queryClient.refetchQueries(
      { queryKey: accountsKey(), exact: true },
      { throwOnError: false },
    );
  });
}

function expectRemovedOpener(opener: HTMLElement, dialog: HTMLElement) {
  expect(opener.isConnected).toBe(false);
  expect(screen.getByRole("dialog")).toBe(dialog);
  const directory = screen.getByRole("table", {
    name: messages.admin.users.title,
  });
  expect(within(directory).queryByRole("button", { name: /User details:/ })).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe(exactSearch);
  expect(JSON.parse(sessionStorage.getItem(storageKey)!) as unknown).toMatchObject({
    search: exactSearch,
    roleInclude: ["TUTOR"],
  });
}

beforeEach(() => {
  queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false, gcTime: Infinity },
  });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/admin/users");
  fixture.transferred = false;
  fixture.groupMissing = false;
  fixture.groupChanged = false;
  fixture.displayName = originalName;
  fixture.affiliation = null;
  fixture.candidateWork = undefined;
  fixture.detailReads.mockReset();
  fixture.directoryError = null;
  fixture.preview.mockReset().mockResolvedValue(preview());
  fixture.transfer
    .mockReset()
    .mockImplementation(async (input) => receipt(input.operationId));
  fixture.outcome.mockReset().mockResolvedValue(null);
  fixture.historyRefresh.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

it("refreshes the same login's displayed details without replacing its opening or query identity", async () => {
  mount();
  const opener = await screen.findByRole("button", {
    name: `${messages.accountProfile.showDetails}: ${originalName}`,
  });
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("table", { name: messages.usersDirectory.groupLogins });
  const detailKey = getQueryKey(api.admin.accountDetails, { userId: oldLoginId }, "query");
  const detailQuery = queryClient.getQueryCache().find({ queryKey: detailKey, exact: true });
  fixture.displayName = "Updated original login";
  fixture.affiliation = "Updated account affiliation";
  await publishDirectoryRead();

  expect(screen.getByRole("dialog", {
    name: messages.accountProfile.detailsTitle.replace("{name}", fixture.displayName),
  })).toBe(dialog);
  expect(within(dialog).getByText(/Updated account affiliation/)).toBeTruthy();
  expect(opener.isConnected).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe(exactSearch);
  expect(queryClient.getQueryCache().find({ queryKey: detailKey, exact: true })).toBe(detailQuery);
  expect(fixture.detailReads).toHaveBeenLastCalledWith({ userId: oldLoginId });
  expect(fixture.transfer).not.toHaveBeenCalled();

  fixture.directoryError = Object.assign(new Error("Synthetic directory denied"), {
    data: { code: "FORBIDDEN" },
  });
  await publishDirectoryRead();
  expect(screen.getByRole("dialog", { name: messages.admin.users.title })).toBe(dialog);
  expect(screen.queryByText(/Updated account affiliation/)).toBeNull();
  expect(screen.queryByText(fixture.displayName)).toBeNull();
});

it("retains the accepted BOTH receipt after exact-login filtering removes its opener and details lose the group", async () => {
  const pending = deferred<TransferReceipt>();
  fixture.transfer.mockReturnValue(pending.promise);
  fixture.historyRefresh.mockRejectedValueOnce(new Error("Sibling history offline"));
  const { opener, dialog } = await openAndReview();
  const input = await submit(dialog);
  fixture.transferred = true;
  fixture.groupMissing = true;
  await act(async () => pending.resolve(receipt(input.operationId)));
  await within(dialog).findByText(transferCopy.refreshFailed);

  expectRemovedOpener(opener, dialog);
  expect(within(dialog).getByText(transferCopy.saved)).toBeTruthy();
  expect(within(dialog).getByText(operationText(input.operationId))).toBeTruthy();
  expect(within(dialog).getByText(receiptText(input.operationId))).toBeTruthy();
  expect(queryClient.getQueryData(
    getQueryKey(api.admin.accountDetails, { userId: oldLoginId }, "query"),
  )).toMatchObject({ group: null });
  expect(queryClient.getQueryData(accountsKey())).toMatchObject({
    rows: [{ userId: retainedLoginId }],
  });

  fireEvent.click(
    within(dialog).getByRole("button", { name: transferCopy.refresh }),
  );
  await waitFor(() =>
    expect(within(dialog).queryByText(transferCopy.refreshFailed)).toBeNull(),
  );
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByText(receiptText(input.operationId))).toBeTruthy();
  expect(fixture.transfer).toHaveBeenCalledTimes(1);
  expect(fixture.historyRefresh).toHaveBeenCalledTimes(2);
  expect(closeButton(dialog).disabled).toBe(false);
  const search = screen.getByRole("searchbox");
  fireEvent.click(closeButton(dialog));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(search);
});

it.each(["missing", "different"] as const)(
  "allows only a freshly authorized frozen retry when the original group is %s",
  async (groupState) => {
    const pending = deferred<TransferReceipt>();
    fixture.transfer.mockReturnValue(pending.promise);
    const { dialog } = await openAndReview();
    const input = await submit(dialog);
    await act(async () => pending.reject(new Error("Synthetic response lost")));
    await within(dialog).findByText(combineCopy.uncertain);
    fireEvent.click(within(dialog).getByRole("button", { name: combineCopy.checkOutcome }));
    await within(dialog).findByText(combineCopy.notRecordedYet);
    fixture.groupMissing = groupState === "missing";
    fixture.groupChanged = groupState === "different";
    await act(async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: accountsKey(), exact: true }),
        queryClient.refetchQueries({ queryKey: [["admin", "accountDetails"]] }),
      ]);
    });
    const retry = within(dialog).getByRole<HTMLButtonElement>("button", { name: combineCopy.retryExact });
    expect(retry.disabled).toBe(true);
    expect(closeButton(dialog).disabled).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(fixture.transfer).toHaveBeenCalledTimes(1);
    for (const editor of within(dialog).getAllByRole<HTMLButtonElement>("button", {
      name: messages.accountProfile.editProfile,
    })) expect(editor.matches(":disabled")).toBe(true);

    const refreshCandidates = () => fireEvent.click(within(dialog).getByRole("button", {
      name: transferCopy.refresh,
    }));
    const password = () => within(dialog).getByLabelText<HTMLInputElement>(combineCopy.password);
    refreshCandidates();
    await waitFor(() => expect(password().matches(":disabled")).toBe(false));
    // A later parent read fences the lease even when it succeeds with the same
    // cached payload. It does not count as another explicit candidate refresh.
    await publishDirectoryRead();
    expect(password().matches(":disabled")).toBe(true);
    refreshCandidates();
    await waitFor(() => expect(password().matches(":disabled")).toBe(false));
    fireEvent.change(password(), { target: { value: "Fresh-frozen-password!" } });

    const background = deferred<void>();
    fixture.candidateWork = background.promise;
    let backgroundRead!: Promise<void>;
    act(() => {
      backgroundRead = queryClient.refetchQueries({
        queryKey: getQueryKey(api.personCombine.candidates, { search: "" }, "query"),
        exact: true,
      });
      // Try before React publishes the fetch's disabled state. The cache-event
      // fence must reject this old admission lease synchronously.
      retry.click();
    });
    expect(fixture.transfer).toHaveBeenCalledTimes(1);
    await act(async () => {
      background.resolve();
      await backgroundRead;
    });
    expect(retry.disabled).toBe(true);
    fixture.candidateWork = undefined;
    refreshCandidates();
    await waitFor(() => expect(password().matches(":disabled")).toBe(false));
    fireEvent.change(password(), { target: { value: "Fresh-frozen-password!" } });
    fixture.transfer.mockRejectedValueOnce(Object.assign(new Error("Synthetic stale original scope"), {
      data: { code: "CONFLICT" },
    }));
    fireEvent.click(retry);
    await within(dialog).findByText("Synthetic stale original scope");
    await waitFor(() => expect(closeButton(dialog).disabled).toBe(false));
    expect(fixture.transfer).toHaveBeenCalledTimes(2);
    expect(fixture.transfer.mock.calls[1]![0]).toEqual({
      ...input,
      confirmPassword: "Fresh-frozen-password!",
    });
    expect(within(dialog).getByText(operationText(input.operationId))).toBeTruthy();
    expect(screen.queryByText(combineCopy.uncertain)).toBeNull();
    fireEvent.click(closeButton(dialog));
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("recovers the original unknown operation through a removed opener and simultaneous directory denial without another transfer", async () => {
  const pending = deferred<TransferReceipt>();
  fixture.transfer.mockReturnValue(pending.promise);
  const { opener, dialog } = await openAndReview();
  const input = await submit(dialog);
  fixture.transferred = true;
  await publishDirectoryRead();
  expectRemovedOpener(opener, dialog);
  expect(closeButton(dialog).disabled).toBe(true);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);

  await act(async () => pending.reject(new Error("Synthetic response lost")));
  await within(dialog).findByText(combineCopy.uncertain);
  expect(within(dialog).getByText(operationText(input.operationId))).toBeTruthy();
  expect(closeButton(dialog).disabled).toBe(true);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);

  fixture.directoryError = Object.assign(new Error("Synthetic directory denied"), {
    data: { code: "FORBIDDEN" },
  });
  await publishDirectoryRead();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(originalName)).toBeNull();
  fireEvent.click(
    within(dialog).getByRole("button", { name: combineCopy.checkOutcome }),
  );
  await within(dialog).findByText(combineCopy.notRecordedYet);
  expect(within(dialog).getByText(operationText(input.operationId))).toBeTruthy();
  expect(closeButton(dialog).disabled).toBe(true);
  expect(fixture.transfer).toHaveBeenCalledTimes(1);

  const authorityRetry = messages.managementRecovery.retry.replace(
    "{section}", messages.admin.users.title,
  );
  const recoverAuthority = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: authorityRetry,
  });
  expect(recoverAuthority.disabled).toBe(false);
  fixture.directoryError = null;
  fireEvent.click(recoverAuthority);
  await waitFor(() =>
    expect(within(dialog).queryByRole("button", { name: authorityRetry })).toBeNull(),
  );
  // The admitted transfer still owns its separate denial latch. A deliberate
  // read of its candidates reauthorizes exact recovery without a new intent.
  fireEvent.click(
    within(dialog).getByRole("button", { name: transferCopy.refresh }),
  );
  await within(dialog).findByText(transferCopy.exactRetryHelp);
  fixture.outcome.mockResolvedValue(receipt(input.operationId));
  fireEvent.click(
    within(dialog).getByRole("button", { name: combineCopy.checkOutcome }),
  );
  await within(dialog).findByText(transferCopy.saved);
  await waitFor(() => expect(closeButton(dialog).disabled).toBe(false));
  expect(fixture.outcome).toHaveBeenCalledTimes(2);
  for (const call of fixture.outcome.mock.calls)
    expect(call).toEqual([{ operationId: input.operationId }, { staleTime: 0 }]);
  expect(fixture.transfer).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByText(receiptText(input.operationId))).toBeTruthy();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("searchbox"));
});

it("conceals private nested content on directory denial while retaining the safe receipt and idle Retry focus return", async () => {
  const pending = deferred<TransferReceipt>();
  fixture.transfer.mockReturnValue(pending.promise);
  fixture.historyRefresh.mockRejectedValue(new Error("Sibling history offline"));
  const { container, dialog } = await openAndReview();
  const input = await submit(dialog);
  fixture.transferred = true;
  await act(async () => pending.resolve(receipt(input.operationId)));
  await within(dialog).findByText(transferCopy.refreshFailed);
  await waitFor(() => expect(closeButton(dialog).disabled).toBe(false));
  const canonical = within(dialog)
    .getByRole("table", { name: messages.usersDirectory.groupLogins });
  const login = within(canonical).getByText(retainedName).closest("tr")!;
  fireEvent.click(
    within(login).getByRole("button", {
      name: messages.accountProfile.editProfile,
    }),
  );
  expect(screen.getByRole("dialog", { name: "Private profile editor" })).toBeTruthy();
  expect(screen.getByDisplayValue("Unsaved private draft")).toBeTruthy();

  fixture.directoryError = Object.assign(new Error("Synthetic directory denied"), {
    data: { code: "FORBIDDEN" },
  });
  await publishDirectoryRead();
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Private profile editor" })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: messages.admin.users.title })).toBe(dialog);
  expect(screen.queryByRole("table")).toBeNull();
  for (const marker of [originalName, retainedName, "Private original Tutor", "Private canonical Tutee", "Private sibling profile draft"]) {
    expect(screen.queryByText(marker)).toBeNull();
  }
  expect(screen.queryByDisplayValue("Unsaved private draft")).toBeNull();
  expect(within(dialog).getByText(operationText(input.operationId))).toBeTruthy();
  expect(within(dialog).getByText(receiptText(input.operationId))).toBeTruthy();
  expect(within(dialog).getByText(transferCopy.saved)).toBeTruthy();

  // An ordinary later failure must not turn the old successful cache into
  // renewed authority for either the directory or its retained private reader.
  fixture.directoryError = new Error("Synthetic network offline");
  await publishDirectoryRead();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(retainedName)).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Private profile editor" })).toBeNull();
  expect(within(dialog).getByText(receiptText(input.operationId))).toBeTruthy();
  expect(fixture.transfer).toHaveBeenCalledTimes(1);
  expect(closeButton(dialog).disabled).toBe(false);
  const retry = within(container).getByRole("button", {
    name: messages.uiPatterns.retry,
  });
  fireEvent.click(closeButton(dialog));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(retry);
});

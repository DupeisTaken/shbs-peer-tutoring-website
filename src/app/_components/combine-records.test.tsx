/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { CombineRecords } from "./combine-records";
import type { RouterInputs } from "~/trpc/react";

const fixture = vi.hoisted(() => ({
  preview: vi.fn(),
  mutate: vi.fn<(input: RouterInputs["personCombine"]["combine"]) => void>(),
  refresh: vi.fn<() => Promise<void>>(),
  receipt: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
  pending: vi.fn(),
  candidateError: null as null | { message: string; data?: { code: string } },
  candidateSuccess: true,
  candidateFetching: false,
  callbacks: null as null | {
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
        receipt: { fetch: fixture.receipt },
      },
    }),
    personCombine: {
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
  fixture.receipt.mockReset().mockResolvedValue(null);
  fixture.candidateError = null;
  fixture.candidateSuccess = true;
  fixture.candidateFetching = false;
});
afterEach(cleanup);
const element = (isHead = false, locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "en" ? en : zh}
    timeZone="UTC"
  >
    <CombineRecords isHead={isHead} onPendingChange={fixture.pending} />
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

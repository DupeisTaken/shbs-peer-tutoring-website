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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { TutorHistorySection } from "./tutor-history-link";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";

const mock = vi.hoisted(() => ({
  preview: vi.fn(),
  link: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
  close: vi.fn(),
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
        admin: { tutors: { invalidate: mock.refresh } },
        tuteeHistory: {
          myTutorRecords: { invalidate: mock.refresh },
          myTutorDetails: { invalidate: mock.refresh },
        },
        historicalAcademics: { invalidate: mock.refresh },
      }),
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
const ui = (locale = "en", siblingPending = false) => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
    >
      <ProfileDialog title="Tutor editor" onClose={mock.close}>
        <Sibling pending={siblingPending} />
        <TutorHistorySection tutorId="archive" />
      </ProfileDialog>
    </NextIntlClientProvider>
  </QueryClientProvider>
);
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
  expect(screen.getByLabelText<HTMLTextAreaElement>(copy.evidence).value).toContain(
    "Original archive",
  );
  expect(screen.queryByRole("button", { name: copy.confirm })).toBeNull();
  const details = screen
    .getByText(copy.title, { selector: "summary" })
    .closest("details")!;
  details.open = false;
  fireEvent(details, new Event("toggle"));
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByLabelText<HTMLTextAreaElement>(copy.evidence).value).toContain(
    "Original archive",
  );
  fireEvent.click(screen.getByRole("button", { name: copy.preview }));
  await screen.findByLabelText(copy.confirmIdentity);
  expect(screen.getByLabelText<HTMLInputElement>(copy.confirmIdentity).checked).toBe(false);
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

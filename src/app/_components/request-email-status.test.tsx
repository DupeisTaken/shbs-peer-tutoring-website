// @vitest-environment jsdom
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
import { RequestEmailStatus } from "./request-email-status";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  retry: vi.fn(),
  decline: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    notification: {
      requestEmailStatus: { useQuery: mocks.query },
      retryRequestEmail: { useMutation: () => ({ mutateAsync: mocks.retry }) },
      declineRequestAppeal: {
        useMutation: () => ({ mutateAsync: mocks.decline }),
      },
    },
  },
}));
const source = { kind: "application" as const, id: "request_123" };
const receipt = {
  retryEligible: true,
  status: "FAILED",
  requestVersion: 1,
  attempts: 5,
  leaseUntil: null,
  requestAppeal: null,
};
const appeal = {
  id: "appeal_123",
  body: "Private appeal evidence authorized to staff.",
  submittedAt: new Date(),
  status: "PENDING",
  reviewVersion: 0,
  decisionReason: null,
  notice: { requestVersion: 1 },
};
let query: {
  data: typeof receipt | Record<string, unknown> | undefined;
  error: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  refetch: typeof mocks.refresh;
};
function wrapper(canApply = true) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <RequestEmailStatus
        source={source}
        canApply={canApply}
        refreshSignal={false}
      />
    </NextIntlClientProvider>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  query = {
    data: receipt,
    error: null,
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    refetch: mocks.refresh,
  };
  mocks.query.mockImplementation(() => query);
  mocks.refresh.mockImplementation(async () => ({
    data: query.data,
    error: null,
  }));
  mocks.retry.mockResolvedValue({ queued: true });
  mocks.decline.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
it("reads source-specific state without flag writes and shows honest transport acceptance", () => {
  query.data = { ...receipt, status: "SENT" };
  render(wrapper());
  expect(screen.getByText(en.requestEmail.SENT)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.requestEmail.retrySend }),
  ).toBeNull();
  expect(mocks.retry).not.toHaveBeenCalled();
  expect(mocks.decline).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledWith(source, expect.any(Object));
});
it("distinguishes a failed initial read from a confirmed absence of receipts", () => {
  query.data = undefined;
  query.error = new Error("Unavailable");
  query.isSuccess = false;
  render(wrapper());
  expect(screen.queryByText(en.requestEmail.none)).toBeNull();
  expect(screen.getAllByText(en.requestEmail.unknown).length).toBeGreaterThan(
    0,
  );
});
it("makes a read-only coordinator review available without retry or decline controls", () => {
  query.data = { ...receipt, requestAppeal: appeal };
  render(wrapper(false));
  expect(screen.getByText(appeal.body)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.requestEmail.decline }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.requestEmail.retrySend }),
  ).toBeNull();
});
it("guards duplicate retries and recovers an accepted retry through reads only", async () => {
  const save = deferred<{ queued: boolean }>();
  mocks.retry.mockImplementationOnce(() => save.promise);
  mocks.refresh
    .mockResolvedValueOnce({ data: receipt, error: new Error("Unavailable") })
    .mockResolvedValueOnce({
      data: { ...receipt, status: "PENDING", attempts: 0 },
      error: null,
    });
  render(wrapper());
  const button = screen.getByRole("button", {
    name: en.requestEmail.retrySend,
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.retry).toHaveBeenCalledTimes(1);
  await act(async () => save.resolve({ queued: true }));
  await screen.findByText(en.requestEmail.queuedReadFailed);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.requestEmail.retrySend,
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.retryRead }),
  );
  await screen.findByText(en.requestEmail.queued);
  expect(mocks.retry).toHaveBeenCalledTimes(1);
});
it("does not report a no-op retry as queued", async () => {
  mocks.retry.mockResolvedValue({ queued: false });
  render(wrapper());
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.retrySend }),
  );
  await screen.findByText(en.requestEmail.retryUnchanged);
  expect(screen.queryByText(en.requestEmail.queued)).toBeNull();
});
it("pins decline reason/version through polling and reloads explicitly before a new appeal decision", async () => {
  query.data = { ...receipt, requestAppeal: appeal };
  const view = render(wrapper());
  fireEvent.change(
    screen.getByRole("textbox", { name: en.requestEmail.decisionReason }),
    { target: { value: "Reason for the first appeal only." } },
  );
  const newer = { ...appeal, id: "appeal_456", notice: { requestVersion: 3 } };
  query.data = { ...receipt, requestVersion: 3, requestAppeal: newer };
  view.rerender(wrapper());
  expect(screen.getByText(en.requestEmail.staleAppealDraft)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.decline }),
  );
  expect(mocks.decline).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Reason for the first appeal only.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.reloadAppeal }),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(""),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Reason for the new appeal." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.decline }),
  );
  await waitFor(() =>
    expect(mocks.decline).toHaveBeenCalledWith({
      ...source,
      appealId: newer.id,
      expectedReviewVersion: 0,
      reason: "Reason for the new appeal.",
    }),
  );
});
it("retains the original decision reason if explicit conflict reload fails", async () => {
  query.data = { ...receipt, requestAppeal: appeal };
  const view = render(wrapper());
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Retained original reason." },
  });
  query.data = { ...receipt, requestAppeal: { ...appeal, reviewVersion: 1 } };
  view.rerender(wrapper());
  mocks.refresh.mockResolvedValue({ error: new Error("Unavailable") });
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.reloadAppeal }),
  );
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Retained original reason.",
  );
  expect(screen.getByText(en.requestEmail.staleAppealDraft)).toBeTruthy();
});
it("conceals cached private appeal evidence after authoritative access revocation and later transport errors", async () => {
  query.data = { ...receipt, requestAppeal: appeal };
  const view = render(wrapper());
  expect(screen.getByText(appeal.body)).toBeTruthy();
  query.error = { data: { code: "FORBIDDEN" } };
  query.isSuccess = false;
  view.rerender(wrapper());
  await screen.findByText(en.requestEmail.denied);
  expect(screen.queryByText(appeal.body)).toBeNull();
  query.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  view.rerender(wrapper());
  expect(screen.queryByText(appeal.body)).toBeNull();
  expect(screen.getByText(en.requestEmail.denied)).toBeTruthy();
});

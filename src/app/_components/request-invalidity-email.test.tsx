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
import en from "../../../messages/en.json";
import { RequestInvalidity, RequestInvalidityHost } from "./request-invalidity";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  retry: vi.fn(),
  decline: vi.fn(),
  commit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    notification: {
      requestEmailStatus: { useQuery: mocks.read },
      retryRequestEmail: { useMutation: () => ({ mutateAsync: mocks.retry }) },
      declineRequestAppeal: {
        useMutation: () => ({ mutateAsync: mocks.decline }),
      },
    },
  },
}));
const record = {
  id: "request_123",
  isInvalid: true,
  invalidReason: "Original participant-facing reason",
  invalidatedAt: new Date("2026-10-01T03:00:00Z"),
  invalidatedByName: "Synthetic Admin",
  invalidityVersion: 1,
};
const appeal = {
  id: "appeal_123",
  body: "Original appeal evidence",
  submittedAt: new Date(),
  status: "PENDING",
  reviewVersion: 0,
  decisionReason: null,
  notice: { requestVersion: 1 },
};
const receipt = {
  retryEligible: true,
  status: "FAILED",
  attempts: 5,
  requestVersion: 1,
  leaseUntil: null,
  requestAppeal: appeal,
};
function ui() {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <RequestInvalidityHost>
        <RequestInvalidity
          record={record}
          name="Synthetic Applicant"
          canFlag
          reviewKey="application:request_123"
          onCommit={mocks.commit}
          onRefresh={async () => record}
        />
      </RequestInvalidityHost>
    </NextIntlClientProvider>
  );
}
function open() {
  fireEvent.click(
    screen.getByRole("button", { name: en.requestInvalidity.review }),
  );
}
function close() {
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.common.cancel,
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockReturnValue({
    data: receipt,
    isSuccess: true,
    isFetching: false,
    refetch: mocks.refresh,
  });
  mocks.refresh.mockResolvedValue({ data: receipt, error: null });
  mocks.decline.mockResolvedValue({ ok: true });
  mocks.retry.mockResolvedValue({ queued: true });
});
afterEach(cleanup);
it("retains the source-specific appeal reason and version through cancel and reopening", async () => {
  render(ui());
  open();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.requestEmail.decisionReason }),
    { target: { value: "Draft for the original appeal." } },
  );
  close();
  expect(screen.queryByRole("dialog")).toBeNull();
  open();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: en.requestEmail.decisionReason,
    }).value,
  ).toBe("Draft for the original appeal.");
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.decline }),
  );
  await waitFor(() =>
    expect(mocks.decline).toHaveBeenCalledWith({
      kind: "application",
      id: record.id,
      appealId: appeal.id,
      expectedReviewVersion: 0,
      reason: "Draft for the original appeal.",
    }),
  );
});
it("retains a failed decline and its reason through close and reopen", async () => {
  mocks.decline.mockRejectedValue(new Error("Synthetic failure"));
  render(ui());
  open();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.requestEmail.decisionReason }),
    { target: { value: "Retain this failed decision draft." } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.decline }),
  );
  await screen.findByText(en.requestEmail.declineFailed);
  close();
  open();
  expect(screen.getByText(en.requestEmail.declineFailed)).toBeTruthy();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: en.requestEmail.decisionReason,
    }).value,
  ).toBe("Retain this failed decision draft.");
});
it("retains accepted-write recovery across reopening and only reads on retry", async () => {
  mocks.refresh
    .mockResolvedValueOnce({ error: new Error("Read unavailable") })
    .mockResolvedValueOnce({
      data: {
        ...receipt,
        requestAppeal: { ...appeal, status: "DECLINED", reviewVersion: 1 },
      },
      error: null,
    });
  render(ui());
  open();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.requestEmail.decisionReason }),
    { target: { value: "A recorded decision reason." } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.decline }),
  );
  await screen.findByText(en.requestEmail.reviewReadFailed);
  close();
  open();
  expect(screen.getByText(en.requestEmail.reviewReadFailed)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.requestEmail.decline,
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.retryRead }),
  );
  await screen.findByText(en.requestEmail.declined);
  expect(mocks.decline).toHaveBeenCalledTimes(1);
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("blocks parent cancel while a child decision is pending", async () => {
  let finish!: (value: { ok: boolean }) => void;
  mocks.decline.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(ui());
  open();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.requestEmail.decisionReason }),
    { target: { value: "Reason with pending decision." } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.requestEmail.decline }),
  );
  close();
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => finish({ ok: true }));
  await screen.findByText(en.requestEmail.declined);
  close();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("retains access denial across closing and reopening until a fresh authoritative read succeeds", async () => {
  const view = render(ui());
  open();
  expect(screen.getByText(appeal.body)).toBeTruthy();
  mocks.read.mockReturnValue({
    data: receipt,
    error: { data: { code: "FORBIDDEN" } },
    isSuccess: false,
    isFetching: false,
    refetch: mocks.refresh,
  });
  view.rerender(ui());
  await screen.findByText(en.requestEmail.denied);
  expect(screen.queryByText(appeal.body)).toBeNull();
  close();
  mocks.read.mockReturnValue({
    data: receipt,
    error: { data: { code: "INTERNAL_SERVER_ERROR" } },
    isSuccess: false,
    isFetching: false,
    refetch: mocks.refresh,
  });
  open();
  expect(screen.getByText(en.requestEmail.denied)).toBeTruthy();
  expect(screen.queryByText(appeal.body)).toBeNull();
  mocks.read.mockReturnValue({
    data: receipt,
    error: null,
    isSuccess: true,
    isFetching: true,
    refetch: mocks.refresh,
  });
  view.rerender(ui());
  expect(screen.queryByText(appeal.body)).toBeNull();
  mocks.read.mockReturnValue({
    data: receipt,
    error: null,
    isSuccess: true,
    isFetching: false,
    refetch: mocks.refresh,
  });
  view.rerender(ui());
  await screen.findByText(appeal.body);
});

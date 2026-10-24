/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { HistoricalRecordInvitation } from "./historical-record-invitation";
import { ProfileDialog } from "./profile-dialog";
import type { RouterOutputs } from "~/trpc/react";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(), send: vi.fn(), cancel: vi.fn(), receipt: vi.fn(), refetch: vi.fn(), query: vi.fn(),
  error: null as null | { message: string; data?: { code: string } },
  status: null as RouterOutputs["tuteeHistory"]["exactInvitationStatus"],
  sendPending: false,
  callbacks: null as null | { onSuccess: (data: unknown) => Promise<void>; onError: (error: unknown) => void; onSettled: () => void },
}));
const sources = [{ kind: "TUTOR" as const, id: "tutor-history" }, { kind: "TUTEE" as const, id: "tutee-history" }];
const preview = { fingerprint: "a".repeat(64), sources: sources.map((source) => ({ ...source, name: source.kind === "TUTOR" ? "Original Tutor" : "Original Tutee" })), blocked: [], canInvite: true };
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ tuteeHistory: { previewExactInvitation: { fetch: mocks.preview }, exactInvitationReceipt: { fetch: mocks.receipt } } }),
  tuteeHistory: {
    exactInvitationStatus: { useQuery: (input: unknown) => { mocks.query(input); return { data: mocks.status, error: mocks.error, isFetching: false, isLoading: false, refetch: mocks.refetch }; } },
    inviteExact: { useMutation: (callbacks: typeof mocks.callbacks) => { mocks.callbacks = callbacks; return { mutate: mocks.send, isPending: mocks.sendPending }; } },
    cancelExactInvitation: { useMutation: () => ({ mutateAsync: mocks.cancel, isPending: false }) },
  },
} }));
vi.mock("./tutee-history", () => ({ HistoryError: ({ message }: { message: string }) => <p role="alert">{message}</p> }));

function view(locale: "en" | "zh" = "en", chosen = sources, accessDenied = false, onClose?: () => void) {
  const invitation = <HistoricalRecordInvitation sources={chosen} accessDenied={accessDenied} />;
  return <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC">
    {onClose ? <ProfileDialog title="Historical setup" onClose={onClose}>{invitation}</ProfileDialog> : invitation}
  </NextIntlClientProvider>;
}
async function review(locale: "en" | "zh" = "en") {
  const copy = locale === "en" ? en : zh;
  fireEvent.change(screen.getByLabelText(copy.tuteeHistory.email), { target: { value: "alumni@example.test" } });
  fireEvent.change(screen.getByLabelText(copy.combineRecords.evidence), { target: { value: "Verified original records with the recipient" } });
  fireEvent.click(screen.getByRole("button", { name: copy.historicalInvitation.review }));
  await screen.findByText("Original Tutor");
}
function send() {
  fireEvent.click(screen.getByLabelText(en.historicalInvitation.acknowledge));
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.sendInvitation }));
}
function uncertainStatus(attemptId: string, revision = "b".repeat(64)) {
  return {
    revision,
    invitation: null,
    attempt: { attemptId, status: "UNCERTAIN" as const, expiresAt: null, email: "alumni@example.test" },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = null;
  mocks.status = null;
  mocks.sendPending = false;
  mocks.preview.mockResolvedValue(preview);
  mocks.refetch.mockImplementation(async () => ({ data: mocks.status }));
  mocks.receipt.mockResolvedValue(null);
  mocks.cancel.mockResolvedValue({ cancelled: true });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(cleanup);

it.each(["en", "zh"] as const)("reviews exact Tutor/Tutee records before delivery in %s", async (locale) => {
  render(view(locale));
  await review(locale);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(screen.getByText("Original Tutee")).toBeTruthy();
  expect(mocks.preview).toHaveBeenCalledWith({ sources, email: "alumni@example.test" }, { staleTime: 0 });
  expect(screen.getByText((locale === "en" ? en : zh).historicalInvitation.consequences)).toBeTruthy();
});

it("freezes source scope across directory refreshes and clears review on recipient edits", async () => {
  const mounted = render(view());
  await review();
  mounted.rerender(view("en", [...sources, { kind: "TUTOR", id: "later-member" }]));
  send();
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ sources, email: "alumni@example.test", fingerprint: preview.fingerprint, operationId: expect.any(String) as unknown }));
  expect(mocks.query).toHaveBeenLastCalledWith({ sources });
  act(() => { mocks.callbacks!.onSettled(); });
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.email), { target: { value: "different@example.test" } });
  expect(screen.queryByText("Original Tutor")).toBeNull();
});

it("does not send a blocked or unacknowledged invitation", async () => {
  mocks.preview.mockResolvedValue({ ...preview, blocked: ["CURRENT_WORK"], canInvite: false });
  render(view());
  await review();
  send();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(screen.getByText(en.historicalInvitation.blocked.CURRENT_WORK)).toBeTruthy();
});

it("admits one send and recovers a lost response by reading its original receipt", async () => {
  render(view());
  await review();
  send();
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.sendInvitation }));
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string }).operationId;
  act(() => { mocks.callbacks!.onError({ message: "network interrupted" }); mocks.callbacks!.onSettled(); });
  mocks.receipt.mockResolvedValue({ attemptId: operationId, status: "PUBLISHED", expiresAt: new Date(), email: "alumni@example.test" });
  fireEvent.click(screen.getByRole("button", { name: en.historicalInvitation.checkReceipt }));
  await screen.findByText(en.tuteeHistory.invitation_PUBLISHED);
  expect(mocks.receipt).toHaveBeenCalledWith({ operationId }, { staleTime: 0 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("keeps a missing receipt uncertain instead of authorizing another send", async () => {
  render(view());
  await review();
  send();
  act(() => { mocks.callbacks!.onError({ message: "network interrupted" }); mocks.callbacks!.onSettled(); });
  fireEvent.click(screen.getByRole("button", { name: en.historicalInvitation.checkReceipt }));
  await screen.findByText(en.historicalInvitation.notRecorded);
  expect(screen.getByRole("button", { name: en.historicalInvitation.review }).matches(":disabled")).toBe(true);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("preserves the draft on a transient read failure and conceals denied evidence", async () => {
  const mounted = render(view());
  await review();
  mocks.error = { message: "temporary network failure" };
  mounted.rerender(view());
  expect(screen.getByText("Original Tutor")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>(en.tuteeHistory.email).value).toBe("alumni@example.test");
  mocks.error = { message: "forbidden", data: { code: "FORBIDDEN" } };
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
  mocks.error = { message: "temporary network failure" };
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
});

it("preserves denied authority when a refetch returns a serialized error", async () => {
  const mounted = render(view());
  await review();
  mocks.error = { message: "temporary network failure" };
  mounted.rerender(view());
  mocks.refetch.mockResolvedValueOnce({ error: { message: "forbidden", data: { code: "FORBIDDEN" } } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.refreshInvitation })); });
  expect(screen.queryByText("Original Tutor")).toBeNull();
  mocks.error = null;
  mounted.rerender(view());
  expect(screen.queryByText("Original Tutor")).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("keeps unresolved delivery receipts mounted and allows only receipt reads until publication is known", async () => {
  const close = vi.fn();
  render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string }).operationId;
  await act(async () => { await mocks.callbacks!.onSuccess({ attemptId: operationId, status: "UNCERTAIN", expiresAt: null }); mocks.callbacks!.onSettled(); });
  const closeButton = screen.getByRole<HTMLButtonElement>("button", { name: en.accountProfile.close });
  expect(closeButton.disabled).toBe(true);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  mocks.receipt.mockResolvedValue({ attemptId: operationId, status: "UNCERTAIN", expiresAt: null });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.historicalInvitation.checkReceipt })); });
  expect(closeButton.disabled).toBe(true);
  expect(screen.getByRole("button", { name: en.historicalInvitation.review }).matches(":disabled")).toBe(true);
  mocks.receipt.mockResolvedValue({ attemptId: operationId, status: "PUBLISHED", expiresAt: new Date() });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.historicalInvitation.checkReceipt })); });
  expect(closeButton.disabled).toBe(false);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.receipt).toHaveBeenCalledTimes(2);
});

it("cancels a durable uncertain attempt using its fresh revision without replaying delivery", async () => {
  const close = vi.fn();
  const mounted = render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string }).operationId;
  mocks.status = uncertainStatus(operationId);
  mocks.sendPending = true;
  mounted.rerender(view("en", sources, false, close));
  const parent = screen.getByRole("dialog", { name: "Historical setup" });
  const closeButton = within(parent).getByRole("button", { name: en.accountProfile.close });
  const cancelButton = within(parent).getByRole("button", { name: en.tuteeHistory.cancelInvitation });

  // Even a fresh durable status must not bypass the request's active SMTP fence.
  await act(async () => {
    await mocks.callbacks!.onSuccess({ attemptId: operationId, status: "UNCERTAIN", expiresAt: null });
  });
  expect(closeButton.matches(":disabled")).toBe(true);
  expect(cancelButton.matches(":disabled")).toBe(true);
  act(() => { mocks.callbacks!.onSettled(); });
  mocks.sendPending = false;
  mounted.rerender(view("en", sources, false, close));
  expect(closeButton.matches(":disabled")).toBe(false);
  expect(cancelButton.matches(":disabled")).toBe(false);
  expect(screen.getByRole("button", { name: en.historicalInvitation.review }).matches(":disabled")).toBe(true);

  let finishCancellation!: (value: { cancelled: boolean }) => void;
  mocks.cancel.mockImplementation(() => new Promise((resolve) => { finishCancellation = resolve; }));
  fireEvent.click(cancelButton);
  const confirmation = screen.getByRole("dialog", { name: en.tuteeHistory.cancelInvitation });
  const confirm = within(confirmation).getByRole("button", { name: en.tuteeHistory.cancelInvitation });
  expect(confirm.matches(":disabled")).toBe(false);
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(closeButton.matches(":disabled")).toBe(true);
  expect(confirm.matches(":disabled")).toBe(true);
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).toHaveBeenCalledWith({ sources, revision: "b".repeat(64) });
  mocks.status = { ...mocks.status, revision: "c".repeat(64), attempt: { ...mocks.status.attempt!, status: "SUPERSEDED" } };
  await act(async () => { finishCancellation({ cancelled: true }); });
  await within(confirmation).findByText(en.actionReview.applied);
  expect(closeButton.matches(":disabled")).toBe(false);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
});

it("recovers an accepted uncertain-attempt cancellation with reads after its refresh fails", async () => {
  const close = vi.fn();
  render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string }).operationId;
  act(() => { mocks.callbacks!.onError({ message: "network interrupted" }); mocks.callbacks!.onSettled(); });
  mocks.status = uncertainStatus(operationId);
  mocks.receipt.mockResolvedValue({ attemptId: operationId, status: "UNCERTAIN", expiresAt: null });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.historicalInvitation.checkReceipt })); });
  expect(mocks.receipt).toHaveBeenCalledWith({ operationId }, { staleTime: 0 });
  expect(mocks.refetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }));
  const confirmation = screen.getByRole("dialog", { name: en.tuteeHistory.cancelInvitation });
  mocks.refetch.mockRejectedValueOnce(new Error("refresh disconnected"));
  fireEvent.click(within(confirmation).getByRole("button", { name: en.tuteeHistory.cancelInvitation }));
  await within(confirmation).findByText(en.actionReview.refreshFailed);
  expect(screen.getByRole("button", { name: en.historicalInvitation.review }).matches(":disabled")).toBe(true);
  expect(within(confirmation).queryByRole("button", { name: en.tuteeHistory.cancelInvitation })).toBeNull();
  // Dismissing the confirmation keeps its accepted result and read recovery inline.
  fireEvent.click(within(confirmation).getByRole("button", { name: en.actionReview.close }));
  expect(screen.queryByRole("dialog", { name: en.tuteeHistory.cancelInvitation })).toBeNull();
  mocks.status = { ...mocks.status, revision: "c".repeat(64), attempt: { ...mocks.status.attempt!, status: "SUPERSEDED" } };
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.retry }));
  await screen.findByText(en.actionReview.applied);
  await waitFor(() => expect(screen.getByRole("button", { name: en.historicalInvitation.review }).matches(":disabled")).toBe(false));
  expect(mocks.refetch).toHaveBeenCalledTimes(3);
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).toHaveBeenCalledWith({ sources, revision: "b".repeat(64) });
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("does not use cached scope evidence to cancel a missing or mismatched receipt", async () => {
  const close = vi.fn();
  const mounted = render(view("en", sources, false, close));
  await review();
  send();
  const operationId = (mocks.send.mock.calls[0]![0] as { operationId: string }).operationId;
  mocks.status = uncertainStatus("another-attempt");
  act(() => { mocks.callbacks!.onError({ message: "network interrupted" }); mocks.callbacks!.onSettled(); });
  mounted.rerender(view("en", sources, false, close));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.historicalInvitation.checkReceipt })); });
  expect(mocks.refetch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }).matches(":disabled")).toBe(true);
  mocks.receipt.mockResolvedValue({ attemptId: operationId, status: "UNCERTAIN", expiresAt: null });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.historicalInvitation.checkReceipt })); });
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: en.accountProfile.close }).matches(":disabled")).toBe(true);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

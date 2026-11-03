/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState, type ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { PersonHistoryCorrection } from "./person-history-correction";
import { Modal } from "./ui/modal";

type Inventory = RouterOutputs["personCombine"]["historyCorrectionInventory"];
type Receipt = RouterOutputs["personCombine"]["historyCorrection"];
type Props = ComponentProps<typeof PersonHistoryCorrection>;
const fixture = vi.hoisted(() => ({
  inventory: vi.fn<(input: RouterInputs["personCombine"]["historyCorrectionInventory"], options?: unknown) => Promise<Inventory>>(),
  receipt: vi.fn<(input: { operationId: string }, options?: unknown) => Promise<Receipt | null>>(),
  mutate: vi.fn<(input: RouterInputs["personCombine"]["historyCorrection"]) => Promise<Receipt>>(),
  refresh: vi.fn<() => Promise<void>>(),
  refetch: vi.fn<() => Promise<{ error: Error | null }>>(),
  candidateError: null as Error | null,
  close: vi.fn(),
}));
const personId = "group-original";
const candidates = [
  { ref: { kind: "USER", id: "retired-original" }, name: "Original retired account", personId, status: "RETIRED", hasLogin: false, email: "original@example.test" },
  { ref: { kind: "USER", id: "other-group" }, name: "Other group retired account", personId: "other", status: "RETIRED", hasLogin: false, email: "other@example.test" },
  { ref: { kind: "USER", id: "live-reader" }, name: "Selected live reader", personId: "new-group", status: "STUDENT", hasLogin: true, email: "reader@example.test" },
];
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({
    admin: { accounts: { invalidate: fixture.refresh }, accountDetails: { invalidate: fixture.refresh }, tutors: { invalidate: fixture.refresh }, tutees: { invalidate: fixture.refresh } },
    personCombine: { invalidate: fixture.refresh, historyCorrectionInventory: { fetch: fixture.inventory }, historyCorrectionReceipt: { fetch: fixture.receipt } },
    tuteeHistory: { invalidate: fixture.refresh },
  }),
  personCombine: {
    candidates: { useQuery: () => ({ data: candidates, error: fixture.candidateError, isFetching: false, refetch: fixture.refetch }) },
    historyCorrection: { useMutation: () => ({ mutateAsync: fixture.mutate }) },
  },
} }));

const inventory = (recipientUserId: string | null = null): Inventory => ({
  personId, fingerprint: "b".repeat(64),
  sourceUsers: [{ id: "retired-original", name: "Original retired account", readerUserId: "old-reader" }],
  recipient: recipientUserId ? { id: recipientUserId, name: "Selected live reader", suspended: true, departed: false } : null,
  rows: [
    { entity: "Tutor", recordId: "historical-tutor", label: "Historical tutor evidence", readerUserId: "old-reader", provenance: "REVIEW_REQUIRED", assignable: true },
    { entity: "Tutee", recordId: "active-tutee", label: "Current tutee participation", readerUserId: "old-reader", provenance: "REVIEW_REQUIRED", assignable: false },
    { entity: "Notification", recordId: "original-notice", label: "Historical notice", readerUserId: "old-reader", provenance: "REVIEW_REQUIRED", assignable: true },
    { entity: "StudentQuarterBlock", recordId: "original-block", label: "Original quarter restriction", readerUserId: "old-reader", provenance: "REVIEW_REQUIRED", assignable: true },
  ],
});
const receipt = (receiptId: string): Receipt => ({ ok: true, receiptId, personId, destinationPersonId: "corrected-group", sourceUserIds: ["retired-original"] });
const serverError = (code: string) => Object.assign(new Error(`Synthetic ${code}`), { data: { code } });
const view = (props: Partial<Props> = {}, locale: "en" | "zh" = "en") => <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC"><PersonHistoryCorrection personId={personId} {...props} /></NextIntlClientProvider>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  fixture.inventory.mockReset().mockImplementation(async (input) => inventory(input.recipientUserId));
  fixture.receipt.mockReset().mockResolvedValue(null);
  fixture.mutate.mockReset().mockImplementation(async (input) => receipt(input.operationId));
  fixture.refresh.mockReset().mockResolvedValue(undefined);
  fixture.refetch.mockReset().mockResolvedValue({ error: null });
  fixture.candidateError = null;
  fixture.close.mockReset();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
});
afterEach(cleanup);
async function review(locale: "en" | "zh" = "en", withReader = false) {
  const copy = (locale === "en" ? en : zh).personHistoryCorrection;
  fireEvent.click(screen.getByRole("checkbox", { name: /retired-original/ }));
  if (withReader) fireEvent.click(screen.getByRole("radio", { name: /live-reader/ }));
  fireEvent.click(screen.getByRole("button", { name: copy.review }));
  await screen.findByRole("heading", { name: copy.reviewTitle });
}
function complete(locale: "en" | "zh" = "en") {
  const copy = locale === "en" ? en : zh;
  fireEvent.change(screen.getByRole("textbox", { name: copy.combineRecords.evidence }), { target: { value: "Reviewed exact original evidence and account ownership" } });
  fireEvent.change(screen.getByLabelText(copy.combineRecords.password), { target: { value: "Synthetic-password-460!" } });
  fireEvent.click(screen.getByRole("checkbox", { name: copy.personHistoryCorrection.acknowledge }));
}
function confirm(locale: "en" | "zh" = "en") {
  fireEvent.click(screen.getByRole("button", { name: (locale === "en" ? en : zh).personHistoryCorrection.confirm }));
}

it.each(["en", "zh"] as const)("shows the full before/after and exact decisions in %s", async (locale) => {
  render(view({}, locale));
  expect(screen.queryByRole("checkbox", { name: /other-group/ })).toBeNull();
  await review(locale, true);
  const copy = (locale === "en" ? en : zh).personHistoryCorrection;
  expect(screen.getByText(copy.recipientRestrictions)).toBeTruthy();
  expect(screen.getByText(copy.activeProfile)).toBeTruthy();
  expect(screen.getByText(copy.restrictionHelp)).toBeTruthy();
  const selects = screen.getAllByRole<HTMLSelectElement>("combobox");
  expect(selects).toHaveLength(4);
  expect(selects.every((select) => select.value === "RETAIN")).toBe(true);
  expect(within(selects[1]!).getAllByRole("option")).toHaveLength(1);
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("withholds ASSIGN when account history is quarantined", async () => {
  render(view()); await review();
  for (const select of screen.getAllByRole("combobox"))
    expect(within(select).queryByRole("option", { name: en.personHistoryCorrection.action.ASSIGN })).toBeNull();
  expect(fixture.inventory).toHaveBeenCalledWith({ personId, sourceUserIds: ["retired-original"], recipientUserId: null }, { staleTime: 0 });
});

it("submits every reviewed row once with exact source and recipient decisions", async () => {
  const pending = deferred<Receipt>(); fixture.mutate.mockReturnValue(pending.promise);
  render(view()); await review("en", true);
  fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "ASSIGN" } });
  fireEvent.change(screen.getAllByRole("combobox")[2]!, { target: { value: "QUARANTINE" } });
  complete();
  const button = screen.getByRole("button", { name: en.personHistoryCorrection.confirm });
  act(() => { button.click(); button.click(); });
  expect(fixture.mutate).toHaveBeenCalledTimes(1);
  const input = fixture.mutate.mock.calls[0]![0];
  expect(input).toMatchObject({ personId, sourceUserIds: ["retired-original"], recipientUserId: "live-reader", decisions: [
    { entity: "Tutor", recordId: "historical-tutor", action: "ASSIGN" },
    { entity: "Tutee", recordId: "active-tutee", action: "RETAIN" },
    { entity: "Notification", recordId: "original-notice", action: "QUARANTINE" },
    { entity: "StudentQuarterBlock", recordId: "original-block", action: "RETAIN" },
  ] });
  await act(async () => pending.resolve(receipt(input.operationId)));
  expect(await screen.findByText(en.personHistoryCorrection.saved)).toBeTruthy();
});

it("invalidates acknowledgement after changing a row decision", async () => {
  render(view()); await review("en", true); complete();
  fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "QUARANTINE" } });
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: en.personHistoryCorrection.acknowledge }).checked).toBe(false);
  confirm(); expect(fixture.mutate).not.toHaveBeenCalled();
});

it("requires a fresh inventory after a definite rejection while preserving the reason", async () => {
  fixture.mutate.mockRejectedValue(serverError("CONFLICT"));
  render(view()); await review(); complete(); confirm();
  await screen.findByText("Synthetic CONFLICT");
  expect(screen.queryByRole("heading", { name: en.personHistoryCorrection.reviewTitle })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.personHistoryCorrection.review }));
  await screen.findByRole("heading", { name: en.personHistoryCorrection.reviewTitle });
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: en.combineRecords.evidence }).value).toContain("Reviewed exact original");
  expect(screen.getByLabelText<HTMLInputElement>(en.combineRecords.password).value).toBe("");
  expect(fixture.mutate).toHaveBeenCalledTimes(1);
});

it("reads an uncertain outcome and retries only the frozen operation after a null receipt", async () => {
  fixture.mutate.mockRejectedValueOnce(new Error("Connection lost"));
  render(view()); await review("en", true); complete(); confirm();
  await screen.findByText(en.combineRecords.uncertain);
  const first = fixture.mutate.mock.calls[0]![0];
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome }));
  await screen.findByText(en.personHistoryCorrection.exactRetryHelp);
  expect(fixture.mutate).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText(en.combineRecords.password), { target: { value: "Fresh-password-460!" } });
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.retryExact }));
  await screen.findByText(en.personHistoryCorrection.saved);
  expect(fixture.mutate.mock.calls[1]![0]).toEqual({ ...first, confirmPassword: "Fresh-password-460!" });
});

it("recovers an accepted receipt without resending and preserves it after parent group changes", async () => {
  fixture.mutate.mockRejectedValueOnce(new Error("Connection lost"));
  const ui = render(view()); await review(); complete(); confirm();
  await screen.findByText(en.combineRecords.uncertain);
  fixture.receipt.mockResolvedValue(receipt(fixture.mutate.mock.calls[0]![0].operationId));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome }));
  await screen.findByText(en.personHistoryCorrection.saved);
  ui.rerender(view({ personId: "replacement-group" }));
  expect(screen.getByText(en.personHistoryCorrection.saved)).toBeTruthy();
  expect(fixture.mutate).toHaveBeenCalledTimes(1);
});

it("keeps accepted writes read-only after refresh failure", async () => {
  fixture.refresh.mockRejectedValue(new Error("Refresh failed"));
  render(view()); await review(); complete(); confirm();
  await screen.findByText(en.personHistoryCorrection.refreshFailed);
  fixture.refresh.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: en.personHistoryCorrection.refresh }));
  await waitFor(() => expect(screen.queryByText(en.personHistoryCorrection.refreshFailed)).toBeNull());
  expect(fixture.mutate).toHaveBeenCalledTimes(1);
});

it("drops a delayed preview when the owning group changes", async () => {
  const pending = deferred<Inventory>(); fixture.inventory.mockReturnValue(pending.promise);
  const ui = render(view());
  fireEvent.click(screen.getByRole("checkbox", { name: /retired-original/ }));
  fireEvent.click(screen.getByRole("button", { name: en.personHistoryCorrection.review }));
  ui.rerender(view({ personId: "replacement-group" }));
  ui.rerender(view());
  await act(async () => pending.resolve(inventory()));
  expect(screen.queryByRole("heading", { name: en.personHistoryCorrection.reviewTitle })).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("latches denied evidence until explicit fresh access reads and discards the old review", async () => {
  const ui = render(view()); await review();
  ui.rerender(view({ accessDenied: true }));
  expect(screen.queryByText("Historical tutor evidence")).toBeNull();
  ui.rerender(view({ accessDenied: false }));
  expect(screen.queryByText("Historical tutor evidence")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.personHistoryCorrection.refresh }));
  await waitFor(() => expect(fixture.refetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("heading", { name: en.personHistoryCorrection.reviewTitle })).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

function DialogFixture() {
  const [open, setOpen] = useState(true);
  const close = () => { fixture.close(); setOpen(false); };
  return <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {open && <Modal title="History correction" onClose={close} footer={<button onClick={close}>Cancel</button>}>
      <PersonHistoryCorrection personId={personId} />
    </Modal>}
  </NextIntlClientProvider>;
}

it.each(["cancel", "escape"])("dismisses an unsubmitted review with %s without writing", async (action) => {
  render(<DialogFixture />); await review(); complete();
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  else fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(fixture.close).toHaveBeenCalledOnce();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("blocks parent dismissal through pending and uncertain writes, releasing after receipt recovery", async () => {
  const pending = deferred<Receipt>(); fixture.mutate.mockReturnValue(pending.promise);
  render(<DialogFixture />); await review(); complete(); confirm();
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(fixture.close).not.toHaveBeenCalled();
  await act(async () => pending.reject(new Error("Response lost")));
  await screen.findByText(en.combineRecords.uncertain);
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
  fixture.receipt.mockResolvedValue(receipt(fixture.mutate.mock.calls[0]![0].operationId));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome }));
  await screen.findByText(en.personHistoryCorrection.saved);
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(false));
  expect(fixture.mutate).toHaveBeenCalledTimes(1);
});


it.each(["en", "zh"] as const)("reviews pending copies without forwarding and preserves observed effects in %s", async (locale) => {
  fixture.inventory.mockImplementation(async (input) => ({ ...inventory(input.recipientUserId), rows: [
    { entity: "EmailDelivery", recordId: "pending-copy", label: "Synthetic pending copy", readerUserId: "old-reader", provenance: "REVIEW_REQUIRED", assignable: true, deliveryStatus: "PENDING", sourceNotificationId: "original-notice" },
    { entity: "EmailDelivery", recordId: "sent-copy", label: "Synthetic sent copy", readerUserId: "old-reader", provenance: "REVIEW_REQUIRED", assignable: false, deliveryStatus: "SENT", sourceNotificationId: null },
  ] }));
  render(view({}, locale)); await review(locale, true);
  const copy = (locale === "en" ? en : zh).personHistoryCorrection;
  const selects = screen.getAllByRole("combobox");
  expect(within(selects[0]!).queryByRole("option", { name: copy.action.ASSIGN })).toBeNull();
  expect(within(selects[0]!).getByRole("option", { name: copy.action.QUARANTINE })).toBeTruthy();
  expect(within(selects[1]!).getAllByRole("option")).toHaveLength(1);
  expect(screen.getByText(copy.pendingEmailHelp)).toBeTruthy();
  expect(screen.getByText(copy.observedEmailHelp.replace("{status}", "SENT"))).toBeTruthy();
});

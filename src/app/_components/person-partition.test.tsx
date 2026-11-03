/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState, type ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { PersonPartition } from "./person-partition";
import { Modal } from "./ui/modal";

type Preview = RouterOutputs["personCombine"]["partitionPreview"];
type Receipt = RouterOutputs["personCombine"]["partition"];
type Props = ComponentProps<typeof PersonPartition>;
const fixture = vi.hoisted(() => ({
  preview: vi.fn<(input: RouterInputs["personCombine"]["partitionPreview"], options?: unknown) => Promise<Preview>>(),
  receipt: vi.fn<(input: { operationId: string }, options?: unknown) => Promise<Receipt | null>>(),
  mutate: vi.fn<(input: RouterInputs["personCombine"]["partition"]) => Promise<Receipt>>(),
  accounts: vi.fn<() => Promise<void>>(),
  details: vi.fn<() => Promise<void>>(),
  tutors: vi.fn<() => Promise<void>>(),
  tutees: vi.fn<() => Promise<void>>(),
  people: vi.fn<() => Promise<void>>(),
  history: vi.fn<() => Promise<void>>(),
  closed: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        accounts: { invalidate: fixture.accounts },
        accountDetails: { invalidate: fixture.details },
        tutors: { invalidate: fixture.tutors },
        tutees: { invalidate: fixture.tutees },
      },
      personCombine: {
        invalidate: fixture.people,
        partitionPreview: { fetch: fixture.preview },
        partitionReceipt: { fetch: fixture.receipt },
      },
      tuteeHistory: { invalidate: fixture.history },
    }),
    personCombine: {
      partitionSources: { useQuery: () => ({
        data: undefined, isLoading: false, isFetching: false, error: null,
        refetch: async () => ({ data: undefined, error: null }),
      }) },
      partition: { useMutation: () => ({ mutateAsync: fixture.mutate }) },
    },
  },
}));

const sources: Props["sources"] = [
  { ref: { kind: "TUTOR", id: "tutor-original" }, name: "Synthetic original tutor" },
  { ref: { kind: "TUTEE", id: "tutee-original" }, name: "Synthetic original tutee" },
  { ref: { kind: "USER", id: "login-original" }, name: "Synthetic existing login" },
];
const personId = "person-original";
const reason = "Reviewed original records and confirmed separate identities";
const password = "Synthetic-review-password-460!";
const refreshes = [fixture.accounts, fixture.details, fixture.tutors, fixture.tutees, fixture.people, fixture.history];
const preview = (): Preview => ({
  personId, fingerprint: "a".repeat(64), moving: [sources[0]!], remaining: sources.slice(1), blockers: [], canSplit: true,
});
const receipt = (receiptId = "accepted-partition"): Receipt => ({
  ok: true, receiptId, personId, newPersonId: "person-separated", sources: [sources[0]!.ref],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
const serverError = (code: string, message = "The reviewed records changed") => Object.assign(new Error(message), { data: { code } });
const element = (props: Partial<Props> = {}, locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC">
    <PersonPartition personId={personId} sources={sources} {...props} />
  </NextIntlClientProvider>
);

/** Exercise the real parent-dialog pending contract; browser tests own native top-layer behavior. */
function DialogFixture() {
  const [open, setOpen] = useState(true);
  const close = () => { fixture.closed(); setOpen(false); };
  return <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {open && <Modal title="Review source grouping" onClose={close} footer={<button onClick={close}>Cancel</button>}>
      <PersonPartition personId={personId} sources={sources} />
    </Modal>}
  </NextIntlClientProvider>;
}

beforeEach(() => {
  fixture.preview.mockReset().mockResolvedValue(preview());
  fixture.receipt.mockReset().mockResolvedValue(null);
  fixture.mutate.mockReset().mockImplementation(async (input) => receipt(input.operationId));
  fixture.closed.mockReset();
  for (const refresh of refreshes) refresh.mockReset().mockResolvedValue(undefined);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
});
afterEach(cleanup);

async function requestReview(locale: "en" | "zh" = "en") {
  const copy = (locale === "en" ? en : zh).personPartition;
  fireEvent.click(screen.getByRole("button", { name: copy.review }));
  await screen.findByRole("heading", { name: copy.reviewTitle });
}
async function selectAndReview(locale: "en" | "zh" = "en") {
  fireEvent.click(screen.getByRole("checkbox", { name: /tutor-original/ }));
  await requestReview(locale);
}
function completeReview(locale: "en" | "zh" = "en") {
  const copy = locale === "en" ? en : zh;
  fireEvent.change(screen.getByRole("textbox", { name: copy.combineRecords.evidence }), { target: { value: reason } });
  fireEvent.change(screen.getByLabelText(copy.combineRecords.password), { target: { value: password } });
  fireEvent.click(screen.getByRole("checkbox", { name: copy.personPartition.acknowledge }));
}
function confirm(locale: "en" | "zh" = "en") {
  fireEvent.click(screen.getByRole("button", { name: (locale === "en" ? en : zh).personPartition.confirm }));
}

it.each(["en", "zh"] as const)("reviews both exact resulting identities in %s before accepting a correction", async (locale) => {
  const copy = locale === "en" ? en : zh;
  render(element({}, locale));
  expect(screen.getByRole("button", { name: copy.personPartition.review }).matches(":disabled")).toBe(true);
  await selectAndReview(locale);
  expect(fixture.preview).toHaveBeenCalledWith({ personId, sources: [sources[0]!.ref] }, { staleTime: 0 });
  const moving = screen.getByRole("heading", { name: copy.personPartition.moving }).closest("section")!;
  const remaining = screen.getByRole("heading", { name: copy.personPartition.remaining }).closest("section")!;
  expect(within(moving).getByText(sources[0]!.name)).toBeTruthy();
  expect(within(moving).queryByText(sources[1]!.name)).toBeNull();
  expect(within(remaining).getByText(sources[1]!.name)).toBeTruthy();
  expect(within(remaining).getByText(sources[2]!.name)).toBeTruthy();
  expect(within(remaining).queryByText(sources[0]!.name)).toBeNull();
  expect(screen.getByText(copy.personPartition.consequences)).toBeTruthy();
  expect(screen.getByRole("button", { name: copy.personPartition.confirm }).matches(":disabled")).toBe(true);
  completeReview(locale);
  confirm(locale);
  await screen.findByText(copy.personPartition.saved);
  expect(fixture.mutate).toHaveBeenCalledOnce();
  const submitted = fixture.mutate.mock.calls[0]![0];
  expect(submitted).toMatchObject({ personId, sources: [sources[0]!.ref], fingerprint: "a".repeat(64), reason, confirmPassword: password, acknowledged: true });
  expect(submitted.operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(screen.queryByRole("button", { name: copy.personPartition.confirm })).toBeNull();
});

it("requires a nonempty proper subset and clears an obsolete review when selection changes", async () => {
  render(element());
  await selectAndReview();
  completeReview();
  fireEvent.click(screen.getByRole("checkbox", { name: /tutee-original/ }));
  expect(screen.queryByRole("heading", { name: en.personPartition.reviewTitle })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: /login-original/ }));
  expect(screen.getByRole("button", { name: en.personPartition.review }).matches(":disabled")).toBe(true);
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("admits only one same-turn preview and freezes source selection until it settles", async () => {
  const pending = deferred<Preview>();
  fixture.preview.mockReturnValue(pending.promise);
  render(element());
  fireEvent.click(screen.getByRole("checkbox", { name: /tutor-original/ }));
  const button = screen.getByRole("button", { name: en.personPartition.review });
  act(() => { button.click(); button.click(); });
  expect(fixture.preview).toHaveBeenCalledOnce();
  expect(screen.getByRole("checkbox", { name: /tutee-original/ }).matches(":disabled")).toBe(true);
  expect(fixture.mutate).not.toHaveBeenCalled();
  await act(async () => pending.resolve(preview()));
  await screen.findByRole("heading", { name: en.personPartition.reviewTitle });
  expect(screen.getByRole("checkbox", { name: /tutee-original/ }).matches(":disabled")).toBe(false);
});

it("blocks confirmation while its owning directory refresh is unavailable", async () => {
  const view = render(element());
  await selectAndReview();
  completeReview();
  view.rerender(element({ unavailable: true }));
  expect(screen.getByRole("button", { name: en.personPartition.confirm }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("textbox", { name: en.combineRecords.evidence }).matches(":disabled")).toBe(true);
  confirm();
  expect(fixture.mutate).not.toHaveBeenCalled();
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: en.combineRecords.evidence }).value).toBe(reason);
  expect(screen.getByRole("button", { name: en.personPartition.confirm }).matches(":disabled")).toBe(false);
});

it.each(["CURRENT_OWNER", "RETAINED_OWNER", "RETIRED_FAMILY"] as const)("explains %s edge cuts and prevents confirmation even with a complete draft", async (reasonCode) => {
  fixture.preview.mockResolvedValue({ ...preview(), canSplit: false, blockers: [{ reason: reasonCode, sources: [sources[0]!.ref, sources[2]!.ref] }] });
  render(element());
  await selectAndReview();
  expect(screen.getByText(en.personPartition.blocker[reasonCode])).toBeTruthy();
  completeReview();
  const button = screen.getByRole("button", { name: en.personPartition.confirm });
  expect(button.matches(":disabled")).toBe(true);
  fireEvent.click(button);
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it.each(["cancel", "escape"] as const)("dismisses a reviewed draft with %s without submitting anything", async (action) => {
  render(<DialogFixture />);
  await selectAndReview();
  completeReview();
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  else fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fixture.closed).toHaveBeenCalledOnce();
  expect(fixture.mutate).not.toHaveBeenCalled();
  expect(fixture.receipt).not.toHaveBeenCalled();
});

it("admits one same-turn confirmation, freezes its fields, and prevents dialog dismissal while pending", async () => {
  const pending = deferred<Receipt>();
  fixture.mutate.mockReturnValue(pending.promise);
  render(<DialogFixture />);
  await selectAndReview();
  completeReview();
  const confirmButton = screen.getByRole("button", { name: en.personPartition.confirm });
  act(() => { confirmButton.click(); confirmButton.click(); });
  expect(fixture.mutate).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: en.combineRecords.evidence }).matches(":disabled")).toBe(true);
  expect(screen.getByLabelText(en.combineRecords.password).matches(":disabled")).toBe(true);
  expect(screen.getByRole("checkbox", { name: en.personPartition.acknowledge }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("checkbox", { name: /tutor-original/ }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(fixture.closed).not.toHaveBeenCalled();
  await act(async () => pending.resolve(receipt(fixture.mutate.mock.calls[0]![0].operationId)));
  await screen.findByText(en.personPartition.saved);
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(false));
  expect(fixture.mutate).toHaveBeenCalledOnce();
});

it("retains the reason after a rejected save but requires a fresh review and password", async () => {
  fixture.mutate.mockRejectedValueOnce(serverError("CONFLICT", "Fresh review required"));
  render(element());
  await selectAndReview();
  completeReview();
  confirm();
  await screen.findByText("Fresh review required");
  expect(screen.queryByRole("button", { name: en.personPartition.confirm })).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /tutor-original/ }).checked).toBe(true);
  fixture.preview.mockResolvedValue({ ...preview(), fingerprint: "b".repeat(64) });
  await requestReview();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: en.combineRecords.evidence }).value).toBe(reason);
  expect(screen.getByLabelText<HTMLInputElement>(en.combineRecords.password).value).toBe("");
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: en.personPartition.acknowledge }).checked).toBe(false);
  expect(screen.getByRole("button", { name: en.personPartition.confirm }).matches(":disabled")).toBe(true);
  expect(fixture.preview).toHaveBeenCalledTimes(2);
  expect(fixture.mutate).toHaveBeenCalledOnce();
});

it("can recover an unknown outcome by repeated receipt reads without automatically resending", async () => {
  fixture.mutate.mockRejectedValue(new Error("Connection interrupted"));
  render(<DialogFixture />);
  await selectAndReview();
  completeReview();
  confirm();
  await screen.findByText(en.combineRecords.uncertain);
  const operationId = fixture.mutate.mock.calls[0]![0].operationId;
  expect(screen.queryByRole("button", { name: en.personPartition.confirm })).toBeNull();
  expect(screen.queryByRole("button", { name: en.personPartition.review })).toBeNull();
  expect(screen.queryByRole("textbox", { name: en.combineRecords.evidence })).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome }));
  await screen.findByText(en.combineRecords.notRecordedYet);
  expect(fixture.receipt).toHaveBeenLastCalledWith({ operationId }, { staleTime: 0 });
  expect(fixture.mutate).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: en.combineRecords.retryExact }).matches(":disabled")).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>(en.combineRecords.password).value).toBe("");
  fixture.receipt.mockResolvedValue(receipt(operationId));
  await waitFor(() => expect(screen.getByRole("button", { name: en.combineRecords.checkOutcome }).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome }));
  await screen.findByText(en.personPartition.saved);
  expect(fixture.receipt).toHaveBeenCalledTimes(2);
  expect(fixture.receipt).toHaveBeenLastCalledWith({ operationId }, { staleTime: 0 });
  expect(fixture.mutate).toHaveBeenCalledOnce();
  expect(fixture.preview).toHaveBeenCalledOnce();
});

it.each(["en", "zh"] as const)("requires a fresh password for explicit exact retry in %s and preserves the frozen intent", async (locale) => {
  const copy = locale === "en" ? en : zh;
  fixture.mutate.mockRejectedValueOnce(new Error("Original response lost"));
  const view = render(element({}, locale));
  await selectAndReview(locale);
  completeReview(locale);
  confirm(locale);
  await screen.findByText(copy.combineRecords.uncertain);
  const submitted = fixture.mutate.mock.calls[0]![0];
  expect(screen.queryByRole("button", { name: copy.combineRecords.retryExact })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: copy.combineRecords.checkOutcome }));
  await screen.findByText(copy.combineRecords.notRecordedYet);
  expect(fixture.mutate).toHaveBeenCalledOnce();
  const retry = screen.getByRole("button", { name: copy.combineRecords.retryExact });
  expect(retry.matches(":disabled")).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>(copy.combineRecords.password).value).toBe("");
  fireEvent.click(retry);
  expect(fixture.mutate).toHaveBeenCalledOnce();

  // A refreshed directory may add sources; retry still belongs to the reviewed
  // operation and cannot silently widen its selected source set.
  view.rerender(element({ sources: [...sources, { ref: { kind: "TUTOR", id: "later-source" }, name: "Later directory member" }] }, locale));
  expect(screen.queryByRole("textbox", { name: copy.combineRecords.evidence })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /later-source/ })).toBeNull();
  const freshPassword = "Fresh-synthetic-password-confirmation!";
  fireEvent.change(screen.getByLabelText(copy.combineRecords.password), { target: { value: freshPassword } });
  await waitFor(() => expect(screen.getByRole("button", { name: copy.combineRecords.retryExact }).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: copy.combineRecords.retryExact }));
  await screen.findByText(copy.personPartition.saved);
  expect(fixture.mutate).toHaveBeenCalledTimes(2);
  expect(fixture.mutate.mock.calls[1]![0]).toEqual({ ...submitted, confirmPassword: freshPassword });
  expect(fixture.preview).toHaveBeenCalledOnce();
  expect(fixture.receipt).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: copy.combineRecords.retryExact })).toBeNull();
});

it("reconciles delayed original completion through one exact retry despite same-turn repeat activation", async () => {
  // The transport failed while the original server transaction could still
  // commit. Its eventual receipt is also the result of the identical retry.
  const originalCompletion = deferred<Receipt>();
  fixture.mutate.mockRejectedValueOnce(new Error("Original transport timed out"))
    .mockImplementationOnce(() => originalCompletion.promise);
  render(<DialogFixture />);
  await selectAndReview();
  completeReview();
  confirm();
  await screen.findByText(en.combineRecords.uncertain);
  const submitted = fixture.mutate.mock.calls[0]![0];
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome }));
  await screen.findByText(en.combineRecords.notRecordedYet);
  const freshPassword = "Fresh-password-for-same-operation!";
  fireEvent.change(screen.getByLabelText(en.combineRecords.password), { target: { value: freshPassword } });
  const retry = screen.getByRole("button", { name: en.combineRecords.retryExact });
  await waitFor(() => expect(retry.matches(":disabled")).toBe(false));
  act(() => { retry.click(); retry.click(); });
  expect(fixture.mutate).toHaveBeenCalledTimes(2);
  expect(fixture.mutate.mock.calls[1]![0]).toEqual({ ...submitted, confirmPassword: freshPassword });
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: en.combineRecords.checkOutcome }).matches(":disabled")).toBe(true);
  expect(screen.queryByLabelText(en.combineRecords.password)).toBeNull();
  expect(screen.queryByRole("button", { name: en.combineRecords.retryExact })).toBeNull();
  await act(async () => originalCompletion.resolve(receipt(submitted.operationId)));
  await screen.findByText(en.personPartition.saved);
  expect(fixture.mutate).toHaveBeenCalledTimes(2);
  expect(fixture.receipt).toHaveBeenCalledOnce();
  expect(fixture.preview).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: en.combineRecords.retryExact })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(false));
});

it("keeps accepted receipt recovery read-only after a failed directory refresh", async () => {
  fixture.accounts.mockRejectedValueOnce(new Error("Directory refresh offline"));
  render(element());
  await selectAndReview();
  completeReview();
  confirm();
  await screen.findByText(en.personPartition.refreshFailed);
  expect(screen.getByText(en.personPartition.saved)).toBeTruthy();
  expect(screen.queryByRole("button", { name: en.personPartition.confirm })).toBeNull();
  expect(screen.queryByRole("button", { name: en.personPartition.review })).toBeNull();
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: en.personPartition.refresh }));
  await waitFor(() => expect(screen.queryByText(en.personPartition.refreshFailed)).toBeNull());
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(2);
  expect(fixture.mutate).toHaveBeenCalledOnce();
  expect(fixture.receipt).not.toHaveBeenCalled();
});

it("waits for every requested refresh before releasing the parent dialog after one failure", async () => {
  const slowRead = deferred<void>();
  fixture.accounts.mockRejectedValue(new Error("One refresh failed"));
  fixture.details.mockReturnValue(slowRead.promise);
  render(<DialogFixture />);
  await selectAndReview();
  completeReview();
  confirm();
  await screen.findByText(en.personPartition.saved);
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
  expect(screen.queryByText(en.personPartition.refreshFailed)).toBeNull();
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledOnce();
  await act(async () => slowRead.resolve(undefined));
  await screen.findByText(en.personPartition.refreshFailed);
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(false));
  expect(fixture.mutate).toHaveBeenCalledOnce();
});

it("conceals source evidence immediately when parent authority is lost", async () => {
  const view = render(element());
  await selectAndReview();
  completeReview();
  view.rerender(element({ accessDenied: true }));
  expect(screen.getByRole("heading", { name: en.combineRecords.denied })).toBeTruthy();
  for (const source of sources) expect(screen.queryByText(source.name)).toBeNull();
  expect(screen.queryByRole("heading", { name: en.personPartition.reviewTitle })).toBeNull();
  expect(screen.queryByLabelText(en.combineRecords.password)).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("conceals source evidence after the server denies a fresh preview", async () => {
  fixture.preview.mockRejectedValue(serverError("FORBIDDEN", "No longer authorized"));
  render(element());
  fireEvent.click(screen.getByRole("checkbox", { name: /tutor-original/ }));
  fireEvent.click(screen.getByRole("button", { name: en.personPartition.review }));
  await screen.findByRole("heading", { name: en.combineRecords.denied });
  for (const source of sources) expect(screen.queryByText(source.name)).toBeNull();
  expect(screen.queryByText("No longer authorized")).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("does not render a late preview when authority disappears during its request", async () => {
  const pending = deferred<Preview>();
  fixture.preview.mockReturnValue(pending.promise);
  const view = render(element());
  fireEvent.click(screen.getByRole("checkbox", { name: /tutor-original/ }));
  fireEvent.click(screen.getByRole("button", { name: en.personPartition.review }));
  view.rerender(element({ accessDenied: true }));
  await act(async () => pending.resolve(preview()));
  for (const source of sources) expect(screen.queryByText(source.name)).toBeNull();
  expect(screen.queryByRole("heading", { name: en.personPartition.reviewTitle })).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("discards a late preview response after the parent switches to another identity", async () => {
  const pending = deferred<Preview>();
  fixture.preview.mockReturnValue(pending.promise);
  const view = render(element());
  fireEvent.click(screen.getByRole("checkbox", { name: /tutor-original/ }));
  fireEvent.click(screen.getByRole("button", { name: en.personPartition.review }));
  view.rerender(element({ personId: "another-person" }));
  await act(async () => pending.resolve(preview()));
  expect(screen.queryByRole("heading", { name: en.personPartition.reviewTitle })).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /tutor-original/ }).checked).toBe(false);
  expect(screen.getByRole("button", { name: en.personPartition.review }).matches(":disabled")).toBe(true);
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("discards an already-reviewed plan when the parent switches identities", async () => {
  const view = render(element());
  await selectAndReview();
  completeReview();
  view.rerender(element({ personId: "another-person" }));
  expect(screen.queryByRole("heading", { name: en.personPartition.reviewTitle })).toBeNull();
  expect(screen.queryByRole("button", { name: en.personPartition.confirm })).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /tutor-original/ }).checked).toBe(false);
  expect(fixture.mutate).not.toHaveBeenCalled();
});

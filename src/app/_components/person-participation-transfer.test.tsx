/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState, type ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { PersonParticipationTransfer } from "./person-participation-transfer";
import { Modal } from "./ui/modal";

type Preview = RouterOutputs["personCombine"]["participationPreview"];
type Receipt = RouterOutputs["personCombine"]["participationTransfer"];
type Props = ComponentProps<typeof PersonParticipationTransfer>;
const fixture = vi.hoisted(() => ({
  preview: vi.fn<(input: RouterInputs["personCombine"]["participationPreview"], options?: unknown) => Promise<Preview>>(),
  receipt: vi.fn<(input: { operationId: string }, options?: unknown) => Promise<Receipt | null>>(),
  mutate: vi.fn<(input: RouterInputs["personCombine"]["participationTransfer"]) => Promise<Receipt>>(),
  refresh: vi.fn<() => Promise<void>>(), refetch: vi.fn<() => Promise<{ error: Error | null }>>(), close: vi.fn(),
}));
const personId = "person-active";
const candidates = [
  { ref: { kind: "USER", id: "retained-login" }, name: "Retained login", personId, status: "TUTOR", hasLogin: true, email: "retained@example.test" },
  { ref: { kind: "TUTOR", id: "tutor-original" }, name: "Original tutor", personId, status: "ACTIVE", hasLogin: true, email: "original@example.test" },
  { ref: { kind: "TUTOR", id: "tutor-active" }, name: "Active tutor", personId, status: "ACTIVE", hasLogin: false, email: "active@example.test" },
  { ref: { kind: "TUTEE", id: "tutee-active" }, name: "Active tutee", personId, status: "ACTIVE", hasLogin: true, email: "tutee@example.test" },
  { ref: { kind: "TUTOR", id: "other-person" }, name: "Another person", personId: "unrelated", status: "ACTIVE", hasLogin: true, email: "other@example.test" },
];
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({
    admin: { accounts: { invalidate: fixture.refresh }, accountDetails: { invalidate: fixture.refresh }, tutors: { invalidate: fixture.refresh }, tutees: { invalidate: fixture.refresh } },
    personCombine: { invalidate: fixture.refresh, participationPreview: { fetch: fixture.preview }, participationReceipt: { fetch: fixture.receipt } },
    tuteeHistory: { invalidate: fixture.refresh },
  }),
  personCombine: { candidates: { useQuery: () => ({ data: candidates, error: null, isFetching: false, refetch: fixture.refetch }) }, participationTransfer: { useMutation: () => ({ mutateAsync: fixture.mutate }) } },
} }));
const preview = (): Preview => ({
  personId, retainedUserId: "retained-login", activeTutorId: "tutor-active", activeTuteeId: "tutee-active", fingerprint: "c".repeat(64), canTransfer: true, blockers: [], sourceRestrictions: [],
  discipline: { validYellow: 0, validRed: 0, willRemove: false }, accessChanges: [],
  sources: [{ kind: "TUTOR", id: "tutor-original", name: "Original tutor" }, { kind: "TUTOR", id: "tutor-active", name: "Active tutor" }, { kind: "TUTEE", id: "tutee-active", name: "Active tutee" }],
  assignments: [{ id: "original-pairing", tutorId: "tutor-original", tuteeIds: ["tutee-active"], termId: "original-term", subject: "Original subject", dayOfWeek: 2, startMin: 900, endMin: 950, roomId: "original-room" }],
  publishedWork: [{ planId: "published-plan", originalDate: "2026-11-03", cohorts: [{ id: "published-cohort", status: "SCHEDULED", startsAt: new Date("2026-11-03T07:00:00Z") }], responses: [{ id: "original-response", state: "PENDING", deliveredAt: new Date("2026-11-01T07:00:00Z"), deadline: new Date("2026-11-02T07:00:00Z") }] }],
  qualificationTuples: [{ tutorId: "tutor-original", sourceSubjectId: "approved-source", subjectId: "eligible-subject" }],
  preferences: { willingnessSourceTutorId: "tutor-active", availabilitySourceTutorId: "tutor-active", willingness: [{ subjectId: "willing-subject", willing: false }], availability: [{ slotId: "original-slot", dayOfWeek: 2, startMin: 900, endMin: 950 }] },
  intake: [{ tuteeId: "tutee-active", intakeTermId: "intake-original-term", submittedAt: new Date("2026-08-01T00:00:00Z"), surveys: [{ id: "original-survey", intakeTermId: "intake-original-term", submittedAt: new Date("2026-08-01T00:00:00Z"), firstAssignedAt: new Date("2026-08-03T00:00:00Z") }] }],
});
const receipt = (receiptId: string): Receipt => ({ ok: true, receiptId, personId, retainedUserId: "retained-login", tutorId: "tutor-active", tuteeId: "tutee-active", successorPairingIds: ["successor-pairing"] });
const serverError = (code: string) => Object.assign(new Error(`Synthetic ${code}`), { data: { code } });
const view = (props: Partial<Props> = {}, locale: "en" | "zh" = "en") => <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC"><PersonParticipationTransfer personId={personId} {...props} /></NextIntlClientProvider>;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (failure: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  fixture.preview.mockReset().mockResolvedValue(preview()); fixture.receipt.mockReset().mockResolvedValue(null);
  fixture.mutate.mockReset().mockImplementation(async (input) => receipt(input.operationId)); fixture.refresh.mockReset().mockResolvedValue(undefined);
  fixture.refetch.mockReset().mockResolvedValue({ error: null }); fixture.close.mockReset();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
});
afterEach(cleanup);
function select(locale: "en" | "zh" = "en") {
  const copy = (locale === "en" ? en : zh).personParticipationTransfer;
  for (const id of ["tutor-original", "tutor-active", "tutee-active"]) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(id) }));
  fireEvent.click(screen.getByRole("radio", { name: /retained-login/ }));
  fireEvent.change(screen.getByRole("combobox", { name: copy.activeTutor }), { target: { value: "tutor-active" } });
  fireEvent.change(screen.getByRole("combobox", { name: copy.activeTutee }), { target: { value: "tutee-active" } });
}
async function review(locale: "en" | "zh" = "en") { const copy = (locale === "en" ? en : zh).personParticipationTransfer; select(locale); fireEvent.click(screen.getByRole("button", { name: copy.review })); await screen.findByRole("heading", { name: copy.reviewTitle }); }
function complete(locale: "en" | "zh" = "en") {
  const copy = locale === "en" ? en : zh;
  fireEvent.change(screen.getByRole("textbox", { name: copy.combineRecords.evidence }), { target: { value: "Reviewed original participation and exact future work" } });
  fireEvent.change(screen.getByLabelText(copy.combineRecords.password), { target: { value: "Synthetic-password-460!" } });
  fireEvent.click(screen.getByRole("checkbox", { name: copy.personParticipationTransfer.acknowledge }));
}
const confirm = (locale: "en" | "zh" = "en") => fireEvent.click(screen.getByRole("button", { name: (locale === "en" ? en : zh).personParticipationTransfer.confirm }));

it.each(["en", "zh"] as const)("reviews original work, exact grants, preferences and intake evidence in %s", async (locale) => {
  render(view({}, locale)); expect(screen.queryByRole("checkbox", { name: /other-person/ })).toBeNull(); await review(locale);
  for (const id of ["original-pairing", "published-plan", "original-response", "approved-source", "original-slot", "original-survey"]) expect(screen.getByText(new RegExp(id))).toBeTruthy();
  const copy = (locale === "en" ? en : zh).personParticipationTransfer;
  expect(screen.getByText(new RegExp(copy.unwilling))).toBeTruthy();
  expect(screen.getByText(copy.publishedHelp)).toBeTruthy(); expect(fixture.mutate).not.toHaveBeenCalled();
});

it("requires deliberate active choices and retains exact preference source selection", async () => {
  render(view());
  fireEvent.click(screen.getByRole("checkbox", { name: /tutor-original/ }));
  fireEvent.click(screen.getByRole("radio", { name: /retained-login/ }));
  expect(screen.getByRole("button", { name: en.personParticipationTransfer.review }).matches(":disabled")).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: en.personParticipationTransfer.activeTutor }), { target: { value: "tutor-original" } });
  fireEvent.change(screen.getByRole("combobox", { name: en.personParticipationTransfer.willingnessSource }), { target: { value: "tutor-original" } });
  fireEvent.click(screen.getByRole("button", { name: en.personParticipationTransfer.review }));
  await screen.findByRole("heading", { name: en.personParticipationTransfer.reviewTitle });
  expect(fixture.preview).toHaveBeenCalledWith({ personId, retainedUserId: "retained-login", activeTutorId: "tutor-original", activeTuteeId: null, tutorIds: ["tutor-original"], tuteeIds: [], willingnessSourceTutorId: "tutor-original" }, { staleTime: 0 });
});

it.each(["INACTIVE_SOURCE", "TUTOR_REQUEST", "TUTEE_REMOVAL_REQUEST", "STUDENT_QUARTER_BLOCK", "UNCONFIRMED_SURVEY", "ALREADY_CONSOLIDATED", "QUALIFICATION_CONFLICT", "DUPLICATE_COMMITMENT", "HISTORY_ACCESS_REVIEW", "SOURCE_RESTRICTION"] as const)("explains and enforces the %s blocker", async (code) => {
  fixture.preview.mockResolvedValue({ ...preview(), canTransfer: false, blockers: [{ kind: "TUTOR", id: "exact-blocked-work", code, reason: "Server explanation" }] });
  render(view()); await review(); complete();
  expect(screen.getByText(en.personParticipationTransfer.blocker[code])).toBeTruthy(); expect(screen.getByText(/exact-blocked-work/)).toBeTruthy();
  expect(screen.getByRole("button", { name: en.personParticipationTransfer.confirm }).matches(":disabled")).toBe(true);
  confirm(); expect(fixture.mutate).not.toHaveBeenCalled();
});

it("admits one transfer, locks the reviewed choices and retains its receipt", async () => {
  const pending = deferred<Receipt>(); fixture.mutate.mockReturnValue(pending.promise);
  render(view()); await review(); complete(); const button = screen.getByRole("button", { name: en.personParticipationTransfer.confirm });
  act(() => { button.click(); button.click(); }); expect(fixture.mutate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("combobox", { name: en.personParticipationTransfer.activeTutor }).matches(":disabled")).toBe(true);
  const input = fixture.mutate.mock.calls[0]![0];
  expect(input).toMatchObject({ personId, retainedUserId: "retained-login", activeTutorId: "tutor-active", activeTuteeId: "tutee-active", tutorIds: ["tutor-active", "tutor-original"], tuteeIds: ["tutee-active"], fingerprint: "c".repeat(64), acknowledged: true });
  await act(async () => pending.resolve(receipt(input.operationId))); await screen.findByText(en.personParticipationTransfer.saved);
});

it("invalidates the review when the selected active or preference source changes", async () => {
  render(view()); await review(); complete();
  fireEvent.change(screen.getByRole("combobox", { name: en.personParticipationTransfer.availabilitySource }), { target: { value: "tutor-original" } });
  expect(screen.queryByRole("heading", { name: en.personParticipationTransfer.reviewTitle })).toBeNull(); expect(fixture.mutate).not.toHaveBeenCalled();
});

it("requires deliberate history access acknowledgment and a fresh exact review", async () => {
  const accessChanges: Preview["accessChanges"] = [{ kind: "TUTOR", id: "tutor-original", previousReaderUserId: "previous-reader", readerUserId: "retained-login", revision: 4 }];
  fixture.preview.mockResolvedValueOnce({ ...preview(), canTransfer: false, accessChanges, blockers: [{ code: "HISTORY_ACCESS_REVIEW", kind: "TUTOR", id: "tutor-original", reason: "Review access" }] });
  render(view()); await review();
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: en.personParticipationTransfer.reviewHistoryAccess });
  expect(checkbox.checked).toBe(false); expect(screen.getByText(/previous-reader/)).toBeTruthy();
  fireEvent.click(checkbox);
  expect(screen.queryByRole("heading", { name: en.personParticipationTransfer.reviewTitle })).toBeNull();
  fixture.preview.mockResolvedValue({ ...preview(), fingerprint: "d".repeat(64), accessChanges });
  fireEvent.click(screen.getByRole("button", { name: en.personParticipationTransfer.review }));
  await screen.findByRole("heading", { name: en.personParticipationTransfer.reviewTitle });
  expect(fixture.preview.mock.calls[1]![0]).toMatchObject({ acknowledgeHistoryAccessCorrection: true });
  complete(); confirm(); await screen.findByText(en.personParticipationTransfer.saved);
  expect(fixture.mutate.mock.calls[0]![0]).toMatchObject({ acknowledgeHistoryAccessCorrection: true, fingerprint: "d".repeat(64) });
});

it.each(["en", "zh"] as const)("makes the existing discipline-removal consequence explicit in %s", async (locale) => {
  fixture.preview.mockResolvedValue({ ...preview(), discipline: { validYellow: 3, validRed: 1, willRemove: true } });
  render(view({}, locale)); await review(locale);
  const copy = (locale === "en" ? en : zh).personParticipationTransfer;
  expect(screen.getByText(copy.disciplineRemoval)).toBeTruthy();
  expect(screen.getByRole("button", { name: copy.confirmRemoval }).matches(":disabled")).toBe(true);
  complete(locale); fireEvent.click(screen.getByRole("button", { name: copy.confirmRemoval }));
  await screen.findByText(copy.saved); expect(fixture.mutate).toHaveBeenCalledTimes(1);
});

it("requires fresh review after conflict and retains the reason", async () => {
  fixture.mutate.mockRejectedValueOnce(serverError("CONFLICT")); render(view()); await review(); complete(); confirm();
  await screen.findByText("Synthetic CONFLICT"); fireEvent.click(screen.getByRole("button", { name: en.personParticipationTransfer.review }));
  await screen.findByRole("heading", { name: en.personParticipationTransfer.reviewTitle });
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: en.combineRecords.evidence }).value).toContain("Reviewed original participation");
  expect(screen.getByLabelText<HTMLInputElement>(en.combineRecords.password).value).toBe(""); expect(fixture.mutate).toHaveBeenCalledTimes(1);
});

it("checks a lost response then explicitly retries the frozen operation after a missing receipt", async () => {
  fixture.mutate.mockRejectedValueOnce(new Error("Response lost")); render(view()); await review(); complete(); confirm();
  await screen.findByText(en.combineRecords.uncertain); const original = fixture.mutate.mock.calls[0]![0];
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome })); await screen.findByText(en.personParticipationTransfer.exactRetryHelp);
  expect(fixture.mutate).toHaveBeenCalledTimes(1); fireEvent.change(screen.getByLabelText(en.combineRecords.password), { target: { value: "Fresh-password!" } });
  fireEvent.click(screen.getByRole("button", { name: en.combineRecords.retryExact })); await screen.findByText(en.personParticipationTransfer.saved);
  expect(fixture.mutate.mock.calls[1]![0]).toEqual({ ...original, confirmPassword: "Fresh-password!" });
});

it("recovers an accepted receipt without resending after its parent group changes", async () => {
  fixture.mutate.mockRejectedValueOnce(new Error("Response lost")); const ui = render(view()); await review(); complete(); confirm();
  await screen.findByText(en.combineRecords.uncertain); fixture.receipt.mockResolvedValue(receipt(fixture.mutate.mock.calls[0]![0].operationId));
  ui.rerender(view({ personId: "refreshed-group" })); fireEvent.click(screen.getByRole("button", { name: en.combineRecords.checkOutcome }));
  await screen.findByText(en.personParticipationTransfer.saved); expect(fixture.mutate).toHaveBeenCalledTimes(1);
});

it("offers reads only after an accepted transfer has a refresh failure", async () => {
  fixture.refresh.mockRejectedValue(new Error("Offline refresh")); render(view()); await review(); complete(); confirm();
  await screen.findByText(en.personParticipationTransfer.refreshFailed); fixture.refresh.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: en.personParticipationTransfer.refresh }));
  await waitFor(() => expect(screen.queryByText(en.personParticipationTransfer.refreshFailed)).toBeNull()); expect(fixture.mutate).toHaveBeenCalledTimes(1);
});

it("ignores stale previews and latches parent access denial", async () => {
  const pending = deferred<Preview>(); fixture.preview.mockReturnValue(pending.promise); const ui = render(view()); select();
  fireEvent.click(screen.getByRole("button", { name: en.personParticipationTransfer.review })); ui.rerender(view({ accessDenied: true }));
  await act(async () => pending.resolve(preview())); ui.rerender(view({ accessDenied: false }));
  expect(screen.queryByText(/original-pairing/)).toBeNull(); expect(fixture.mutate).not.toHaveBeenCalled();
});

it("rejects a stale preview after the parent changes A-to-B-to-A", async () => {
  const pending = deferred<Preview>(); fixture.preview.mockReturnValue(pending.promise); const ui = render(view()); select();
  fireEvent.click(screen.getByRole("button", { name: en.personParticipationTransfer.review }));
  ui.rerender(view({ personId: "other-person" })); ui.rerender(view());
  await act(async () => pending.resolve(preview()));
  expect(screen.queryByRole("heading", { name: en.personParticipationTransfer.reviewTitle })).toBeNull();
  expect(fixture.mutate).not.toHaveBeenCalled();
});

function DialogFixture() { const [open, setOpen] = useState(true); const close = () => { fixture.close(); setOpen(false); }; return <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{open && <Modal title="Participation transfer" onClose={close} footer={<button onClick={close}>Cancel</button>}><PersonParticipationTransfer personId={personId} /></Modal>}</NextIntlClientProvider>; }
it("blocks parent dismissal while a transfer is pending or its outcome is unknown", async () => {
  const pending = deferred<Receipt>(); fixture.mutate.mockReturnValue(pending.promise); render(<DialogFixture />); await review(); complete(); confirm();
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true); fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(fixture.close).not.toHaveBeenCalled(); await act(async () => pending.reject(new Error("Response lost"))); await screen.findByText(en.combineRecords.uncertain);
  expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
});

it.each(["en", "zh"] as const)("shows exact original source restrictions without granting transfer in %s", async (locale) => {
  fixture.preview.mockResolvedValue({ ...preview(), canTransfer: false,
    blockers: [{ code: "SOURCE_RESTRICTION", kind: "TUTOR", id: "tutor-original", reason: "Source restriction" }],
    sourceRestrictions: [{ kind: "TUTOR", sourceId: "tutor-original", sourceUserIds: ["original-restricted-account"], ownershipRevision: 3, retained: null, direct: null, receiptIds: [], accounts: [], blockers: [{ userId: "original-restricted-account", reason: "SUSPENDED" }] }],
  });
  render(view({}, locale)); await review(locale); complete(locale);
  const copy = (locale === "en" ? en : zh).personParticipationTransfer;
  expect(screen.getByText(copy.sourceRestrictionsHelp)).toBeTruthy();
  expect(screen.getByText(new RegExp(copy.restriction.SUSPENDED))).toBeTruthy();
  expect(screen.getByRole("button", { name: copy.confirm }).matches(":disabled")).toBe(true);
  confirm(locale); expect(fixture.mutate).not.toHaveBeenCalled();
});

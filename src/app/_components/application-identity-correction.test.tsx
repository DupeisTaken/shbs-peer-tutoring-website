/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { DEFAULT_NAME_FIELDS, nameFieldPolicies, type NameFieldStates } from "~/lib/name-field-policy";
import { ApplicationIdentityCorrection } from "./application-identity-correction";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";

type Snapshot = RouterOutputs["admin"]["applicationIdentity"];
const state = vi.hoisted(() => ({
  data: undefined as Snapshot | undefined,
  readError: null as (Error & { data?: { code?: string } }) | null,
  readPending: false,
  policyError: null as Error | null,
  fields: undefined as NameFieldStates | undefined,
  save: vi.fn(), fetch: vi.fn(), policyFetch: vi.fn(), proposalFetch: vi.fn(), refetch: vi.fn(), changed: vi.fn(), active: vi.fn(), mutationMounted: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { applicationIdentity: { fetch: state.fetch } },
      program: { nameFieldPolicy: { fetch: state.policyFetch } },
      approval: { list: { fetch: state.proposalFetch } },
    }),
    admin: {
      applicationIdentity: { useQuery: () => ({ data: state.data, error: state.readError, isFetching: state.readPending, isSuccess: !state.readError, refetch: state.refetch }) },
      correctApplicationIdentity: { useMutation: () => { state.mutationMounted(); return { mutateAsync: state.save }; } },
    },
    program: {
      nameFieldPolicy: { useQuery: () => ({ data: { policies: nameFieldPolicies({ TUTOR: state.fields }), version: 1 }, error: state.policyError, refetch: state.refetch }) },
      nameFieldsForProfile: { useQuery: () => ({}) },
    },
  },
}));

function fixture(): Snapshot {
  const names = { name: "张小明", firstName: null, lastName: null, preferredName: null, alternativeNames: null };
  return {
    id: "application", expectedUpdatedAt: new Date("2026-10-01T00:00:00Z"), original: names, current: names, revision: 0,
    history: [], eligible: true, ineligibleReason: null, policy: { states: DEFAULT_NAME_FIELDS, version: 1 },
    readiness: { ready: false, source: "APPLICATION", reason: "PROFILE_LATIN_NAME_REQUIRED", identity: names, accountId: null, tutorId: null },
    provisioning: { accountId: null, verifiedAccount: false, existingTutorId: null, invitationCount: 0, account: null, existingTutor: null },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function tree({ canCorrect = true, canApply = true, invalid = false, chinese = false } = {}) {
  return <NextIntlClientProvider locale={chinese ? "zh" : "en"} messages={chinese ? zh : en} timeZone="Asia/Shanghai"><ApplicationIdentityCorrection applicationId="application" canCorrect={canCorrect} canApply={canApply} invalid={invalid} onChanged={state.changed} onActive={state.active} /></NextIntlClientProvider>;
}
function open() {
  const opener = screen.getByRole("button", { name: en.applicationIdentity.edit });
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole("dialog", { name: en.applicationIdentity.dialogTitle }) };
}
function fill(firstName = "Xiaoming") {
  fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: firstName } });
  fireEvent.change(screen.getByLabelText(/^Last Name/), { target: { value: "Zhang" } });
  fireEvent.change(screen.getByLabelText(en.applicationIdentity.reason), { target: { value: "Confirmed spelling with applicant" } });
}
function submit() { fireEvent.submit(screen.getByRole("dialog").querySelector("form")!); }
beforeEach(() => {
  vi.clearAllMocks();
  state.data = fixture(); state.readError = null; state.readPending = false; state.policyError = null; state.fields = DEFAULT_NAME_FIELDS;
  state.save.mockReset().mockResolvedValue({ ok: true });
  state.fetch.mockReset().mockImplementation(async () => state.data);
  state.policyFetch.mockReset().mockResolvedValue({ policies: nameFieldPolicies({}), version: 1 });
  state.changed.mockReset().mockResolvedValue(undefined);
  state.proposalFetch.mockReset().mockResolvedValue({ rows: [{ id: "approval-1", state: "PENDING" }] });
});
afterEach(cleanup);

it.each([false, true])("reads original/current evidence without mounting a write for a Coordinator (Chinese=%s)", (chinese) => {
  render(tree({ canCorrect: false, canApply: false, chinese }));
  const text = chinese ? zh.applicationIdentity : en.applicationIdentity;
  expect(screen.getByText(text.original)).toBeTruthy();
  expect(screen.getByText(text.current)).toBeTruthy();
  expect(screen.getByText(text.readOnly)).toBeTruthy();
  expect(screen.queryByRole("button", { name: text.edit })).toBeNull();
  expect(state.mutationMounted).not.toHaveBeenCalled();
});

it("does not split a legacy name and retains the draft and exact opener on Cancel/reopen", () => {
  render(tree());
  const { opener } = open();
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>(/^Last Name/).value).toBe("");
  fill();
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.cancel }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  open();
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Xiaoming");
  expect(screen.getByLabelText<HTMLTextAreaElement>(en.applicationIdentity.reason).value).toBe("Confirmed spelling with applicant");
  expect(screen.getByLabelText<HTMLTextAreaElement>(en.applicationIdentity.reason).maxLength).toBe(1000);
  expect(state.save).not.toHaveBeenCalled();
});

it("freezes pending fields and dismissal, and admits one same-turn write with only names/reason", async () => {
  const pending = deferred<unknown>(); state.save.mockReturnValue(pending.promise);
  render(tree({ invalid: true }));
  const { dialog } = open(); fill("José");
  act(() => { submit(); submit(); });
  expect(state.save).toHaveBeenCalledOnce();
  const { clientKey, ...fields } = state.save.mock.calls[0]![0] as RouterInputs["admin"]["correctApplicationIdentity"];
  expect(clientKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(fields).toEqual({ id: "application", expectedUpdatedAt: fixture().expectedUpdatedAt, firstName: "José", lastName: "Zhang", preferredName: "", alternativeNames: "", reason: "Confirmed spelling with applicant" });
  expect(screen.getByLabelText(/^First Name/).matches(":disabled")).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: en.applicationIdentity.cancel }).disabled).toBe(true);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(dialog.isConnected).toBe(true);
  expect(within(dialog).getByText(en.applicationIdentity.invalidPreserved)).toBeTruthy();
  await act(async () => pending.resolve({ ok: true }));
  await waitFor(() => expect(screen.getByText(en.applicationIdentity.applied)).toBeTruthy());
  expect(state.save).toHaveBeenCalledOnce();
});

it("retains failed drafts, receipt keys and captured versions through background reads; explicit successful Reload adopts new evidence", async () => {
  state.save.mockRejectedValue(new Error("STALE_REVIEW"));
  const view = render(tree()); open(); fill(); submit();
  await screen.findByText("STALE_REVIEW");
  const first = state.save.mock.calls[0]![0] as { clientKey: string; expectedUpdatedAt: Date };
  const latest = { ...fixture(), expectedUpdatedAt: new Date("2026-10-02"), revision: 1, current: { ...fixture().current, firstName: "Fresh", lastName: "Record", name: "Fresh Record" } };
  state.data = latest; view.rerender(tree());
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Xiaoming");
  submit(); await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  expect(state.save.mock.calls[1]![0]).toMatchObject(first);
  state.fetch.mockRejectedValueOnce(new Error("Reload unavailable"));
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.reload }));
  await screen.findByText("Reload unavailable");
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Xiaoming");
  expect(screen.getByText("STALE_REVIEW")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.reload }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Fresh"));
  fill("New"); submit();
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(3));
  expect(state.save.mock.calls[2]![0]).toMatchObject({ expectedUpdatedAt: latest.expectedUpdatedAt });
  expect((state.save.mock.calls[2]![0] as {clientKey: string}).clientKey).not.toBe(first.clientKey);
});

it("does not adopt a successful identity reload when the policy read failed", async () => {
  render(tree()); open(); fill();
  state.fetch.mockResolvedValue({ ...fixture(), expectedUpdatedAt: new Date("2026-10-02"), current: { ...fixture().current, firstName: "New server name" } });
  state.policyFetch.mockRejectedValue(new Error("Policy unavailable"));
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.reload }));
  await screen.findByText("Policy unavailable");
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Xiaoming");
  submit(); await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0]![0]).toMatchObject({ expectedUpdatedAt: fixture().expectedUpdatedAt });
});

it("waits for all accepted-write reads, and retries only reads after failure and Close", async () => {
  const held = deferred<unknown>(); state.changed.mockReturnValueOnce(held.promise);
  state.fetch.mockRejectedValueOnce(new Error("Identity refresh unavailable"));
  render(tree()); open(); fill(); submit();
  await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
  expect(screen.queryByText("Identity refresh unavailable")).toBeNull();
  expect(screen.getByLabelText(/^First Name/).matches(":disabled")).toBe(true);
  await act(async () => held.resolve(undefined));
  await screen.findByText("Identity refresh unavailable");
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.cancel }));
  expect(screen.getByText(en.applicationIdentity.acceptedReadFailed)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.retryRead }));
  await waitFor(() => expect(screen.queryByText(en.applicationIdentity.acceptedReadFailed)).toBeNull());
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(state.changed).toHaveBeenCalledTimes(2);
  expect(state.save).toHaveBeenCalledOnce();
});

it("shows an Admin proposal as queued, retains its draft and prevents replay", async () => {
  state.save.mockRejectedValue(Object.assign(new Error("Queued"), { data: { approvalId: "approval-1" } }));
  render(tree({ canApply: false })); open(); fill();
  expect(screen.getByRole("button", { name: en.applicationIdentity.propose })).toBeTruthy();
  submit(); await screen.findByText(en.applicationIdentity.queued);
  expect(screen.queryByText(en.applicationIdentity.applied)).toBeNull();
  expect(screen.getByRole("link", { name: en.applicationIdentity.viewRequest }).getAttribute("href")).toBe("/admin/approvals?request=approval-1");
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Xiaoming");
  expect(screen.getByLabelText(/^First Name/).matches(":disabled")).toBe(true);
  submit();
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.reload }));
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
  submit();
  expect(state.save).toHaveBeenCalledOnce();
});

it.each(["REJECTED", "CANCELLED"])("starts a deliberate new correction only after a successful read of the %s proposal", async (status) => {
  state.save.mockRejectedValueOnce(Object.assign(new Error("Queued"), { data: { approvalId: "approval-1" } }));
  render(tree({ canApply: false })); open(); fill(); submit();
  await screen.findByText(en.applicationIdentity.queued);
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: en.applicationIdentity.reload }).disabled).toBe(false));
  const firstKey = (state.save.mock.calls[0]![0] as {clientKey: string}).clientKey;
  state.proposalFetch.mockRejectedValueOnce(new Error("Review unavailable"));
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.reload }));
  await screen.findByText("Review unavailable");
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Xiaoming");
  expect(screen.getByLabelText(/^First Name/).matches(":disabled")).toBe(true);
  state.proposalFetch.mockResolvedValue({ rows: [{ id: "approval-1", state: status }] });
  fireEvent.click(screen.getByRole("button", { name: en.applicationIdentity.reload }));
  await waitFor(() => expect(screen.queryByText(en.applicationIdentity.queued)).toBeNull());
  fill("Another"); submit();
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  expect((state.save.mock.calls[1]![0] as {clientKey: string}).clientKey).not.toBe(firstKey);
  expect(state.proposalFetch).toHaveBeenLastCalledWith({ requestId: "approval-1", page: 0 }, { staleTime: 0 });
});

it("preserves null legacy Latin parts for an alternate-only correction under newly required Last/Preferred", async () => {
  state.fields = { ...DEFAULT_NAME_FIELDS, lastName: "required", preferredName: "required" };
  render(tree()); open();
  fireEvent.change(screen.getByLabelText(/^Name in Another Language/), { target: { value: "小明" } });
  fireEvent.change(screen.getByLabelText(en.applicationIdentity.reason), { target: { value: "Applicant confirmed alternate spelling" } });
  submit(); await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const payload = state.save.mock.calls[0]![0] as Record<string, unknown>;
  expect(payload).toMatchObject({ alternativeNames: "小明" });
  expect(payload).not.toHaveProperty("firstName");
  expect(payload).not.toHaveProperty("lastName");
  expect(payload).not.toHaveProperty("preferredName");
  expect(screen.getAllByText(en.applicationIdentity.needsReview).length).toBeGreaterThan(0);
});

it("freezes cached drafts on policy or identity read failure, and prevents writes after role loss", () => {
  const view = render(tree()); open(); fill();
  state.policyError = new Error("Policy unavailable"); view.rerender(tree());
  submit(); expect(state.save).not.toHaveBeenCalled();
  state.policyError = null; state.readError = new Error("Read unavailable"); view.rerender(tree());
  submit(); expect(state.save).not.toHaveBeenCalled();
  state.readError = null; view.rerender(tree({ canCorrect: false }));
  expect(screen.getByText(en.applicationIdentity.authorityChanged)).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>(/^First Name/).value).toBe("Xiaoming");
  submit(); expect(state.save).not.toHaveBeenCalled();
});

it("conceals cached private evidence after authoritative read denial", () => {
  const view = render(tree()); open(); fill();
  state.readError = Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
  view.rerender(tree());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("张小明")).toBeNull();
  expect(screen.getByText(en.applicationIdentity.accessDenied)).toBeTruthy();
});

it("presents immutable before/after audit evidence and the actual promotion identity source", () => {
  const current = { ...fixture().current, name: "Xiaoming Zhang", firstName: "Xiaoming", lastName: "Zhang" };
  state.data = { ...fixture(), current, revision: 1, history: [{ revision: 1, actorId: "synthetic-head", actorName: "Synthetic Head", reason: "Applicant confirmed spelling", before: fixture().original, after: current, createdAt: new Date("2026-10-03"), approvalId: "approved-request" }], readiness: { ...fixture().readiness, ready: true, source: "VERIFIED_ACCOUNT", reason: null } };
  render(tree());
  expect(screen.getByText(en.applicationIdentity.source.VERIFIED_ACCOUNT)).toBeTruthy();
  expect(screen.getByText(en.applicationIdentity.before)).toBeTruthy();
  expect(screen.getByText(en.applicationIdentity.after)).toBeTruthy();
  expect(screen.getByText("Applicant confirmed spelling")).toBeTruthy();
  expect(screen.getByText(/Synthetic Head/)).toBeTruthy();
});

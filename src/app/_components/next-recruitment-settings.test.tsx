// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import { NextRecruitmentEditor, type NextRecruitmentSettingsData } from "./next-recruitment-settings";
import type { NextRecruitmentPreparationEvidence, PrepareNextRecruitmentInput } from "~/lib/next-recruitment";

const mocks = vi.hoisted(() => ({ write: vi.fn<(input: PrepareNextRecruitmentInput) => Promise<NextRecruitmentPreparationEvidence>>(), fetch: vi.fn(), cancel: vi.fn(), approvalFetch: vi.fn(), approvalCancel: vi.fn() }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ program: { nextRecruitment: { fetch: mocks.fetch, cancel: mocks.cancel } }, approval: { list: { fetch: mocks.approvalFetch, cancel: mocks.approvalCancel } } }),
  program: { prepareNextRecruitment: { useMutation: () => ({ mutateAsync: mocks.write }) } },
} }));
const target = { sourceTermId: "source", sourceSchoolYear: "26-27", sourceQuarter: "Q1", destinationSchoolYear: "26-27", destinationQuarter: "Q2", semesterMode: false, modeRevision: 2 } as const;
function data(): NextRecruitmentSettingsData {
  const preparations = { tutor: null, tutee: null };
  return { target, currentName: "26-27 Q1", nextName: "26-27 Q2", timeZone: "Asia/Shanghai", preparations, canEdit: true, canApply: true, refreshEvidence: { target, timeZone: "Asia/Shanghai", preparations, destination: null } };
}
const text = en.nextRecruitment;
const show = (value = data(), audience: "tutor" | "tutee" = "tutor", readFailed = false) => <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai"><NextRecruitmentEditor data={value} audience={audience} readFailed={readFailed} /></NextIntlClientProvider>;
const setOpening = (value = "2026-11-01T09:00") => {
  fireEvent.click(screen.getByLabelText(text.setOpening));
  fireEvent.change(screen.getByLabelText(text.opening), { target: { value } });
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
let serverData: NextRecruitmentSettingsData;
beforeEach(() => {
  vi.resetAllMocks(); serverData = data();
  mocks.cancel.mockResolvedValue(undefined); mocks.approvalCancel.mockResolvedValue(undefined);
  mocks.approvalFetch.mockResolvedValue({ rows: [{ id: "proposal-123", state: "PENDING" }] });
  mocks.write.mockImplementation(async (input: PrepareNextRecruitmentInput) => {
    const row = { target: input.expectedTarget, version: input.expectedVersion + 1, opensAt: input.opensAt, timeZone: input.expectedTimeZone, matchesTarget: true };
    serverData = { ...serverData, target: input.expectedTarget, timeZone: input.expectedTimeZone, preparations: { ...serverData.preparations, [input.audience]: row } };
    return row;
  });
  mocks.fetch.mockImplementation(async () => serverData);
});
afterEach(cleanup);

it("saves only the chosen audience and admits one same-turn write", async () => {
  const pending = deferred<NextRecruitmentPreparationEvidence>();
  mocks.write.mockReturnValue(pending.promise);
  const view = render(show());
  setOpening();
  act(() => { fireEvent.submit(view.container.querySelector("form")!); fireEvent.submit(view.container.querySelector("form")!); });
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.write).toHaveBeenCalledWith({ audience: "tutor", expectedTarget: target, expectedVersion: 0, expectedTimeZone: "Asia/Shanghai", opensAt: new Date("2026-11-01T01:00:00Z") });
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).matches(":disabled")).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: text.reload }).disabled).toBe(true);
  await act(async () => { pending.resolve({ target, version: 1, timeZone: "Asia/Shanghai", opensAt: new Date("2026-11-01T01:00:00Z") }); await pending.promise; });
});

it("keeps Tutor and Tutee drafts independent while one save is pending", async () => {
  const pending = deferred<NextRecruitmentPreparationEvidence>();
  mocks.write.mockReturnValue(pending.promise);
  render(<NextIntlClientProvider locale="en" messages={en}><NextRecruitmentEditor data={data()} audience="tutor" /><NextRecruitmentEditor data={data()} audience="tutee" /></NextIntlClientProvider>);
  const tutor = within(screen.getByRole("region", { name: text.tutor }));
  const tutee = within(screen.getByRole("region", { name: text.tutee }));
  fireEvent.click(tutor.getByRole("button", { name: text.clear }));
  expect(tutee.getByRole<HTMLButtonElement>("button", { name: text.clear }).disabled).toBe(false);
  fireEvent.click(tutee.getByRole("button", { name: text.clear }));
  expect(mocks.write.mock.calls.map(([input]) => input.audience)).toEqual(["tutor", "tutee"]);
  await act(async () => { pending.resolve({ target, version: 1, timeZone: "Asia/Shanghai", opensAt: null }); await pending.promise; });
});

it("distinguishes an explicit clear from the untouched preparation", async () => {
  const value = data();
  value.preparations.tutor = { target, version: 3, opensAt: new Date("2026-11-01T01:00:00Z"), timeZone: value.timeZone, matchesTarget: true };
  render(show(value));
  expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(text.setOpening));
  fireEvent.click(screen.getByRole("button", { name: text.clear }));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, opensAt: null })));
});

it("retains failed drafts and refuses background retargeting until a successful explicit Reload", async () => {
  const view = render(show());
  setOpening();
  mocks.write.mockRejectedValueOnce(new Error("Request failed"));
  fireEvent.click(screen.getByRole("button", { name: text.save }));
  await screen.findByText("Request failed");
  const fresh = data();
  fresh.target = { ...target, destinationQuarter: "Q3", semesterMode: true, modeRevision: 3 };
  fresh.nextName = "26-27 S2";
  fresh.timeZone = "America/New_York";
  fresh.refreshEvidence = { ...fresh.refreshEvidence, target: fresh.target, timeZone: fresh.timeZone };
  view.rerender(show(fresh));
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).value).toBe("2026-11-01T09:00");
  expect(screen.getByText(text.changed)).toBeTruthy();
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  mocks.fetch.mockRejectedValueOnce(new Error("Read failed"));
  fireEvent.click(screen.getByRole("button", { name: text.reload }));
  await screen.findByText("Read failed");
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).value).toBe("2026-11-01T09:00");
  mocks.fetch.mockResolvedValueOnce(fresh);
  fireEvent.click(screen.getByRole("button", { name: text.reload }));
  await waitFor(() => expect(screen.queryByLabelText(text.opening)).toBeNull());
  expect(screen.getByText("America/New_York")).toBeTruthy();
});

it("requires an explicit reload before replacing a preparation bound to an old mode revision", async () => {
  const value = data();
  value.preparations.tutor = { target: { ...target, modeRevision: 1 }, version: 4, opensAt: null, timeZone: value.timeZone, matchesTarget: false };
  mocks.fetch.mockResolvedValue(value);
  render(show(value));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: text.clear }).matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: text.reload }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: text.clear }).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: text.clear }));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ expectedTarget: target, expectedVersion: 4, opensAt: null })));
});

it("retains a queued Admin draft without presenting it as a saved preparation", async () => {
  mocks.write.mockRejectedValue({ data: { approvalId: "proposal-123" } });
  const value = { ...data(), canApply: false };
  render(show(value));
  setOpening();
  fireEvent.click(screen.getByRole("button", { name: en.approvals.requestHead }));
  await screen.findByText(text.queued);
  expect(screen.queryByText(text.saved)).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).value).toBe("2026-11-01T09:00");
  expect(screen.getByRole("link", { name: text.viewRequest }).getAttribute("href")).toContain("proposal-123");
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: text.checkApproval }));
  await waitFor(() => expect(mocks.approvalFetch).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).value).toBe("2026-11-01T09:00");
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).matches(":disabled")).toBe(true);
  expect(screen.getByRole("link", { name: text.viewRequest })).toBeTruthy();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it.each(["APPROVED", "REJECTED", "CANCELLED"])("unlocks a queued draft only after fresh %s evidence and preparation reads", async (state) => {
  mocks.write.mockRejectedValueOnce({ data: { approvalId: "proposal-123" } });
  render(show({ ...data(), canApply: false }));
  setOpening();
  fireEvent.click(screen.getByRole("button", { name: en.approvals.requestHead }));
  await screen.findByText(text.queued);
  mocks.approvalFetch.mockRejectedValueOnce(new Error("status offline"));
  fireEvent.click(screen.getByRole("button", { name: text.checkApproval }));
  await screen.findByText("status offline");
  expect(screen.getByRole("link", { name: text.viewRequest })).toBeTruthy();
  mocks.approvalFetch.mockResolvedValueOnce({ rows: [{ id: "proposal-123", state }] });
  fireEvent.click(screen.getByRole("button", { name: text.checkApproval }));
  await waitFor(() => expect(screen.queryByText(text.queued)).toBeNull());
  expect(screen.queryByLabelText(text.opening)).toBeNull();
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("retries only reads after an accepted save and failed synchronization", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("offline"));
  render(show());
  setOpening();
  fireEvent.click(screen.getByRole("button", { name: text.save }));
  await screen.findByText(text.savedReadFailed);
  fireEvent.click(screen.getByRole("button", { name: text.save }));
  expect(mocks.write).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: text.retryRead }));
  await screen.findByText(text.saved);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("forces a real QueryClient read even when cached preparation has an infinite freshness period", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["preparation"], data());
  const fresh = data();
  fresh.preparations.tutor = { target, version: 1, opensAt: null, timeZone: fresh.timeZone, matchesTarget: true };
  const network = vi.fn().mockResolvedValue(fresh);
  mocks.fetch.mockImplementation((_input?: undefined, options?: { staleTime?: number }) => client.fetchQuery({ queryKey: ["preparation"], queryFn: network, ...options }));
  render(show());
  fireEvent.click(screen.getByRole("button", { name: text.clear }));
  await screen.findByText(text.saved);
  expect(network).toHaveBeenCalledTimes(1);
  expect(screen.getByText(text.noRestriction)).toBeTruthy();
  client.clear();
});

it("cancels an installed QueryClient read started before the save and waits for a new matching receipt read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const old = deferred<NextRecruitmentSettingsData>();
  const next = deferred<NextRecruitmentSettingsData>();
  const network = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const fetch = (_input?: undefined, options?: { staleTime?: number }) => client.fetchQuery({ queryKey: ["preparation"], queryFn: network, ...options });
  const oldRead = fetch(undefined, { staleTime: 0 }).catch(() => undefined);
  mocks.cancel.mockImplementation(() => client.cancelQueries({ queryKey: ["preparation"], exact: true }));
  mocks.fetch.mockImplementation(fetch);
  render(show());
  setOpening();
  fireEvent.click(screen.getByRole("button", { name: text.save }));
  await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  await act(async () => { old.resolve(data()); await oldRead; });
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).matches(":disabled")).toBe(true);
  expect(screen.queryByText(text.saved)).toBeNull();
  await act(async () => { next.resolve(serverData); await next.promise; });
  await screen.findByText(text.saved);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(client.getQueryData<NextRecruitmentSettingsData>(["preparation"])?.preparations.tutor?.version).toBe(1);
  client.clear();
});

it("keeps the accepted lock when even a fresh response has an older version or mismatched value", async () => {
  mocks.fetch.mockResolvedValueOnce(data());
  const view = render(show()); setOpening();
  fireEvent.click(screen.getByRole("button", { name: text.save }));
  await screen.findByText(text.savedChanged);
  const acceptedData = serverData;
  const mismatch = { ...acceptedData, preparations: { ...acceptedData.preparations, tutor: { ...acceptedData.preparations.tutor!, opensAt: null } } };
  mocks.fetch.mockResolvedValueOnce(mismatch);
  fireEvent.click(screen.getByRole("button", { name: text.reload }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).value).toBe("2026-11-01T09:00");
  fireEvent.click(screen.getByRole("button", { name: text.reload }));
  await screen.findByText(text.saved);
});

it.each(["newer-version", "new-source", "changed-mode", "changed-zone"] as const)("requires explicit Reload to adopt %s after a proven accepted save", async (kind) => {
  mocks.fetch.mockImplementation(async () => {
    const current = serverData;
    if (kind === "new-source") return { ...data(), currentName: "26-27 Q2", nextName: "26-27 Q3", target: { ...target, sourceTermId: "next-source", sourceQuarter: "Q2", destinationQuarter: "Q3" } };
    if (kind === "changed-mode") return { ...current, target: { ...target, modeRevision: 3 }, preparations: { ...current.preparations, tutor: { ...current.preparations.tutor!, matchesTarget: false } } };
    if (kind === "changed-zone") return { ...current, timeZone: "UTC" };
    return { ...current, preparations: { ...current.preparations, tutor: { ...current.preparations.tutor!, version: 2, opensAt: null } } };
  });
  render(show()); setOpening();
  fireEvent.click(screen.getByRole("button", { name: text.save }));
  await screen.findByText(text.savedChanged);
  expect(screen.getByLabelText<HTMLInputElement>(text.opening).value).toBe("2026-11-01T09:00");
  expect(screen.getByText(text.savedForTarget.replace("{name}", "26-27 Q2"))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: text.reload }));
  await screen.findByText(text.saved);
  if (kind === "changed-mode" || kind === "changed-zone") {
    expect(screen.getByLabelText<HTMLInputElement>(text.opening).value).toBe(kind === "changed-zone" ? "2026-11-01T01:00" : "2026-11-01T09:00");
  } else expect(screen.queryByLabelText(text.opening)).toBeNull();
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it.each([{ canEdit: false, readFailed: false }, { canEdit: true, readFailed: true }])("blocks a synthetic submission with canEdit=$canEdit and readFailed=$readFailed", ({ canEdit, readFailed }) => {
  const view = render(show({ ...data(), canEdit }, "tutor", readFailed));
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.write).not.toHaveBeenCalled();
});

it("rejects an ambiguous daylight-saving wall time without sending a mutation", () => {
  render(show({ ...data(), timeZone: "America/New_York" }));
  setOpening("2026-11-01T01:30");
  fireEvent.click(screen.getByRole("button", { name: text.save }));
  expect(screen.getByText(text.invalidTime)).toBeTruthy();
  expect(mocks.write).not.toHaveBeenCalled();
});

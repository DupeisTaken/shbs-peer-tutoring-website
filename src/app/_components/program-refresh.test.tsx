// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ProgramRefresh } from "./program-refresh";
import type { NextRecruitmentSettingsData } from "./next-recruitment-settings";

vi.mock("./scheduled-program-refresh", () => ({ ScheduledProgramRefresh: () => null }));

const mocks = vi.hoisted(() => ({ write: vi.fn(), fetch: vi.fn(), currentFetch: vi.fn(), cancel: vi.fn(), currentCancel: vi.fn(), refetch: vi.fn(), data: undefined as NextRecruitmentSettingsData | undefined, error: null as Error | null }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ program: { nextRecruitment: { fetch: mocks.fetch, cancel: mocks.cancel } }, admin: { currentPeriod: { fetch: mocks.currentFetch, cancel: mocks.currentCancel } } }),
  program: { nextRecruitment: { useQuery: () => ({ data: mocks.data, error: mocks.error, refetch: mocks.refetch }) } },
  admin: { refresh: { useMutation: () => ({ mutateAsync: mocks.write }) } },
} }));
const target = { sourceTermId: "source", sourceSchoolYear: "26-27", sourceQuarter: "Q1", destinationSchoolYear: "26-27", destinationQuarter: "Q3", semesterMode: true, modeRevision: 2 } as const;
const period = { termId: "source", name: "26-27 Q1", next: { name: "26-27 Q2", crossesSemester: false, crossesYear: false, graduates: false, semester: "S1" } } as ComponentProps<typeof ProgramRefresh>["period"];
const result = { name: "26-27 S2", archivedTutees: 2, graduatedTutors: 0, agedTutors: 0, pendingTutors: 3 };
const activatedPeriod = { ...period, termId: "destination", schoolYear: "26-27", quarter: "Q3" as const };
function data(): NextRecruitmentSettingsData {
  const preparations = { tutor: { target, version: 2, opensAt: new Date("2026-11-01T01:00:00Z"), timeZone: "Asia/Shanghai", matchesTarget: true }, tutee: null };
  return { target, currentName: "26-27 Q1", nextName: "26-27 S2", timeZone: "Asia/Shanghai", preparations, canEdit: true, canApply: true, refreshEvidence: { target, timeZone: "Asia/Shanghai", preparations: { tutor: { target, version: 2, opensAt: preparations.tutor.opensAt, timeZone: "Asia/Shanghai" }, tutee: null }, destination: null } };
}
function afterRefresh(current: ComponentProps<typeof ProgramRefresh>["period"] = activatedPeriod): NextRecruitmentSettingsData {
  const value = data();
  return { ...value, target: { ...value.target, sourceTermId: current.termId, sourceSchoolYear: current.schoolYear, sourceQuarter: current.quarter } };
}
const tree = (canEdit = true, canApply = true, locale: "en" | "zh" = "en") => <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="Asia/Shanghai"><ProgramRefresh period={period} canEdit={canEdit} canApply={canApply} /></NextIntlClientProvider>;
const open = (locale: "en" | "zh" = "en", canApply = true) => {
  const copy = locale === "en" ? en : zh;
  fireEvent.change(screen.getByLabelText(copy.admin.program.confirmLabel), { target: { value: "REFRESH" } });
  const button = screen.getByRole("button", { name: canApply ? copy.admin.program.refreshButton.replace("{name}", "26-27 S2") : copy.approvals.requestHead });
  button.focus();
  fireEvent.click(button);
  return { button, dialog: screen.getByRole("dialog") };
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.data = data(); mocks.error = null;
  mocks.write.mockResolvedValue(result); mocks.fetch.mockResolvedValue(afterRefresh()); mocks.currentFetch.mockResolvedValue(activatedPeriod);
  mocks.cancel.mockResolvedValue(undefined); mocks.currentCancel.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

it.each(["en", "zh"] as const)("reviews the exact source, target, both audiences and timezone in %s before mutation", async (locale) => {
  render(tree(true, true, locale));
  const copy = locale === "en" ? en : zh;
  const { dialog } = open(locale);
  expect(within(dialog).getByText("26-27 Q1")).toBeTruthy();
  expect(within(dialog).getByText("26-27 S2")).toBeTruthy();
  expect(within(dialog).getByText(copy.nextRecruitment.tutor)).toBeTruthy();
  expect(within(dialog).getByText(copy.nextRecruitment.tutee)).toBeTruthy();
  expect(within(dialog).getByText("Asia/Shanghai")).toBeTruthy();
  // The current-period query still reports Q2. Consequences must follow the
  // captured semester-mode target, not that independently refreshed query.
  expect(within(dialog).getByText(copy.admin.program.effectReactivate)).toBeTruthy();
  expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: copy.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledWith({ confirm: "REFRESH", expectedTermId: "source", expectedPreparation: data().refreshEvidence }));
  await waitFor(() => expect(mocks.currentFetch).toHaveBeenCalledWith(undefined, { staleTime: 0 }));
});

it("cancels without writes and returns keyboard focus to the exact opener", () => {
  render(tree());
  const { button, dialog } = open();
  fireEvent.click(within(dialog).getByRole("button", { name: en.actionReview.cancel }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(mocks.write).not.toHaveBeenCalled();
});

it("keeps the reviewed values after background changes and refuses silent adoption", async () => {
  const view = render(tree());
  const { dialog } = open();
  mocks.data = data();
  mocks.data.preparations.tutor!.version = 3;
  mocks.data.refreshEvidence.preparations.tutor!.version = 3;
  mocks.data.nextName = "Changed target name";
  view.rerender(tree());
  expect(within(dialog).queryByText("Changed target name")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await within(dialog).findByText(en.nextRecruitment.errors.NEXT_RECRUITMENT_CHANGED);
  expect(mocks.write).not.toHaveBeenCalled();
});

it("blocks an already-open review when its latest committed read has failed", async () => {
  const view = render(tree());
  const { dialog } = open();
  mocks.error = new Error("Latest preparation read failed");
  view.rerender(tree());
  fireEvent.click(within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await within(dialog).findByText(en.nextRecruitment.loadFailed);
  expect(mocks.write).not.toHaveBeenCalled();
});

it("admits one pending refresh and blocks dismissal until it settles", async () => {
  let resolve!: (value: typeof result) => void;
  mocks.write.mockReturnValue(new Promise<typeof result>((done) => { resolve = done; }));
  render(tree());
  const { dialog } = open();
  const button = within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(mocks.write).toHaveBeenCalledTimes(1);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => resolve(result));
});

it("retains read-only recovery after accepted refresh and closing the dialog", async () => {
  mocks.currentFetch.mockRejectedValueOnce(new Error("read failed"));
  render(tree());
  const { dialog } = open();
  fireEvent.click(within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await within(dialog).findByText(en.actionReview.refreshFailed);
  fireEvent.click(within(dialog).getByRole("button", { name: en.actionReview.close }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.retry }));
  await screen.findByText(en.actionReview.applied);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.currentFetch).toHaveBeenCalledTimes(2);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("replaces current-editor snapshots only after an accepted refresh has been read back", async () => {
  const activated = vi.fn();
  const newPeriod = activatedPeriod;
  mocks.currentFetch.mockResolvedValue(newPeriod);
  render(<NextIntlClientProvider locale="en" messages={en}><ProgramRefresh period={period} canEdit canApply onActivated={activated} /></NextIntlClientProvider>);
  const { dialog } = open();
  expect(activated).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await waitFor(() => expect(activated).toHaveBeenCalledWith(newPeriod));
});

it("cancels a pre-refresh QueryClient read instead of accepting its old current period", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolveOld!: (value: typeof period) => void;
  let resolveNew!: (value: typeof activatedPeriod) => void;
  const old = new Promise<typeof period>((resolve) => { resolveOld = resolve; });
  const fresh = new Promise<typeof activatedPeriod>((resolve) => { resolveNew = resolve; });
  const network = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(fresh);
  const fetch = (_input?: undefined, options?: { staleTime?: number }) => client.fetchQuery({ queryKey: ["current"], queryFn: network, ...options });
  const previous = fetch(undefined, { staleTime: 0 }).catch(() => undefined);
  mocks.currentCancel.mockImplementation(() => client.cancelQueries({ queryKey: ["current"], exact: true }));
  mocks.currentFetch.mockImplementation(fetch);
  const activated = vi.fn();
  render(<NextIntlClientProvider locale="en" messages={en}><ProgramRefresh period={period} canEdit canApply onActivated={activated} /></NextIntlClientProvider>);
  const { dialog } = open();
  fireEvent.click(within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  await act(async () => { resolveOld(period); await previous; });
  expect(activated).not.toHaveBeenCalled();
  await act(async () => { resolveNew(activatedPeriod); await fresh; });
  await waitFor(() => expect(activated).toHaveBeenCalledWith(activatedPeriod));
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(client.getQueryData<typeof activatedPeriod>(["current"])?.termId).toBe("destination");
  client.clear();
});

it("does not adopt the old source even after explicit read recovery", async () => {
  mocks.currentFetch.mockResolvedValue(period);
  mocks.fetch.mockResolvedValue(data());
  const activated = vi.fn();
  render(<NextIntlClientProvider locale="en" messages={en}><ProgramRefresh period={period} canEdit canApply onActivated={activated} /></NextIntlClientProvider>);
  const { dialog } = open();
  fireEvent.click(within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await within(dialog).findByText(en.actionReview.refreshFailed);
  fireEvent.click(within(dialog).getByRole("button", { name: en.actionReview.retry }));
  await waitFor(() => expect(mocks.currentFetch).toHaveBeenCalledTimes(2));
  expect(activated).not.toHaveBeenCalled();
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("adopts a later period only through explicit recovery after its accepted destination was superseded", async () => {
  const later = { ...activatedPeriod, termId: "later", schoolYear: "27-28", quarter: "Q1" as const };
  mocks.currentFetch.mockResolvedValue(later);
  mocks.fetch.mockResolvedValue(afterRefresh(later));
  const activated = vi.fn();
  render(<NextIntlClientProvider locale="en" messages={en}><ProgramRefresh period={period} canEdit canApply onActivated={activated} /></NextIntlClientProvider>);
  const { dialog } = open();
  fireEvent.click(within(dialog).getByRole("button", { name: en.admin.program.refreshButton.replace("{name}", "26-27 S2") }));
  await within(dialog).findByText(en.actionReview.refreshFailed);
  expect(activated).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: en.actionReview.retry }));
  await waitFor(() => expect(activated).toHaveBeenCalledWith(later));
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("reports queued Admin refresh as pending approval, without reading it as activation", async () => {
  mocks.write.mockRejectedValue({ data: { approvalId: "refresh-proposal" } });
  render(tree(true, false));
  const { dialog } = open("en", false);
  fireEvent.click(within(dialog).getByRole("button", { name: en.approvals.requestHead }));
  await within(dialog).findByText(en.actionReview.queued);
  expect(mocks.currentFetch).not.toHaveBeenCalled();
  expect(within(dialog).queryByText(en.actionReview.applied)).toBeNull();
});

it("revokes an open review when live edit authority is lost", () => {
  const view = render(tree()); open(); view.rerender(tree(false, false));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>(en.admin.program.confirmLabel).disabled).toBe(true);
  expect(mocks.write).not.toHaveBeenCalled();
});

it("disables refresh while a saved preparation is bound to an old target", () => {
  mocks.data!.preparations.tutor!.matchesTarget = false;
  render(tree());
  expect(screen.getByText(en.nextRecruitment.refreshStale)).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>(en.admin.program.confirmLabel).disabled).toBe(true);
});

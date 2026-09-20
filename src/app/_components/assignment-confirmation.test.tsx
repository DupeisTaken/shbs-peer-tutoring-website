/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AssignmentConfirmation } from "./assignment-confirmation";
import { QualifiedTutorSelect } from "./qualified-tutor-select";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), close: vi.fn(), grants: [{ tutorId: "b", subjectId: "math" }] }));
vi.mock("~/trpc/react", () => ({ api: { admin: { subjects: { useQuery: () => ({ data: [{ id: "math", active: true, level: null }, { id: "other", active: true, level: null }] }) } }, assignment: {
  prepare: { useMutation: () => ({ mutateAsync: mocks.prepare }) },
  cancel: { useMutation: () => ({ mutate: mocks.cancel }) },
  grants: { useQuery: () => ({ data: mocks.grants, isLoading: false }) },
} } }));
const result = (id = "ticket") => ({ ticket: { id, readyAt: new Date(Date.now() + 3000) }, mismatches: [{ tutorId: "a", tutorName: "Ada", subjectId: "math", subjectName: "Math" }] });
beforeEach(() => {
  vi.useFakeTimers();
  mocks.prepare.mockImplementation(async () => result());
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const dialog = (tutorId = "a") => <NextIntlClientProvider locale="en" messages={en}>
  <AssignmentConfirmation operation="admin.createPairing" payload={{ tutorId, subjectId: "math" }} onConfirm={mocks.confirm} onCancel={mocks.close} />
</NextIntlClientProvider>;
const flush = () => act(async () => { await Promise.resolve(); });

it("shows the mismatch and enables explicit confirmation at exactly 3000ms", async () => {
  render(dialog()); await flush();
  expect(screen.getByText("Ada has no approved qualification for Math.")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(2999));
  const waiting = screen.getByRole("button", { name: "Confirm in 1s" });
  expect((waiting as HTMLButtonElement).disabled).toBe(true); fireEvent.click(waiting);
  expect(mocks.confirm).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(1));
  fireEvent.click(screen.getByRole("button", { name: "Confirm unqualified assignment" }));
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith("ticket");
});
it("cancels through Escape, discards the ticket, and restarts on reopening", async () => {
  const view = render(dialog()); await flush();
  await act(() => vi.advanceTimersByTime(3000));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(mocks.close).toHaveBeenCalledOnce(); view.unmount();
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "ticket" });
  render(dialog()); await flush();
  expect((screen.getByRole("button", { name: "Confirm in 3s" }) as HTMLButtonElement).disabled).toBe(true);
});
it("changing the tutor resets the entire acknowledgement and timer", async () => {
  const view = render(dialog()); await flush(); await act(() => vi.advanceTimersByTime(3000));
  view.rerender(dialog("b")); await flush();
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "ticket" });
  expect((screen.getByRole("button", { name: "Confirm in 3s" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("ignores a stale preparation response after the selection changes", async () => {
  let resolveOld!: (value: ReturnType<typeof result>) => void;
  mocks.prepare.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const view = render(dialog()); view.rerender(dialog("b")); await flush();
  await act(async () => { resolveOld(result("old-ticket")); await Promise.resolve(); });
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "old-ticket" });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("qualified assignments continue without an override warning", async () => {
  mocks.prepare.mockResolvedValue({ ticket: null, mismatches: [] });
  render(dialog()); await flush(); expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith();
  expect(screen.queryByText("Assign a tutor without this qualification?")).toBeNull();
});
it("uses named native groups, preserves selectable unqualified tutors, and updates by course", () => {
  const select = (subjectId: string) => <NextIntlClientProvider locale="en" messages={en}><QualifiedTutorSelect label="Tutor" subjectId={subjectId} tutors={[{ id: "a", englishName: "Ada" }, { id: "b", englishName: "Ben" }]} value="" onChange={mocks.confirm} /></NextIntlClientProvider>;
  const view = render(select("math"));
  expect(screen.getByRole("group", { name: "Qualified for this subject" }).textContent).toBe("Ben");
  expect(screen.getByRole("group", { name: "Not qualified — confirmation required" }).textContent).toBe("Ada");
  const control = screen.getByRole("combobox", { name: "Tutor" });
  control.focus(); expect(document.activeElement).toBe(control);
  fireEvent.change(control, { target: { value: "a" } }); expect(mocks.confirm).toHaveBeenCalledWith("a");
  view.rerender(select("other"));
  expect(screen.getByRole("group", { name: "Qualified for this subject" }).textContent).toBe("");
  expect(screen.getByText(/No tutors have an approved qualification/)).toBeTruthy();
});

/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import chinese from "../../../messages/zh.json";
import PatrolPage from "./page";

const state = vi.hoisted(() => ({
  hours: 0, status: "ACTIVE", isPending: false, isSuccess: true,
  error: null as { message: string } | null, mutate: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ crew: { myStatus: { invalidate: vi.fn() } } }),
  crew: {
    myStatus: { useQuery: () => ({ data: { status: state.status, pendingRequest: null } }) },
    patrolConfig: { useQuery: () => ({ data: { rooms: [{ id: "room", name: "Test room" }], myHours: 0.5, myPatrols: 2 } }) },
    myPatrols: { useQuery: () => ({ data: [] }) },
    requestOptOut: { useMutation: () => ({ mutate: vi.fn() }) },
    recallOptOut: { useMutation: () => ({ mutate: vi.fn() }) },
    requestReentry: { useMutation: () => ({ mutate: vi.fn() }) },
    submitPatrol: { useMutation: () => ({ ...state, data: { hours: state.hours } }) },
  },
} }));
afterEach(cleanup);
beforeEach(() => {
  Object.assign(state, { hours: 0, status: "ACTIVE", isPending: false, isSuccess: true, error: null });
  state.mutate.mockReset();
});
const view = (locale: "en" | "zh" = "en") => <NextIntlClientProvider locale={locale} timeZone="Asia/Shanghai" messages={locale === "zh" ? chinese : messages}><PatrolPage /></NextIntlClientProvider>;
const show = (locale: "en" | "zh" = "en") => render(view(locale));

it("announces that evidence was saved without claiming zero-hour submissions earned credit", () => {
  state.hours = 0; show();
  expect(screen.getByRole("status").textContent).toMatch(/saved with no additional hours/);
  expect(screen.getByRole("status").textContent).toMatch(/20-minute allowance/);
  expect(screen.getByText(/all observations from the last 20 minutes/)).toBeTruthy();
});
it("keeps the ordinary success confirmation for an awarded sweep", () => {
  state.hours = 0.5; show();
  expect(screen.getByRole("status").textContent).toBe("Patrol recorded.");
});

it.each([0, 0.5])("localizes the actual %s-hour outcome in Chinese", (hours) => {
  state.hours = hours; show("zh");
  expect(screen.getByRole("status").textContent).toBe(hours === 0
    ? chinese.crew.patrol.recordedWithoutCredit : chinese.crew.patrol.submitted);
});

it("disables submission while pending and retains the draft and request key after an error", () => {
  state.isSuccess = false;
  const rendered = show();
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  const note = screen.getByPlaceholderText(messages.crew.patrol.notePlaceholder);
  fireEvent.change(note, { target: { value: "Synthetic observation" } });
  fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
  const original = state.mutate.mock.calls[0]?.[0] as unknown;
  expect(original).toMatchObject({ note: "Synthetic observation", observations: [{ roomId: "room", headcount: "ONE" }] });
  state.isPending = true;
  rendered.rerender(view());
  expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.crew.patrol.submitting }).disabled).toBe(true);
  state.isPending = false;
  state.error = { message: "Temporary connection error" };
  rendered.rerender(view());
  expect(screen.getByRole("alert").textContent).toBe(state.error.message);
  expect((note as HTMLTextAreaElement).value).toBe("Synthetic observation");
  fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
  expect(state.mutate.mock.calls[1]?.[0]).toEqual(original);
});

it.each(["INACTIVE", "OPTED_OUT"])("does not offer patrol submission to %s crew", (status) => {
  state.status = status; show();
  expect(screen.queryByRole("button", { name: /Submit Patrol/ })).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});

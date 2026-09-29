/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import MeetingsPage from "./page";

const state = vi.hoisted(() => ({ save: vi.fn(), longName: "AlexandraMontgomeryWellingtonSyntheticTutor" }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ admin: { meetings: { invalidate: vi.fn() } } }),
  admin: {
    meetings: { useQuery: () => ({ data: [{ id: "meeting", title: "Synthetic briefing", date: new Date("2026-09-29T04:00:00Z"), attendances: [] }] }) },
    tutors: { useQuery: () => ({ data: [
      { id: "active", englishName: state.longName, status: "ACTIVE" },
      { id: "past", englishName: "Past Tutor", status: "ARCHIVED" },
    ] }) },
    createMeeting: { useMutation: () => ({ mutate: vi.fn() }) },
    deleteMeeting: { useMutation: () => ({ mutate: vi.fn() }) },
    recordMeetingAttendance: { useMutation: () => ({ mutate: state.save }) },
  },
} }));
afterEach(() => { cleanup(); state.save.mockClear(); });
function mount(readOnly = false) {
  render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Shanghai"><ReadOnlyProvider value={readOnly}><MeetingsPage /></ReadOnlyProvider></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Synthetic briefing/ }));
}

it("keeps long-name choices reachable with mobile touch targets and persists the selected status", () => {
  mount();
  const group = screen.getByRole("group", { name: state.longName });
  const row = group.parentElement!;
  // DOM checks guard responsive intent; running-browser dimensions are verified separately.
  expect(row.classList.contains("min-w-0")).toBe(true);
  expect(row.classList.contains("flex-col")).toBe(true);
  expect(group.classList.contains("flex-wrap")).toBe(true);
  for (const button of within(group).getAllByRole("button")) {
    expect(button.classList.contains("min-h-11")).toBe(true);
    expect(button.classList.contains("lg:min-h-8")).toBe(true);
    expect(button.classList.contains("whitespace-nowrap")).toBe(false);
  }
  const absent = within(group).getByRole("button", { name: "Unexcused Absent" });
  fireEvent.click(absent);
  expect(absent.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: messages.admin.meetings.saveAttendance }));
  expect(state.save).toHaveBeenCalledWith({ meetingId: "meeting", entries: [{ tutorId: "active", status: "UNEXCUSED_ABSENT" }] });
  expect(screen.queryByText("Past Tutor")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show past tutors" }));
  expect(screen.getByText("Past Tutor")).toBeTruthy();
});

it("keeps the responsive attendance choices read-only for viewers", () => {
  mount(true);
  const group = screen.getByRole("group", { name: state.longName });
  for (const button of within(group).getAllByRole<HTMLButtonElement>("button")) expect(button.disabled).toBe(true);
  expect(screen.queryByRole("button", { name: messages.admin.meetings.saveAttendance })).toBeNull();
});

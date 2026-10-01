/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import MeetingsPage from "./page";

const state = vi.hoisted(() => ({
  save: vi.fn(),
  reset: vi.fn(),
  pending: false,
  attendances: [] as {
    tutorId: string;
    status: string;
    excusedAt: Date | null;
    reason: string | null;
    tutor: { englishName: string };
  }[],
  longName: "AlexandraMontgomeryWellingtonSyntheticTutor",
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { meetings: { invalidate: vi.fn() } } }),
    admin: {
      meetings: {
        useQuery: () => ({
          data: [
            {
              id: "meeting",
              title: "Synthetic briefing",
              date: new Date("2026-09-29T04:00:00Z"),
              attendances: state.attendances,
            },
          ],
        }),
      },
      tutors: {
        useQuery: () => ({
          data: [
            { id: "active", englishName: state.longName, status: "ACTIVE" },
            { id: "past", englishName: "Past Tutor", status: "ARCHIVED" },
            {
              id: "recorded-past",
              englishName: "Recorded Graduate",
              status: "GRADUATED",
            },
          ],
        }),
      },
      createMeeting: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMeeting: { useMutation: () => ({ mutate: vi.fn() }) },
      recordMeetingAttendance: {
        useMutation: () => ({
          mutate: state.save,
          reset: state.reset,
          isPending: state.pending,
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.attendances = [];
  state.pending = false;
});
afterEach(cleanup);
function mount(readOnly = false) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <MeetingsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Synthetic briefing/ }));
}

it("keeps long-name choices reachable with mobile touch targets and persists the selected status", () => {
  mount();
  const group = screen.getByRole("group", {
    name: `Attendance for ${state.longName}`,
  });
  const row = group.parentElement!;
  // DOM checks guard responsive intent; running-browser dimensions are verified separately.
  expect(row.classList.contains("min-w-0")).toBe(true);
  expect(row.classList.contains("flex-col")).toBe(true);
  expect(group.classList.contains("flex-wrap")).toBe(true);
  for (const button of within(group).getAllByRole("button")) {
    expect(button.classList.contains("control-compact")).toBe(true);
    expect(button.classList.contains("whitespace-nowrap")).toBe(false);
  }
  const absent = within(group).getByRole("button", {
    name: "Unexcused Absent",
  });
  fireEvent.click(absent);
  expect(absent.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  );
  expect(state.save).toHaveBeenCalledWith({
    meetingId: "meeting",
    entries: [{ tutorId: "active", status: "UNEXCUSED_ABSENT" }],
  });
  expect(screen.queryByText("Past Tutor")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show past tutors" }));
  expect(screen.getByText("Past Tutor")).toBeTruthy();
});

it("keeps the responsive attendance choices read-only for viewers", () => {
  mount(true);
  const group = screen.getByRole("group", {
    name: `Attendance for ${state.longName}`,
  });
  for (const button of within(group).getAllByRole<HTMLButtonElement>("button"))
    expect(button.disabled).toBe(true);
  expect(
    screen.queryByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  ).toBeNull();
});

it("retains past tutors with attendance while hiding only unrecorded past tutors", () => {
  state.attendances = [
    {
      tutorId: "recorded-past",
      status: "PRESENT",
      excusedAt: null,
      reason: null,
      tutor: { englishName: "Recorded Graduate" },
    },
  ];
  mount();
  const editor = screen.getByRole("button", {
    name: messages.pastTutors.show,
  }).parentElement!;
  expect(within(editor).getByText("Recorded Graduate")).toBeTruthy();
  expect(within(editor).queryByText("Past Tutor")).toBeNull();
  expect(
    within(editor).queryByRole("group", { name: /Recorded Graduate/ }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.show }),
  );
  expect(within(editor).getByText("Past Tutor")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.hide }),
  );
  expect(within(editor).getByText("Recorded Graduate")).toBeTruthy();
  expect(within(editor).queryByText("Past Tutor")).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps an unsaved active-tutor choice through past-tutor reveal and hide", () => {
  mount();
  const group = screen.getByRole("group", {
    name: `Attendance for ${state.longName}`,
  });
  const present = within(group).getByRole("button", {
    name: messages.admin.meetings.status.present,
  });
  fireEvent.click(present);
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.show }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.hide }),
  );
  expect(
    screen.getByRole("group", { name: `Attendance for ${state.longName}` }),
  ).toBe(group);
  expect(present.getAttribute("aria-pressed")).toBe("true");
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  );
  expect(state.save).toHaveBeenCalledWith({
    meetingId: "meeting",
    entries: [{ tutorId: "active", status: "PRESENT" }],
  });
});

it("keeps all past tutors in the summary independently of the editor visibility toggle", () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.meetings.summary.show }),
  );
  const summary = screen.getByRole("region", {
    name: messages.admin.meetings.summary.show,
  });
  expect(within(summary).getByText("Past Tutor")).toBeTruthy();
  expect(within(summary).getByText("Recorded Graduate")).toBeTruthy();
  const editor = screen.getByRole("button", {
    name: messages.pastTutors.show,
  }).parentElement!;
  expect(within(editor).queryByText("Past Tutor")).toBeNull();
});

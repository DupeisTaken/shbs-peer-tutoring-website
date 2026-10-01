/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AccountSettings } from "./account-settings";
import MeetingsPage from "../(admin)/admin/meetings/page";
import LandingPage from "../(admin)/admin/landing/page";
import MyAccountPage from "../my-account/page";

const mocks = vi.hoisted(() => ({
  account: {
    id: "user-1",
    name: "Sammy Chen",
    alternativeNames: "山米",
    profileVersion: 4,
    role: "ADMIN",
    username: "sammy",
    email: "sammy@example.test",
    tutor: null,
  },
  accountLoaded: true,
  namePending: false,
  nameSuccess: false,
  nameError: null as { message: string } | null,
  updateName: vi.fn(),
  resetName: vi.fn(),
  saveAttendance: vi.fn(),
  resetAttendance: vi.fn(),
  attendancePending: false,
  attendanceError: null as { message: string } | null,
  deleteMeeting: vi.fn(),
  createMeeting: vi.fn(),
  refetchMeetings: vi.fn(),
  meetingError: null as { message: string } | null,
  readOnly: false,
  authorize: vi.fn(),
  editor: vi.fn(),
  meetings: [
    {
      id: "meeting-1",
      title: "Planning meeting",
      date: new Date("2030-01-05T04:00:00Z"),
      attendances: [
        {
          tutorId: "active",
          status: "PRESENT",
          excusedAt: null,
          reason: null,
          tutor: { englishName: "Alex Tutor" },
        },
        {
          tutorId: "excused",
          status: "EXCUSED_ABSENT",
          excusedAt: new Date("2030-01-04T04:00:00Z"),
          reason: "School trip",
          tutor: { englishName: "Charlie Tutor" },
        },
      ],
    },
  ],
  tutors: [
    { id: "active", englishName: "Alex Tutor", status: "ACTIVE" },
    { id: "inactive", englishName: "Bailey Tutor", status: "INACTIVE" },
    { id: "excused", englishName: "Charlie Tutor", status: "ACTIVE" },
  ],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("~/lib/password-session", () => ({
  signInAfterPasswordChange: vi.fn(),
}));
vi.mock("./membership-editor", () => ({ MembershipEditor: () => null }));
vi.mock("./account-emails", () => ({
  AccountEmails: () => null,
  EmailPreferences: () => null,
}));
vi.mock("./two-factor-settings", () => ({ TwoFactorSettings: () => null }));
vi.mock("./read-only", () => ({ useReadOnly: () => mocks.readOnly }));
vi.mock("./workflow-shell", () => ({
  WorkflowShell: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("~/server/home/images", () => ({
  authorizeHomeEditor: mocks.authorize,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("../(admin)/admin/landing/landing-editor", () => ({
  default: () => {
    mocks.editor();
    return <h2>Live landing editor</h2>;
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      account: { me: { invalidate: vi.fn() } },
      admin: { meetings: { invalidate: vi.fn() } },
    }),
    program: { features: { useQuery: () => ({ data: { EMAIL_2FA: false } }) } },
    account: {
      me: {
        useQuery: () => ({
          data: mocks.accountLoaded ? mocks.account : undefined,
        }),
      },
      updateName: {
        useMutation: () => ({
          mutate: mocks.updateName,
          isPending: mocks.namePending,
          isSuccess: mocks.nameSuccess,
          error: mocks.nameError,
          reset: () => {
            mocks.resetName();
            mocks.nameError = null;
            mocks.nameSuccess = false;
          },
        }),
      },
      requestPasswordChangeCode: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      changePassword: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    admin: {
      meetings: {
        useQuery: () => ({
          data: mocks.meetings,
          error: mocks.meetingError,
          refetch: mocks.refetchMeetings,
        }),
      },
      tutors: { useQuery: () => ({ data: mocks.tutors }) },
      createMeeting: {
        useMutation: () => ({ mutate: mocks.createMeeting, isPending: false }),
      },
      deleteMeeting: {
        useMutation: () => ({ mutate: mocks.deleteMeeting, isPending: false }),
      },
      recordMeetingAttendance: {
        useMutation: () => ({
          mutate: mocks.saveAttendance,
          isPending: mocks.attendancePending,
          error: mocks.attendanceError,
          reset: () => {
            mocks.resetAttendance();
            mocks.attendanceError = null;
          },
        }),
      },
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    {children}
  </NextIntlClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountLoaded = true;
  mocks.namePending = false;
  mocks.nameSuccess = false;
  mocks.nameError = null;
  mocks.attendancePending = false;
  mocks.attendanceError = null;
  mocks.meetingError = null;
  mocks.readOnly = false;
  mocks.authorize.mockResolvedValue({ ok: true, name: "Sammy" });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);

it("places the profile commit after both fields and submits their values together with the version", () => {
  render(<AccountSettings />, { wrapper });
  const group = screen.getByRole("group", { name: en.uiPatterns.profile });
  const name = within(group).getByRole("textbox", {
    name: en.tutor.settings.name,
  });
  const alternatives = within(group).getByRole("textbox", {
    name: en.accountProfile.alternativeNames,
  });
  const save = within(group).getByRole("button", {
    name: en.uiPatterns.saveProfile,
  });
  // This protects the save-scope defect: the alternate name used to appear after
  // the commit control, visually implying a separate or automatic save.
  expect(
    name.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    alternatives.compareDocumentPosition(save) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.change(name, { target: { value: "  Sammy Chen Updated  " } });
  fireEvent.change(alternatives, { target: { value: "  山米, Sam  " } });
  expect(mocks.updateName).not.toHaveBeenCalled();
  fireEvent.click(save);
  expect(mocks.updateName).toHaveBeenCalledExactlyOnceWith({
    name: "Sammy Chen Updated",
    alternativeNames: "山米, Sam",
    expectedProfileVersion: 4,
  });
});

it("cancels profile edits without saving and restores both current account fields", () => {
  render(<AccountSettings />, { wrapper });
  const group = screen.getByRole("group", { name: en.uiPatterns.profile });
  const name = within(group).getByRole<HTMLInputElement>("textbox", {
    name: en.tutor.settings.name,
  });
  const alternatives = within(group).getByRole<HTMLInputElement>("textbox", {
    name: en.accountProfile.alternativeNames,
  });
  fireEvent.change(name, { target: { value: "Draft name" } });
  fireEvent.change(alternatives, { target: { value: "Draft alternate" } });
  fireEvent.click(
    within(group).getByRole("button", { name: en.uiPatterns.cancel }),
  );
  expect(name.value).toBe("Sammy Chen");
  expect(alternatives.value).toBe("山米");
  expect(mocks.updateName).not.toHaveBeenCalled();
  expect(mocks.resetName).toHaveBeenCalled();
});

it("disables the entire profile while pending and preserves the draft when the save fails", () => {
  const view = render(<AccountSettings />, { wrapper });
  const group = screen.getByRole("group", { name: en.uiPatterns.profile });
  const name = within(group).getByRole<HTMLInputElement>("textbox", {
    name: en.tutor.settings.name,
  });
  fireEvent.change(name, { target: { value: "Keep this draft" } });
  fireEvent.click(
    within(group).getByRole("button", { name: en.uiPatterns.saveProfile }),
  );
  mocks.namePending = true;
  view.rerender(<AccountSettings />);
  for (const control of [
    ...within(group).getAllByRole("textbox"),
    ...within(group).getAllByRole("button"),
  ])
    expect(control.matches(":disabled")).toBe(true);
  mocks.namePending = false;
  mocks.nameError = {
    message: "Your profile changed elsewhere. Reload before saving.",
  };
  view.rerender(<AccountSettings />);
  expect(within(group).getByRole("alert").textContent).toContain(
    "changed elsewhere",
  );
  expect(name.value).toBe("Keep this draft");
  expect(name.matches(":disabled")).toBe(false);
  fireEvent.click(
    within(group).getByRole("button", { name: en.uiPatterns.cancel }),
  );
  expect(name.value).toBe("Sammy Chen");
  expect(within(group).queryByRole("alert")).toBeNull();
});

it("does not permit a profile commit before the account loads", () => {
  mocks.accountLoaded = false;
  render(<AccountSettings />, { wrapper });
  const group = screen.getByRole("group", { name: en.uiPatterns.profile });
  expect(group.getAttribute("aria-busy")).toBe("true");
  expect(
    within(group)
      .getByRole("button", { name: en.uiPatterns.saveProfile })
      .matches(":disabled"),
  ).toBe(true);
  expect(mocks.updateName).not.toHaveBeenCalled();
});

it("lets the My Account shell own the single page heading while retaining profile controls", async () => {
  render(await MyAccountPage(), { wrapper });
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "settings",
  );
  expect(
    screen.getByRole("group", { name: en.uiPatterns.profile }),
  ).toBeTruthy();
});

it("keeps attendance choices as a draft until Save and restores them on Cancel", () => {
  render(<MeetingsPage />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: /^Planning meeting/ }));
  const group = screen.getByRole("group", { name: /Alex Tutor/ });
  const present = within(group).getByRole("button", {
    name: en.admin.meetings.status.present,
  });
  const absent = within(group).getByRole("button", {
    name: en.admin.meetings.status.unexcusedAbsent,
  });
  expect(present.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(absent);
  expect(absent.getAttribute("aria-pressed")).toBe("true");
  expect(mocks.saveAttendance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.cancel }));
  expect(present.getAttribute("aria-pressed")).toBe("true");
  expect(absent.getAttribute("aria-pressed")).toBe("false");
  expect(mocks.saveAttendance).not.toHaveBeenCalled();
  fireEvent.click(absent);
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.meetings.saveAttendance }),
  );
  expect(mocks.saveAttendance).toHaveBeenCalledExactlyOnceWith({
    meetingId: "meeting-1",
    entries: [
      { tutorId: "active", status: "UNEXCUSED_ABSENT" },
      { tutorId: "excused", status: "EXCUSED_ABSENT" },
    ],
  });
  expect(screen.queryByRole("group", { name: /Bailey Tutor/ })).toBeNull();
  expect(screen.queryByRole("group", { name: /Charlie Tutor/ })).toBeNull();
});

it("disables attendance choices and cancellation while saving, then exposes the server failure", () => {
  const view = render(<MeetingsPage />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: /^Planning meeting/ }));
  const group = screen.getByRole("group", { name: /Alex Tutor/ });
  mocks.attendancePending = true;
  view.rerender(<MeetingsPage />);
  for (const control of within(group).getAllByRole("button"))
    expect(control.matches(":disabled")).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.uiPatterns.cancel })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: en.admin.meetings.saving })
      .matches(":disabled"),
  ).toBe(true);
  mocks.attendancePending = false;
  mocks.attendanceError = {
    message: "Attendance was not saved. Please retry.",
  };
  view.rerender(<MeetingsPage />);
  expect(screen.getByRole("alert").textContent).toBe(
    "Attendance was not saved. Please retry.",
  );
  expect(
    screen
      .getByRole("button", { name: en.admin.meetings.saveAttendance })
      .matches(":disabled"),
  ).toBe(false);
});

it("shows attendance without mutation actions to a read-only viewer", () => {
  mocks.readOnly = true;
  render(<MeetingsPage />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: /^Planning meeting/ }));
  const group = screen.getByRole("group", { name: /Alex Tutor/ });
  for (const button of within(group).getAllByRole("button")) {
    expect(button.matches(":disabled")).toBe(true);
    fireEvent.click(button);
  }
  expect(
    screen.queryByRole("button", { name: en.admin.meetings.saveAttendance }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.admin.meetings.create }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.admin.meetings.delete }),
  ).toBeNull();
  expect(mocks.saveAttendance).not.toHaveBeenCalled();
});

it("names the meeting being deleted and requires explicit confirmation before the mutation", async () => {
  render(<MeetingsPage />, { wrapper });
  const trigger = screen.getByRole("button", {
    name: en.admin.meetings.delete,
  });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: en.uiPatterns.deleteMeeting,
  });
  expect(dialog.textContent).toContain("Planning meeting");
  const cancel = within(dialog).getByRole("button", {
    name: en.uiPatterns.cancel,
  });
  expect(document.activeElement).toBe(cancel);
  await act(async () => {
    fireEvent.click(cancel);
  });
  expect(mocks.deleteMeeting).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: en.admin.meetings.delete,
      }),
    );
  });
  expect(mocks.deleteMeeting).toHaveBeenCalledExactlyOnceWith({
    id: "meeting-1",
  });
});

it("offers a retry when meetings fail to load", () => {
  mocks.meetingError = { message: "Could not reach the meeting service." };
  render(<MeetingsPage />, { wrapper });
  expect(screen.getByRole("alert").textContent).toContain(
    "Could not reach the meeting service.",
  );
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(mocks.refetchMeetings).toHaveBeenCalledOnce();
});

it("mounts the landing editor only after live authorization succeeds", async () => {
  // Invoke the thin server wrapper with its I/O mocked; async RSC rendering and
  // permission integration are covered by the running-site/server tests.
  render(await LandingPage());
  expect(mocks.authorize).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("heading", { name: "Live landing editor" }),
  ).toBeTruthy();
  expect(mocks.editor).toHaveBeenCalledOnce();
});

it("replaces a denied editor with a terminal access explanation and return route", async () => {
  mocks.authorize.mockResolvedValue({ ok: false, name: "Viewer" });
  render(await LandingPage());
  expect(mocks.authorize).toHaveBeenCalledOnce();
  expect(mocks.editor).not.toHaveBeenCalled();
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
  expect(
    screen.getByRole("heading", { name: "uiPatterns.editorDenied" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "uiPatterns.returnManagement" })
      .getAttribute("href"),
  ).toBe("/admin");
});

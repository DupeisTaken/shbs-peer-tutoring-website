// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { InterviewManagement } from "./interview-management";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  qualify: vi.fn(),
  complete: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      interviewManagement: { options: { invalidate: mocks.refetch } },
      admin: { tutorApplications: { invalidate: mocks.refetch } },
    }),
    interviewManagement: {
      options: { useQuery: mocks.options },
      qualify: { useMutation: () => ({ mutate: mocks.qualify }) },
      complete: { useMutation: () => ({ mutate: mocks.complete }) },
    },
  },
}));
const fixture = () => ({
  tutors: [
    { id: "alice", englishName: "Alice Long Tutor Name", status: "ACTIVE" },
    { id: "bob", englishName: "Bob", status: "ACTIVE" },
  ],
  subjects: [
    { id: "math", name: "Math", active: true },
    { id: "biology", name: "Biology", active: true },
  ],
  qualifications: [
    { tutorId: "alice", subjectId: "math" },
    { tutorId: "alice", subjectId: "biology" },
  ],
  applications: {
    pageSize: 20,
    total: 2,
    rows: [
      {
        id: "candidate",
        name: "Candidate One",
        status: "INTERVIEW",
        interviewAt: new Date("2026-09-10T08:00:00Z"),
        interviewCompletedAt: null,
        interviewDurationMin: null,
        subjectIntents: [{ subject: { name: "Math" } }],
        interviewers: [
          {
            tutorId: "alice",
            attended: true,
            isHead: true,
            tutor: { englishName: "Alice Long Tutor Name" },
          },
        ],
      },
      {
        id: "completed",
        name: "Earlier Candidate",
        status: "ACCEPTED",
        interviewAt: null,
        interviewCompletedAt: new Date("2026-09-01T08:00:00Z"),
        interviewDurationMin: 45,
        subjectIntents: [],
        interviewers: [],
      },
    ],
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockReturnValue({ data: fixture(), refetch: mocks.refetch });
});
afterEach(cleanup);
const show = (locale = "en") =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <InterviewManagement />
    </NextIntlClientProvider>,
  );
it("shows panel/chair/schedule/completion without expansion and deep-links the existing panel editor", () => {
  show();
  expect(screen.getByText("Chair: Alice Long Tutor Name")).toBeTruthy();
  expect(screen.getByText(/Completed:.*45 minutes/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: /Candidate One Needs completion/ }),
  );
  expect(
    screen
      .getByRole("link", {
        name: "Assign or edit this panel in Tutor Applications",
      })
      .getAttribute("href"),
  ).toBe("/admin/applications#application-candidate");
  const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
  fireEvent.change(within(form).getByLabelText("Record Interview Completion"), {
    target: { value: "2026-09-10T16:00" },
  });
  fireEvent.change(within(form).getByLabelText("Decision Reason"), {
    target: { value: "Verified records" },
  });
  fireEvent.submit(form);
  expect(mocks.complete).toHaveBeenCalledWith({
    applicationId: "candidate",
    completedAt: new Date("2026-09-10T08:00:00Z"),
    durationMin: 30,
    attendedTutorIds: ["alice"],
    reason: "Verified records",
  });
});
it("submits interview search and completed filters to the paginated API", () => {
  show();
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "Search applicants, panelists or subjects",
    }),
    { target: { value: " Math " } },
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Search" }).closest("form")!,
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Interview records" }),
    { target: { value: "COMPLETED" } },
  );
  expect(mocks.options).toHaveBeenLastCalledWith({
    page: 0,
    search: "Math",
    completion: "COMPLETED",
  });
});
it("keeps historical records readable while completion is disabled", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <InterviewManagement enabled={false} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Candidate One Needs completion/ }),
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.getByText(/Interviews are disabled/)).toBeTruthy();
  expect(screen.getByText("Chair: Alice Long Tutor Name")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Remove Qualification" }),
  ).toBeNull();
});

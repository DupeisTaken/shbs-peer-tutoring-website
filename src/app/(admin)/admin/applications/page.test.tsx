// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import ApplicationsPage from "./page";
import { ReadOnlyProvider } from "~/app/_components/read-only";

const mocks = vi.hoisted(() => ({
  enabled: true,
  history: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: () => null,
}));
vi.mock("~/app/_components/interview-management", () => ({
  InterviewManagement: (props: { enabled: boolean }) => {
    mocks.history(props);
    return <div>Interview history destination</div>;
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { tutorApplications: { invalidate: mocks.invalidate } },
      interviewManagement: { options: { invalidate: mocks.invalidate } },
    }),
    program: {
      features: { useQuery: () => ({ data: { INTERVIEWS: mocks.enabled } }) },
    },
    admin: {
      tutorApplications: {
        useQuery: () => ({
          data: [
            {
              id: "candidate",
              name: "Candidate One",
              email: "candidate@example.test",
              preferredContact: null,
              status: "ACCEPTED",
              updatedAt: new Date("2026-09-01"),
              interviewAt: null,
              subjectIntents: [],
              interviewers: [
                {
                  isHead: true,
                  tutor: { id: "chair", englishName: "Panel Chair" },
                },
              ],
              votes: [
                {
                  accept: true,
                  comment: "Preserved vote",
                  tutor: { englishName: "Panel Chair" },
                },
              ],
              decisionComment: "Preserved decision",
              decidedByTutor: { englishName: "Panel Chair" },
            },
          ],
        }),
      },
      tutors: { useQuery: () => ({ data: [] }) },
      assignInterviewers: { useMutation: () => ({ mutate: vi.fn() }) },
      setApplicationStatus: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteApplication: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
});
afterEach(cleanup);
const show = (viewer = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <ReadOnlyProvider value={viewer}>
        <ApplicationsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );

it("mounts interview history alongside application panel management", () => {
  show();
  expect(
    screen
      .getByText("Interview history destination")
      .closest("#interview-records"),
  ).toBeTruthy();
  expect(mocks.history).toHaveBeenCalledWith({ enabled: true });
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(
    screen
      .getByRole("link", { name: "Subject Availability" })
      .getAttribute("href"),
  ).toBe("/admin/subject-availability");
});
it("retains vote and decision evidence when interviews are disabled", () => {
  mocks.enabled = false;
  show();
  expect(mocks.history).toHaveBeenCalledWith({ enabled: false });
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(screen.getByText(/Preserved vote/)).toBeTruthy();
  expect(screen.getByText(/Preserved decision/)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("does not mount the staff-only completion query for a viewer", () => {
  show(true);
  expect(mocks.history).not.toHaveBeenCalled();
  expect(screen.queryByText("Interview history destination")).toBeNull();
});

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
  additional: false,
  role: "HEAD",
  decide: vi.fn(),
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
      admin: {
        tutorApplications: { invalidate: mocks.invalidate },
        tutors: { invalidate: mocks.invalidate },
      },
      interviewManagement: { options: { invalidate: mocks.invalidate } },
      qualificationApplication: { mine: { invalidate: mocks.invalidate } },
      subjectAvailability: { options: { invalidate: mocks.invalidate } },
    }),
    account: {
      me: {
        useQuery: () => ({ data: { role: mocks.role, tutorId: "chair" } }),
      },
    },
    qualificationApplication: {
      decide: { useMutation: () => ({ mutate: mocks.decide }) },
    },
    program: {
      features: { useQuery: () => ({ data: { INTERVIEWS: mocks.enabled } }) },
    },
    admin: {
      tutorApplications: {
        useQuery: () => ({
          data: [
            {
              id: "candidate",
              type: mocks.additional ? "ADDITIONAL_SUBJECT" : "INITIAL",
              requestedTutorId: mocks.additional ? "candidate-tutor" : null,
              qualificationReason: mocks.additional
                ? "New subject evidence"
                : null,
              qualificationSnapshot: null,
              name: "Candidate One",
              email: "candidate@example.test",
              preferredContact: null,
              status: mocks.additional ? "PENDING" : "ACCEPTED",
              updatedAt: new Date("2026-09-01"),
              interviewAt: null,
              subjectIntents: mocks.additional
                ? [
                    {
                      taken: false,
                      grade: null,
                      hasApScore: false,
                      apScore: null,
                      selfStudied: false,
                      selfStudyNote: null,
                      subject: { name: "AP Literature", level: { name: "AP" } },
                    },
                  ]
                : [],
              interviewers: mocks.additional
                ? []
                : [
                    {
                      isHead: true,
                      tutor: { id: "chair", englishName: "Panel Chair" },
                    },
                  ],
              votes: mocks.additional
                ? []
                : [
                    {
                      accept: true,
                      comment: "Preserved vote",
                      tutor: { englishName: "Panel Chair" },
                    },
                  ],
              decisionComment: mocks.additional ? null : "Preserved decision",
              decidedByTutor: mocks.additional
                ? null
                : { englishName: "Panel Chair" },
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
  mocks.additional = false;
  mocks.role = "HEAD";
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

it("keeps additional qualification review alongside consolidated history without account setup or deletion", () => {
  mocks.additional = true;
  show();
  expect(screen.getByText("Additional subject")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(screen.getByText("New subject evidence")).toBeTruthy();
  expect(screen.getAllByText("AP Literature").length).toBeGreaterThan(0);
  expect(screen.queryByText(/no qualification given/i)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Approve qualification" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(screen.queryByRole("link", { name: /account/i })).toBeNull();
  expect(mocks.history).toHaveBeenCalledWith({ enabled: true });
});

it("does not expose additional request decisions or panel setup to Coordinators", () => {
  mocks.additional = true;
  mocks.role = "COORDINATOR";
  show();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(
    screen.queryByRole("button", { name: "Approve qualification" }),
  ).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.getByText("Another Admin or Head must review this request."),
  ).toBeTruthy();
});

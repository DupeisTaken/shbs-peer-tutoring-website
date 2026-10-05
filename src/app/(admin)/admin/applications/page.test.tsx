// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { InvalidationTarget } from "~/lib/invalidate-refresh";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import ApplicationsPage from "./page";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { projectManagementRead } from "~/server/management-read-models";
import { applicationRow, PRIVATE } from "~/test/management-read-fixtures";

const mocks = vi.hoisted(() => ({
  enabled: true,
  history: vi.fn(),
  invalidate: vi.fn(),
  additional: false,
  role: "HEAD",
  decide: vi.fn(),
  minimized: false,
  success: undefined as undefined | (() => Promise<void>),
  invalidateApplications: vi.fn<InvalidationTarget["invalidate"]>(),
  invalidateOptions: vi.fn<InvalidationTarget["invalidate"]>(),
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
        tutorApplications: { invalidate: mocks.invalidateApplications },
        tutors: { invalidate: mocks.invalidate },
      },
      interviewManagement: { options: { invalidate: mocks.invalidateOptions } },
      tutorDetails: { get: { invalidate: mocks.invalidate } },
      qualificationApplication: { mine: { invalidate: mocks.invalidate } },
      subjectAvailability: { options: { invalidate: mocks.invalidate } },
    }),
    account: {
      me: {
        useQuery: () => ({ data: { role: mocks.role, tutorId: "chair" } }),
      },
    },
    qualificationApplication: {
      decide: {
        useMutation: (callbacks: {
          onSuccess: () => Promise<void>;
          onSettled: () => void;
        }) => {
          mocks.success = async () => {
            await callbacks.onSuccess();
            callbacks.onSettled();
          };
          return { mutate: mocks.decide };
        },
      },
    },
    program: {
      features: { useQuery: () => ({ data: { INTERVIEWS: mocks.enabled } }) },
    },
    admin: {
      tutorApplications: {
        useQuery: () => ({
          data: mocks.minimized
            ? projectManagementRead("admin.tutorApplications", [applicationRow])
            : [
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
                          subjectId: "literature",
                          taken: false,
                          grade: null,
                          hasApScore: false,
                          apScore: null,
                          selfStudied: false,
                          selfStudyNote: null,
                          subject: {
                            name: "AP Literature",
                            level: { name: "AP" },
                          },
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
                  decisionComment: mocks.additional
                    ? null
                    : "Preserved decision",
                  decidedByTutor: mocks.additional
                    ? null
                    : { englishName: "Panel Chair" },
                },
              ],
        }),
      },
      subjectEligibility: { useQuery: () => ({ data: [], isLoading: false }) },
      tutors: { useQuery: () => ({ data: [] }) },
      assignInterviewers: { useMutation: () => ({ mutate: vi.fn() }) },
      setApplicationStatus: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteApplication: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.success = undefined;
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.invalidateApplications.mockResolvedValue(undefined);
  mocks.invalidateOptions.mockResolvedValue(undefined);
  mocks.enabled = true;
  mocks.additional = false;
  mocks.role = "HEAD";
  mocks.minimized = false;
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
  expect(mocks.history).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: true }),
  );
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
  expect(mocks.history).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(screen.getByText(/Preserved vote/)).toBeTruthy();
  expect(screen.getByText(/Preserved decision/)).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: /Panelist/ })).toBeNull();
});

it("retains an unsaved panel draft when the application is collapsed and reopened", () => {
  show();
  const toggle = screen.getByRole("button", { name: /Candidate One/ });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Add Interviewer" }));
  fireEvent.click(toggle);
  expect(screen.queryByRole("combobox", { name: /Panelist 4/ })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("combobox", { name: /Panelist 4/ })).toBeTruthy();
});
it("does not mount the staff-only completion query for a viewer", () => {
  show(true);
  expect(mocks.history).not.toHaveBeenCalled();
  expect(screen.queryByText("Interview history destination")).toBeNull();
});

it.each(["VIEWER", "TUTOR"])(
  "renders projected application summaries for read-only %s access",
  (role) => {
    mocks.role = role;
    mocks.minimized = true;
    show(true);
    fireEvent.click(screen.getByRole("button", { name: /Applicant One/ }));
    expect(screen.getAllByText(/Math/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tutor One/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(PRIVATE);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  },
);

it.each([true, false])(
  "keeps additional qualification review alongside history with interviews=%s",
  (enabled) => {
    mocks.additional = true;
    mocks.enabled = enabled;
    show();
    expect(screen.getAllByText("Additional subject").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
    expect(screen.getByText("New subject evidence")).toBeTruthy();
    expect(screen.getAllByText("AP Literature").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no qualification given/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Approve without Interview" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Decision note")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve without Interview" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Review Qualification Request" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Decision note")).toBeTruthy();
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("link", { name: /account/i })).toBeNull();
    expect(mocks.history).toHaveBeenCalledWith(
      expect.objectContaining({ enabled }),
    );
  },
);

it("does not expose additional request decisions or panel setup to Coordinators", () => {
  mocks.additional = true;
  mocks.role = "COORDINATOR";
  show();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(
    screen.queryByRole("button", { name: "Approve qualification" }),
  ).toBeNull();
  expect(screen.queryByRole("combobox", { name: /Panelist/ })).toBeNull();
  expect(
    screen.getByText("Another Admin or Head must review this request."),
  ).toBeTruthy();
});

it.each([
  { failedTarget: "options", heldTarget: "applications" },
  { failedTarget: "applications", heldTarget: "options" },
  { failedTarget: "applications", heldTarget: "applications" },
  { failedTarget: "options", heldTarget: "options" },
])(
  "retains qualification review after $failedTarget fails while $heldTarget is held",
  async ({ failedTarget, heldTarget }) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let release!: () => void;
    const held = new Promise<string>((resolve) => {
      release = () => resolve("fresh held");
    });
    const heldRead = vi.fn(() => held);
    const failedRead = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Page refresh unavailable"))
      .mockResolvedValue("fresh failed");
    // Cover both the nested page aggregate and multiple active variants matching
    // one procedure prefix. Cached data keeps the retained review usable.
    const pending = new QueryObserver(client, {
      queryKey: [heldTarget, "held"],
      queryFn: heldRead,
      initialData: "cached held",
      staleTime: Infinity,
    });
    const failed = new QueryObserver(client, {
      queryKey: [failedTarget, "failed"],
      queryFn: failedRead,
      initialData: "cached failed",
      staleTime: Infinity,
    });
    const stopPending = pending.subscribe(() => undefined);
    const stopFailed = failed.subscribe(() => undefined);
    mocks.invalidateApplications.mockImplementation(
      (_input, filters, options) =>
        client.invalidateQueries(
          { queryKey: ["applications"], ...filters },
          options,
        ),
    );
    mocks.invalidateOptions.mockImplementation((_input, filters, options) =>
      client.invalidateQueries({ queryKey: ["options"], ...filters }, options),
    );
    let completion: Promise<void> | undefined;
    try {
      mocks.additional = true;
      show();
      fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
      fireEvent.click(
        screen.getByRole("button", { name: "Approve without Interview" }),
      );
      fireEvent.change(screen.getByLabelText("Decision note"), {
        target: { value: "Reviewed synthetic evidence" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Approve qualification" }),
      );
      expect(mocks.decide).toHaveBeenCalledOnce();
      await act(async () => {
        completion = mocks.success!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await waitFor(() => expect(failed.getCurrentResult().isError).toBe(true));
      expect(failed.getCurrentResult().data).toBe("cached failed");
      expect(pending.getCurrentResult().isFetching).toBe(true);
      expect(heldRead).toHaveBeenCalledOnce();
      const dialog = screen.getByRole("dialog", {
        name: "Review Qualification Request",
      });
      expect(dialog.getAttribute("aria-busy")).toBe("true");
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
          .disabled,
      ).toBe(true);
      expect(screen.queryByText("Page refresh unavailable")).toBeNull();
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(dialog.isConnected).toBe(true);
      await act(async () => {
        release();
        await completion;
      });
      expect(screen.getByText("Page refresh unavailable")).toBeTruthy();
      expect(dialog.getAttribute("aria-busy")).toBe("false");
      expect(
        screen.queryByRole("button", { name: "Approve qualification" }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(failedRead).toHaveBeenCalledTimes(2);
      expect(heldRead).toHaveBeenCalledTimes(2);
      expect(mocks.decide).toHaveBeenCalledOnce();
    } finally {
      release();
      await completion;
      stopPending();
      stopFailed();
      client.clear();
    }
  },
);

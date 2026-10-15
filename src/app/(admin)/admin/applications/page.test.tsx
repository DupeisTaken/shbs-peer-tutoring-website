// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  invalid: false,
  name: "Candidate One",
  changeInvalidity: vi.fn(),
  fetchApplications: vi.fn(),
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
        tutorApplications: {
          invalidate: mocks.invalidateApplications,
          fetch: mocks.fetchApplications,
        },
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
                  isInvalid: mocks.invalid,
                  invalidReason: mocks.invalid
                    ? "Private duplicate reason"
                    : null,
                  invalidatedAt: mocks.invalid ? new Date("2026-10-10") : null,
                  invalidatedByName: mocks.invalid
                    ? "Private staff actor"
                    : null,
                  invalidityVersion: mocks.invalid ? 1 : 0,
                  type: mocks.additional ? "ADDITIONAL_SUBJECT" : "INITIAL",
                  requestedTutorId: mocks.additional ? "candidate-tutor" : null,
                  qualificationReason: mocks.additional
                    ? "New subject evidence"
                    : null,
                  qualificationSnapshot: null,
                  name: mocks.name,
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
      setApplicationInvalidity: {
        useMutation: () => ({ mutateAsync: mocks.changeInvalidity }),
      },
    },
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.success = undefined;
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.invalidateApplications.mockResolvedValue(undefined);
  mocks.invalidateOptions.mockResolvedValue(undefined);
  mocks.changeInvalidity.mockResolvedValue({ ok: true });
  mocks.fetchApplications.mockImplementation(async () => [
    {
      id: "candidate",
      isInvalid: mocks.invalid,
      invalidReason: mocks.invalid ? "Private duplicate reason" : null,
      invalidatedAt: mocks.invalid ? new Date("2026-10-10") : null,
      invalidatedByName: mocks.invalid ? "Private staff actor" : null,
      invalidityVersion: 2,
    },
  ]);
  mocks.enabled = true;
  mocks.additional = false;
  mocks.role = "HEAD";
  mocks.minimized = false;
  mocks.invalid = false;
  mocks.name = "Candidate One";
});
afterEach(cleanup);
it("presents an accountless blank-name application without treating its label as searchable intake data", () => {
  mocks.name = "  ";
  render(content());
  expect(screen.getByText(en.participantNames.unnamed)).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Name or email" }), {
    target: { value: en.participantNames.unnamed },
  });
  expect(screen.queryByText(en.participantNames.unnamed)).toBeNull();
  expect(mocks.name).toBe("  ");
  expect(mocks.changeInvalidity).not.toHaveBeenCalled();
});
const content = (viewer = false) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    <ReadOnlyProvider value={viewer}>
      <ApplicationsPage />
    </ReadOnlyProvider>
  </NextIntlClientProvider>
);
const show = (viewer = false) => {
  const view = render(content(viewer));
  if (mocks.invalid)
    fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  return view;
};

it("puts account navigation before boxed decisions and Delete last in keyboard order", () => {
  show();
  const setup = screen.getByRole("link", {
    name: en.admin.applications.setupAccount,
  });
  const actions = setup.parentElement!;
  // Native DOM order also drives keyboard traversal when the same row wraps.
  expect(
    [...actions.querySelectorAll("a, button")].map((action) =>
      action.textContent?.trim(),
    ),
  ).toEqual([
    en.admin.applications.setupAccount,
    en.requestInvalidity.flag,
    en.admin.applications.delete,
  ]);
  expect(setup.getAttribute("href")).toBe("/admin/users");
});

it("retains an open invalidity draft and its version when a background flag removes the application from its filter", async () => {
  const view = show();
  fireEvent.click(screen.getByRole("button", { name: "Active entries" }));
  fireEvent.click(screen.getByRole("button", { name: "Flag invalid" }));
  fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox"), {
    target: { value: "My pending application review" },
  });
  mocks.invalid = true;
  view.rerender(content());
  expect(screen.queryByRole("button", { name: /Candidate One/ })).toBeNull();
  const dialog = screen.getByRole("dialog", {
    name: "Flag Candidate One as Invalid?",
  });
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "My pending application review",
  );
  mocks.changeInvalidity.mockRejectedValueOnce(
    new Error("Application changed"),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Flag invalid" }));
  await waitFor(() =>
    expect(screen.getByText("Application changed")).toBeTruthy(),
  );
  expect(mocks.changeInvalidity).toHaveBeenCalledExactlyOnceWith({
    id: "candidate",
    invalid: true,
    reason: "My pending application review",
    expectedInvalidityVersion: 0,
  });
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "My pending application review",
  );
});

it.each([false, true])(
  "retains saved invalidity recovery after the primary application list filters out the row (clearing=%s)",
  async (clearing) => {
    mocks.invalid = clearing;
    const view = show();
    fireEvent.click(
      screen.getByRole("button", {
        name: clearing ? "Invalid entries" : "Active entries",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: clearing ? "Review invalid flag" : "Flag invalid",
      }),
    );
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox"), {
      target: { value: "Reviewed application evidence" },
    });
    let rejectSibling!: (error: Error) => void;
    const sibling = new Promise<void>((_resolve, reject) => {
      rejectSibling = reject;
    });
    mocks.invalidateOptions.mockImplementationOnce(() => sibling);
    // The first successful refresh removes the card while its sibling remains in
    // flight. The page, rather than that filtered card, must still own the write.
    mocks.invalidateApplications.mockImplementation(async () => {
      mocks.invalid = !clearing;
      view.rerender(content());
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: clearing ? "Clear invalid flag" : "Flag invalid",
      }),
    );
    await waitFor(() =>
      expect(mocks.invalidateApplications).toHaveBeenCalledOnce(),
    );
    expect(screen.queryByRole("button", { name: /Candidate One/ })).toBeNull();
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      rejectSibling(new Error("Interview history refresh failed"));
    });
    await waitFor(() =>
      expect(screen.getByText(en.requestInvalidity.refreshFailed)).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", {
        name: clearing ? "Clear invalid flag" : "Flag invalid",
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const recovery = screen.getByRole("region", { name: "Candidate One" });
    expect(
      within(recovery).getByText("Interview history refresh failed"),
    ).toBeTruthy();
    fireEvent.click(
      within(recovery).getByRole("button", { name: "Retry refresh" }),
    );
    await waitFor(() =>
      expect(screen.getByText(en.requestInvalidity.saved)).toBeTruthy(),
    );
    expect(screen.queryByText(en.requestInvalidity.refreshFailed)).toBeNull();
    expect(mocks.fetchApplications).toHaveBeenCalledOnce();
    expect(mocks.changeInvalidity).toHaveBeenCalledExactlyOnceWith({
      id: "candidate",
      invalid: !clearing,
      reason: "Reviewed application evidence",
      expectedInvalidityVersion: clearing ? 1 : 0,
    });
  },
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
it("keeps flagged interview evidence visible while hiding panel processing controls", () => {
  mocks.invalid = true;
  show();
  expect(screen.getByText("Invalid entry")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Review invalid flag" }),
  ).toBeTruthy();
  expect(screen.queryByText("Private duplicate reason")).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(
    screen.queryByRole("link", { name: en.admin.applications.setupAccount }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(screen.queryByRole("button", { name: "Add Interviewer" })).toBeNull();
  expect(screen.getByText(/Preserved vote/)).toBeTruthy();
  expect(screen.getByText(/Preserved decision/)).toBeTruthy();
});
it("shows a viewer the invalid badge without mounting a private flag editor", () => {
  mocks.invalid = true;
  show(true);
  expect(screen.getByText("Invalid entry")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Review invalid flag" }),
  ).toBeNull();
  expect(screen.queryByText("Private duplicate reason")).toBeNull();
  expect(screen.queryByText("Private staff actor")).toBeNull();
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

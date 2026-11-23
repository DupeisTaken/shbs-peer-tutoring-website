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
import zh from "../../../../../messages/zh.json";
import ApplicationsPage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { projectManagementRead } from "~/server/management-read-models";
import { applicationRow, PRIVATE } from "~/test/management-read-fixtures";

const mocks = vi.hoisted(() => {
  const navigation: {
    promotedTutorId: string | null;
    setupTutorId: string | null;
  } = {
    promotedTutorId: "promoted-tutor",
    setupTutorId: "promoted-tutor",
  };
  return {
    ...navigation,
    enabled: true,
    applicationsFetching: false,
    applicationsError: null as null | { message: string },
    history: vi.fn(),
    identity: vi.fn(),
    invalidate: vi.fn(),
    additional: false,
    interview: false,
    interviewPanel: ["chair", "second", "third"],
    interviewVotes: [true, true, true],
    role: "HEAD",
    decide: vi.fn(),
    minimized: false,
    invalid: false,
    name: "Candidate One",
    setupRead: vi.fn(),
    setupState: "active",
    changeInvalidity: vi.fn(),
    fetchApplications: vi.fn(),
    success: undefined as undefined | (() => Promise<void>),
    invalidateApplications: vi.fn<InvalidationTarget["invalidate"]>(),
    invalidateOptions: vi.fn<InvalidationTarget["invalidate"]>(),
    invalidateInterviews: vi.fn<InvalidationTarget["invalidate"]>(),
  };
});
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: () => null,
}));
vi.mock("~/app/_components/application-identity-correction", () => ({
  ApplicationIdentityCorrection: (props: unknown) => { mocks.identity(props); return null; },
}));
vi.mock("~/app/_components/interview-management", () => ({
  InterviewManagement: (props: { enabled: boolean }) => {
    mocks.history(props);
    return <div>Interview history destination</div>;
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    notification: {
      requestEmailStatus: {
        useQuery: () => ({
          data: null,
          isSuccess: true,
          isFetching: false,
          refetch: async () => ({ data: null, error: null }),
        }),
      },
      retryRequestEmail: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      declineRequestAppeal: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({
      admin: {
        tutorApplications: {
          invalidate: mocks.invalidateApplications,
          fetch: mocks.fetchApplications,
        },
        tutors: { invalidate: mocks.invalidate },
      },
      interviewManagement: { options: { invalidate: mocks.invalidateOptions } },
      tutor: { myInterviews: { invalidate: mocks.invalidateInterviews } },
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
      applicationAccountSetup: {
        useQuery: (input: { applicationId: string }) => {
          mocks.setupRead(input);
          return {
            data: {
              state: mocks.setupState,
              tutorId: mocks.setupTutorId,
              account: null,
              invitation:
                mocks.setupState === "active"
                  ? {
                      id: "existing-code",
                      code: "ABCDE",
                      expiresAt: new Date("2099-01-01"),
                    }
                  : null,
            },
            isSuccess: true,
            isFetching: false,
            error: null,
            refetch: vi.fn(),
          };
        },
      },
      tutorApplications: {
        useQuery: () => ({
          isFetching: mocks.applicationsFetching,
          isSuccess: !mocks.applicationsError,
          error: mocks.applicationsError,
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
                  promotedTutorId: mocks.promotedTutorId,
                  setupTutorId: mocks.setupTutorId,
                  qualificationReason: mocks.additional
                    ? "New subject evidence"
                    : null,
                  qualificationSnapshot: null,
                  name: mocks.name,
                  email: "candidate@example.test",
                  preferredContact: null,
                  status: mocks.interview
                    ? "INTERVIEW"
                    : mocks.additional
                      ? "PENDING"
                      : "ACCEPTED",
                  updatedAt: new Date("2026-09-01"),
                  interviewAt: null,
                  interviewCompletedAt: null,
                  interviewDurationMin: null,
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
                  interviewers: mocks.interview
                    ? mocks.interviewPanel.map((id) => ({
                        isHead: id === "chair",
                        attended: false,
                        tutor: { id, englishName: id },
                      }))
                    : mocks.additional
                      ? []
                      : [
                          {
                            isHead: true,
                            tutor: { id: "chair", englishName: "Panel Chair" },
                          },
                        ],
                  votes: mocks.interview
                    ? mocks.interviewVotes.map((accept, index) => ({
                        accept,
                        comment: "Reviewed",
                        tutor: {
                          englishName:
                            mocks.interviewPanel[index] ?? "Panelist",
                        },
                      }))
                    : mocks.additional
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
  window.history.replaceState(null, "", "/admin/applications");
  sessionStorage.clear();
  mocks.applicationsFetching = false;
  mocks.applicationsError = null;
  mocks.success = undefined;
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.invalidateApplications.mockResolvedValue(undefined);
  mocks.invalidateOptions.mockResolvedValue(undefined);
  mocks.invalidateInterviews.mockResolvedValue(undefined);
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
  mocks.interview = false;
  mocks.interviewPanel = ["chair", "second", "third"];
  mocks.interviewVotes = [true, true, true];
  mocks.role = "HEAD";
  mocks.minimized = false;
  mocks.invalid = false;
  mocks.name = "Candidate One";
  mocks.promotedTutorId = "promoted-tutor";
  mocks.setupTutorId = "promoted-tutor";
  mocks.setupState = "active";
});
afterEach(cleanup);
it.each(["HEAD", "ADMIN", "COORDINATOR"])("opens initial identity evidence with explicit correction authority for %s", (role) => {
  mocks.role = role;
  show();
  expect(mocks.identity).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(mocks.identity).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "candidate", canCorrect: true, canApply: role === "HEAD" || role === "ADMIN" }));
  expect(mocks.decide).not.toHaveBeenCalled();
});

it("keeps correction controls out of the read-only application evidence view", () => {
  render(content(true));
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.decide).not.toHaveBeenCalled();
});
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
const content = (
  viewer = false,
  locale: "en" | "zh" = "en",
  applicationMessages: Partial<typeof en.admin.applications> = {},
) => {
  const messages = locale === "zh" ? zh : en;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        ...messages,
        admin: {
          ...messages.admin,
          applications: {
            ...messages.admin.applications,
            ...applicationMessages,
          },
        },
      }}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={viewer}>
        <ApplicationsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>
  );
};
const show = (viewer = false) => {
  const view = render(content(viewer));
  if (mocks.invalid)
    fireEvent.click(screen.getByRole("button", { name: "Invalid entries" }));
  return view;
};

it("puts the account popup action before boxed decisions and Delete last in keyboard order", () => {
  show();
  const setup = screen.getByRole("button", {
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
  expect(setup.getAttribute("aria-haspopup")).toBe("dialog");
  expect(mocks.setupRead).not.toHaveBeenCalled();
});

it("opens the exact application popup even when no tutor link exists", () => {
  mocks.promotedTutorId = null;
  mocks.setupTutorId = null;
  mocks.setupState = "missing";
  show();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.applications.setupAccount }),
  );
  expect(mocks.setupRead).toHaveBeenCalledWith({ applicationId: "candidate" });
  expect(screen.getByText(en.applicationAccountSetup.missing)).toBeTruthy();
  expect(screen.queryByText("ABCDE")).toBeNull();
});

it("shows the existing application code when the promotion column is empty", () => {
  mocks.promotedTutorId = null;
  mocks.setupTutorId = "legacy-code-tutor";
  show();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.applications.setupAccount }),
  );
  expect(mocks.setupRead).toHaveBeenCalledWith({ applicationId: "candidate" });
  expect(screen.getByText("ABCDE")).toBeTruthy();
});

it("withholds account setup navigation from read-only application observers", () => {
  show(true);
  expect(
    screen.queryByRole("button", {
      name: en.admin.applications.setupAccount,
    }),
  ).toBeNull();
  expect(mocks.setupRead).not.toHaveBeenCalled();
  expect(
    screen.queryByText(en.admin.applications.setupTargetUnavailable),
  ).toBeNull();
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
    expect(mocks.invalidateInterviews).toHaveBeenCalledOnce();
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
  expect(
    screen.getByRole("button", { name: /Candidate One.*1 accept · 0 reject/ }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  expect(screen.getByText(/Preserved vote/)).toBeTruthy();
  expect(screen.getByText(/Preserved decision/)).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: /Panelist/ })).toBeNull();
});

it.each(
  (["en", "zh"] as const).flatMap((locale) =>
    [0, 2, 3, 4, 8].map((count) => ({ locale, count })),
  ),
)(
  "shows the actual $count-member panel and its supported range in $locale",
  ({ locale, count }) => {
    mocks.interview = true;
    mocks.interviewPanel = Array.from({ length: count }, (_, index) =>
      index === 0 ? "chair" : `panelist-${index + 1}`,
    );
    mocks.interviewVotes = [];
    render(content(false, locale));
    const expectedCount =
      locale === "zh"
        ? `面试小组 ${count} 人（至少 3 人）`
        : `panel ${count} (minimum 3)`;
    const toggle = screen.getByRole("button", {
      name: (name) =>
        name.includes("Candidate One") && name.includes(expectedCount),
    });
    expect(toggle.textContent).not.toMatch(/\d\/3/);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(
      screen.getByText(
        locale === "zh"
          ? "面试小组（3–8 人，一名组长）"
          : "Interview Panel (3–8 Tutors, One Chair)",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        locale === "zh"
          ? /由 3–8 名辅导伙伴组成的面试小组，指定其中一名为组长/
          : /interview panel of 3–8 tutors, with one chair/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        locale === "zh"
          ? "请选择 3–8 名不同的辅导伙伴，并指定其中一名为组长。"
          : "Pick 3–8 distinct tutors and mark one as chair.",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("combobox", {
        name: locale === "zh" ? /面试官/ : /Panelist/,
      }),
    ).toHaveLength(Math.max(3, count));
    expect(mocks.decide).not.toHaveBeenCalled();
  },
);

it.each(
  (["en", "zh"] as const).flatMap((locale) =>
    [
      {
        scenario: "all rejected",
        votes: [false, false, false],
        panel: ["chair", "second", "third"],
        tally: { en: "0 accept · 3 reject", zh: "0 票通过 · 3 票拒绝" },
      },
      {
        scenario: "mixed votes",
        votes: [true, false, true],
        panel: ["chair", "second", "third"],
        tally: { en: "2 accept · 1 reject", zh: "2 票通过 · 1 票拒绝" },
      },
      {
        scenario: "a larger partially voted panel",
        votes: [false, true],
        panel: ["chair", "second", "third", "fourth", "fifth"],
        tally: { en: "1 accept · 1 reject", zh: "1 票通过 · 1 票拒绝" },
      },
      {
        scenario: "no votes",
        votes: [],
        panel: ["chair", "second", "third"],
        tally: null,
      },
    ].map((testCase) => ({ ...testCase, locale })),
  ),
)(
  "keeps collapsed and expanded vote evidence consistent for $scenario in $locale",
  ({ locale, votes, panel, tally }) => {
    mocks.interview = true;
    mocks.interviewPanel = panel;
    mocks.interviewVotes = votes;
    render(content(false, locale));

    const messages = locale === "zh" ? zh : en;
    const labels = messages.admin.applications;
    const expectedTally = tally?.[locale];
    const expectedPanel =
      locale === "zh"
        ? `面试小组 ${panel.length} 人（至少 3 人）`
        : `panel ${panel.length} (minimum 3)`;
    const expectedSummary = [labels.noCourses, expectedPanel, expectedTally]
      .filter(Boolean)
      .join(" · ");
    const toggle = screen.getByRole("button", {
      name: (name) =>
        name.includes("Candidate One") && name.includes(expectedSummary),
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(toggle).getByText(expectedSummary)).toBeTruthy();
    expect(toggle.textContent).not.toMatch(/(?:votes|投票) \d\/\d/);
    if (!expectedTally) {
      expect(toggle.textContent).not.toMatch(/(?:accept|reject|票通过|票拒绝)/);
    }

    fireEvent.click(toggle);
    const details = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    if (expectedTally) {
      expect(within(details).getByText(expectedTally)).toBeTruthy();
      expect(within(details).getAllByText(/Reviewed/)).toHaveLength(
        votes.length,
      );
    } else {
      expect(within(details).getByText(labels.noVotes)).toBeTruthy();
    }
    expect(mocks.decide).not.toHaveBeenCalled();
  },
);

it("leaves an unused malformed live tally override unresolved when no votes are recorded", () => {
  mocks.interview = true;
  mocks.interviewVotes = [];
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    render(content(false, "en", { voteTally: "{accepts" }));
    const toggle = screen.getByRole("button", { name: /Candidate One/ });
    expect(errors).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    const details = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    expect(within(details).getByText("No votes yet.")).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

it("does not restore fixed-three labels from legacy overrides while retaining a compatible tally override", () => {
  mocks.interview = true;
  mocks.interviewPanel = ["chair", "second", "third", "fourth"];
  mocks.interviewVotes = [false, false, false];
  render(
    content(false, "en", {
      panelSummary: "Legacy panel {n}/{total}",
      panelHeading: "Legacy choose {n}",
      intro: "Legacy assign {n}",
      pickHint: "Legacy pick {n}",
      votesSummary: "Legacy votes {accepts}/{total}",
      voteTally: "Accepted: {accepts}; rejected: {rejects}",
    }),
  );
  const toggle = screen.getByRole("button", {
    name: /Candidate One.*panel 4 \(minimum 3\).*Accepted: 0; rejected: 3/,
  });
  fireEvent.click(toggle);
  expect(
    screen.getByText("Interview Panel (3–8 Tutors, One Chair)"),
  ).toBeTruthy();
  expect(
    screen.getByText("Pick 3–8 distinct tutors and mark one as chair."),
  ).toBeTruthy();
  const details = document.getElementById(
    toggle.getAttribute("aria-controls")!,
  )!;
  expect(within(details).getByText("Accepted: 0; rejected: 3")).toBeTruthy();
  expect(screen.queryByText(/Legacy/)).toBeNull();
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
    screen.queryByRole("button", { name: en.admin.applications.setupAccount }),
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
    expect(mocks.identity).not.toHaveBeenCalled();
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

it("keeps an open interview approval draft mounted when its application leaves the current filter", () => {
  mocks.additional = true;
  mocks.interview = true;
  show();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  fireEvent.change(screen.getByLabelText("Decision note"), {
    target: { value: "Ready for the next subject" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Approve qualification" }),
  );
  const dialog = screen.getByRole("dialog", {
    name: "Approve Interview · Candidate One",
  });
  expect(dialog).toBeTruthy();
  // A filter change (or equivalent background status transition) cannot discard
  // the open form's captured evidence before its own cancellation/close boundary.
  fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
    target: { value: "COMPLETED_DESC" },
  });
  fireEvent.change(
    screen.getByRole("combobox", { name: "Interview completion" }),
    {
      target: { value: "COMPLETED" },
    },
  );
  expect(
    screen.getByRole("dialog", { name: "Approve Interview · Candidate One" }),
  ).toBe(dialog);
  expect(
    within(dialog).getByDisplayValue("Ready for the next subject"),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Name or email" }), {
    target: { value: "No matching name" },
  });
  expect(
    screen.getByRole("dialog", { name: "Approve Interview · Candidate One" }),
  ).toBe(dialog);
  expect(
    within(dialog).getByDisplayValue("Ready for the next subject"),
  ).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("dialog", { name: "Approve Interview · Candidate One" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: /Candidate One/ })).toBeNull();
  expect(mocks.decide).not.toHaveBeenCalled();
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

const notificationContent = () => (
  <SessionViewProvider identity="head" pathname="/admin/applications" verified>
    {content(true)}
  </SessionViewProvider>
);

it("does not replace a deliberate application search when a notification read settles later", () => {
  window.history.replaceState(
    null,
    "",
    "/admin/applications#application-candidate",
  );
  mocks.applicationsFetching = true;
  const view = render(notificationContent());
  const search = screen.getByRole<HTMLInputElement>("searchbox", {
    name: "Name or email",
  });
  fireEvent.change(search, { target: { value: "My explicit search" } });
  mocks.applicationsFetching = false;
  view.rerender(notificationContent());
  expect(search.value).toBe("My explicit search");
  expect(screen.queryByText(en.workflow.noticeTargetMissing)).toBeNull();
  expect(screen.queryByText("Candidate One")).toBeNull();
});

it("does not resolve a missing notification against stale failed application data", () => {
  window.history.replaceState(
    null,
    "",
    "/admin/applications#application-missing",
  );
  mocks.applicationsError = { message: "Refresh failed" };
  const view = render(notificationContent());
  expect(screen.queryByText(en.workflow.noticeTargetMissing)).toBeNull();
  mocks.applicationsError = null;
  view.rerender(notificationContent());
  expect(screen.getByText(en.workflow.noticeTargetMissing)).toBeTruthy();
});

it("resolves a fresh application arrival once and preserves later filter edits", () => {
  window.history.replaceState(
    null,
    "",
    "/admin/applications#application-candidate",
  );
  const view = render(notificationContent());
  const search = screen.getByRole<HTMLInputElement>("searchbox", {
    name: "Name or email",
  });
  expect(search.value).toBe("");
  fireEvent.change(search, { target: { value: "Later choice" } });
  view.rerender(notificationContent());
  expect(search.value).toBe("Later choice");
  expect(screen.queryByText("Candidate One")).toBeNull();
});

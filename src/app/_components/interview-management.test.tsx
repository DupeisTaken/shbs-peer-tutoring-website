// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { InterviewManagement } from "./interview-management";
import type { ComponentProps } from "react";
import type Link from "next/link";
// Match Next Link's onNavigate boundary: modified/new-tab clicks retain native handling.
vi.mock("next/link", () => ({
  default: ({
    href,
    onNavigate,
    scroll: _scroll,
    ...props
  }: ComponentProps<typeof Link>) => (
    <a
      {...props}
      href={typeof href === "string" ? href : (href.pathname ?? "")}
      onClick={(event) => {
        props.onClick?.(event);
        if (
          !event.defaultPrevented &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        )
          onNavigate?.({ preventDefault: () => event.preventDefault() });
      }}
    />
  ),
}));
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  qualify: vi.fn(),
  complete: vi.fn(),
  refetch: vi.fn(),
  fetch: vi.fn(),
  exactFetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      interviewManagement: {
        options: { invalidate: mocks.refetch, fetch: mocks.exactFetch },
        completionEvidence: { fetch: mocks.fetch, invalidate: mocks.refetch },
      },
      admin: {
        tutorApplications: { invalidate: mocks.refetch },
        registrationCodes: { invalidate: mocks.refetch },
      },
      tutor: { myInterviews: { invalidate: mocks.refetch } },
    }),
    interviewManagement: {
      options: { useQuery: mocks.options },
      qualify: { useMutation: () => ({ mutate: mocks.qualify }) },
      complete: { useMutation: () => ({ mutateAsync: mocks.complete }) },
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
const evidence = (applicationId = "candidate") => {
  const application = fixture().applications.rows.find(
    (row) => row.id === applicationId,
  )!;
  return {
    ...application,
    completionParticipants: application.interviewers.map((person) => ({
      ...person,
      tutor: { ...person.tutor, status: "ACTIVE" },
      creditHours: 0,
      currentPanel: true,
    })),
  };
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.options.mockReturnValue({ data: fixture(), refetch: mocks.refetch });
  mocks.exactFetch.mockImplementation(
    async ({ applicationId }: { applicationId: string }) => ({
      ...fixture(),
      applications: {
        ...fixture().applications,
        rows: fixture().applications.rows.filter(
          (row) => row.id === applicationId,
        ),
      },
    }),
  );
  mocks.fetch.mockImplementation(
    async ({ applicationId }: { applicationId: string }) =>
      evidence(applicationId),
  );
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
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
it("hands history links to the existing same-page record observer, including repeated fragments", () => {
  window.history.replaceState({ retained: true }, "", "/admin/applications");
  show();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  const link = screen.getByRole("link", {
    name: en.workflows.manageApplicantPanel,
  });
  const observed = vi.fn();
  window.addEventListener("hashchange", observed);
  try {
    // Prevent jsdom's native navigation after observing that modifiers never enter the adapter.
    const nativeClick = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("click", nativeClick, { once: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(window.location.hash).toBe("");
    expect(observed).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(window.location.hash).toBe("#application-candidate");
    expect(window.history.state).toEqual({ retained: true });
    expect(observed).toHaveBeenCalledTimes(1);
    fireEvent.click(link);
    expect(observed).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener("hashchange", observed);
    window.history.replaceState(null, "", "/");
  }
});

it("shows panel/chair/schedule/completion without expansion and deep-links the existing panel editor", async () => {
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
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.record }),
  );
  await waitFor(() =>
    expect(
      document.getElementById("interview-completion-editor"),
    ).not.toBeNull(),
  );
  const form = document.getElementById("interview-completion-editor")!;
  fireEvent.change(within(form).getByLabelText("Record Interview Completion"), {
    target: { value: "2026-09-10T16:00" },
  });
  fireEvent.change(within(form).getByLabelText(en.interviewReview.reason), {
    target: { value: "Verified records" },
  });
  fireEvent.submit(form);
  expect(mocks.complete).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.confirmAward }),
  );
  expect(mocks.complete).toHaveBeenCalledWith({
    applicationId: "candidate",
    completedAt: new Date("2026-09-10T08:00:00Z"),
    durationMin: 30,
    attendedTutorIds: ["alice"],
    reason: "Verified records",
    expectedUpdatedAt: undefined,
  });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: en.common.close })
        .disabled,
    ).toBe(false),
  );
});
it("preserves an explicit completion date sort when changing completion scope", () => {
  show();
  fireEvent.change(
    screen.getByRole("combobox", { name: en.admin.applications.filters.sort }),
    {
      target: { value: "COMPLETED_ASC" },
    },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: en.workflows.interviewFilter }),
    {
      target: { value: "COMPLETED" },
    },
  );
  expect(mocks.options).toHaveBeenLastCalledWith({
    page: 0,
    search: "",
    completion: "COMPLETED",
    status: "",
    sort: "COMPLETED_ASC",
  });
});

it.each(["sort", "status"] as const)(
  "retains read controls and a saved completion draft through an uncached %s request and retry",
  async (field) => {
    let state: "ready" | "loading" | "error" = "ready";
    let switched = false;
    mocks.options.mockImplementation(
      (input: { sort: string; status: string }) => {
        switched =
          field === "sort"
            ? input.sort === "COMPLETED_ASC"
            : input.status === "INTERVIEW";
        return !switched || state === "ready"
          ? { data: fixture(), refetch: mocks.refetch }
          : state === "loading"
            ? { data: undefined, refetch: mocks.refetch }
            : {
                data: undefined,
                error: new Error("Uncached records failed"),
                refetch: mocks.refetch,
              };
      },
    );
    const tree = () => (
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <InterviewManagement />
      </NextIntlClientProvider>
    );
    const page = render(tree());
    fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.record }),
    );
    await waitFor(() =>
      expect(
        document.getElementById("interview-completion-editor"),
      ).not.toBeNull(),
    );
    const form = document.getElementById("interview-completion-editor")!;
    fireEvent.change(within(form).getByLabelText(en.interviewReview.reason), {
      target: { value: "Retained attendance evidence" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: en.workflows.interviewSearch }),
      { target: { value: " Unsubmitted " } },
    );
    state = "loading";
    fireEvent.change(
      screen.getByRole("combobox", {
        name:
          field === "sort"
            ? en.admin.applications.filters.sort
            : en.admin.applications.filters.status,
      }),
      {
        target: { value: field === "sort" ? "COMPLETED_ASC" : "INTERVIEW" },
      },
    );
    expect(switched).toBe(true);
    expect(screen.getByText(en.workflows.loading)).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    state = "error";
    page.rerender(tree());
    expect(screen.getByRole("alert").textContent).toContain(
      "Uncached records failed",
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
    );
    expect(mocks.refetch).toHaveBeenCalled();
    state = "ready";
    page.rerender(tree());
    expect(
      screen.getByRole<HTMLInputElement>("searchbox", {
        name: en.workflows.interviewSearch,
      }).value,
    ).toBe(" Unsubmitted ");
    expect(
      screen
        .getByRole("button", { name: /Candidate One/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", {
        name:
          field === "sort"
            ? en.admin.applications.filters.sort
            : en.admin.applications.filters.status,
      }).value,
    ).toBe(field === "sort" ? "COMPLETED_ASC" : "INTERVIEW");
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.record }),
    );
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Retained attendance evidence"),
      ).toBeTruthy(),
    );
    expect(mocks.complete).not.toHaveBeenCalled();
  },
);

it("submits interview search and completed filters to the paginated API", () => {
  show();
  fireEvent.change(
    screen.getByRole("searchbox", {
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
    status: "",
    sort: "COMPLETED_DESC",
  });
});
it("applies completion immediately while retaining an unsubmitted search draft", () => {
  show();
  const search = screen.getByRole<HTMLInputElement>("searchbox", {
    name: en.workflows.interviewSearch,
  });
  fireEvent.change(search, { target: { value: " Math " } });
  expect(mocks.options).toHaveBeenLastCalledWith({
    page: 0,
    search: "",
    completion: "OPEN",
    status: "",
    sort: "CREATED_DESC",
  });
  fireEvent.change(
    screen.getByRole("combobox", { name: en.workflows.interviewFilter }),
    { target: { value: "COMPLETED" } },
  );
  expect(search.value).toBe(" Math ");
  expect(mocks.options).toHaveBeenLastCalledWith({
    page: 0,
    search: "",
    completion: "COMPLETED",
    status: "",
    sort: "COMPLETED_DESC",
  });
  fireEvent.submit(search.closest("form")!);
  expect(mocks.options).toHaveBeenLastCalledWith({
    page: 0,
    search: "Math",
    completion: "COMPLETED",
    status: "",
    sort: "COMPLETED_DESC",
  });
});
it.each(["en", "zh"] as const)(
  "changes %s status and sort immediately, resetting pages but retaining drafts and disclosures",
  (locale) => {
    const data = fixture();
    data.applications.total = 45;
    mocks.options.mockReturnValue({ data, refetch: mocks.refetch });
    const messages = locale === "zh" ? zh : en;
    show(locale);
    const search = screen.getByRole<HTMLInputElement>("searchbox", {
      name: messages.workflows.interviewSearch,
    });
    const record = screen.getByRole("button", { name: /Candidate One/ });
    fireEvent.click(record);
    fireEvent.change(search, { target: { value: " Unsubmitted " } });
    const status = screen.getByRole<HTMLSelectElement>("combobox", {
      name: messages.admin.applications.filters.status,
    });
    const sort = screen.getByRole<HTMLSelectElement>("combobox", {
      name: messages.admin.applications.filters.sort,
    });
    fireEvent.click(
      screen.getByRole("button", { name: messages.workflows.next }),
    );
    fireEvent.change(status, { target: { value: "ACCEPTED" } });
    expect(mocks.options).toHaveBeenLastCalledWith({
      page: 0,
      search: "",
      completion: "OPEN",
      status: "ACCEPTED",
      sort: "CREATED_DESC",
    });
    fireEvent.click(
      screen.getByRole("button", { name: messages.workflows.next }),
    );
    fireEvent.change(sort, { target: { value: "COMPLETED_DESC" } });
    expect(mocks.options).toHaveBeenLastCalledWith({
      page: 0,
      search: "",
      completion: "OPEN",
      status: "ACCEPTED",
      sort: "COMPLETED_DESC",
    });
    expect(search.value).toBe(" Unsubmitted ");
    expect(record.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.admin.applications.filters.reset,
      }),
    );
    expect(status.value).toBe("");
    expect(sort.value).toBe("CREATED_DESC");
    expect(search.value).toBe("");
    expect(record.getAttribute("aria-expanded")).toBe("true");
    expect(mocks.complete).not.toHaveBeenCalled();
  },
);
it.each(["en", "zh"] as const)(
  "resets %s interview search, draft, completion and page without collapsing a record",
  (locale) => {
    const data = fixture();
    data.applications.total = 45;
    mocks.options.mockReturnValue({ data, refetch: mocks.refetch });
    const messages = locale === "zh" ? zh : en;
    show(locale);
    const search = screen.getByRole<HTMLInputElement>("searchbox", {
      name: messages.workflows.interviewSearch,
    });
    const completion = screen.getByRole<HTMLSelectElement>("combobox", {
      name: messages.workflows.interviewFilter,
    });
    const reset = screen.getByRole<HTMLButtonElement>("button", {
      name: messages.admin.applications.filters.reset,
    });
    expect(reset.disabled).toBe(true);
    const record = screen.getByRole("button", { name: /Candidate One/ });
    fireEvent.click(record);
    fireEvent.change(search, { target: { value: " Math " } });
    fireEvent.submit(search.closest("form")!);
    fireEvent.change(completion, { target: { value: "ALL" } });
    fireEvent.click(
      screen.getByRole("button", { name: messages.workflows.next }),
    );
    expect(mocks.options).toHaveBeenLastCalledWith({
      page: 1,
      search: "Math",
      completion: "ALL",
      status: "",
      sort: "CREATED_DESC",
    });
    fireEvent.change(search, { target: { value: "Unsubmitted search" } });
    fireEvent.click(reset);
    expect(mocks.options).toHaveBeenLastCalledWith({
      page: 0,
      search: "",
      completion: "OPEN",
      status: "",
      sort: "CREATED_DESC",
    });
    expect(search.value).toBe("");
    expect(completion.value).toBe("OPEN");
    expect(reset.disabled).toBe(true);
    expect(record.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(
      messages.workflows.interviewCount
        .replace("{first}", "1")
        .replace("{last}", "20")
        .replace("{total}", "45"),
    );
    expect(mocks.complete).not.toHaveBeenCalled();
  },
);

it("retains invalid interview history without offering completion writes", () => {
  const data = fixture();
  mocks.options.mockReturnValue({
    data: {
      ...data,
      applications: {
        ...data.applications,
        rows: data.applications.rows.map((row) => ({
          ...row,
          isInvalid: row.id === "candidate",
        })),
      },
    },
  });
  show();
  fireEvent.click(
    screen.getByRole("button", { name: /Candidate One Invalid entry/ }),
  );
  expect(screen.getByText(en.requestInvalidity.processingPaused)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.interviewReview.record }),
  ).toBeNull();
  expect(
    screen.getByRole("link", {
      name: "Assign or edit this panel in Tutor Applications",
    }),
  ).toBeTruthy();
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
  expect(
    screen.queryByRole("button", { name: en.interviewReview.record }),
  ).toBeNull();
  expect(screen.getByText(/Interviews are disabled/)).toBeTruthy();
  expect(screen.getByText("Chair: Alice Long Tutor Name")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Remove Qualification" }),
  ).toBeNull();
});

it("keeps an initial query denial latched across background success until explicit recovery", async () => {
  const denied = Object.assign(new Error("Management access revoked"), {
    data: { code: "FORBIDDEN" },
  });
  mocks.options.mockReturnValue({
    data: fixture(),
    error: denied,
    isSuccess: false,
    isFetching: false,
    refetch: mocks.refetch,
  });
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <InterviewManagement />
    </NextIntlClientProvider>
  );
  const view = render(tree());
  expect(screen.queryByText("Candidate One")).toBeNull();
  mocks.options.mockReturnValue({
    data: fixture(),
    error: null,
    isSuccess: true,
    isFetching: false,
    refetch: mocks.refetch,
  });
  view.rerender(tree());
  expect(screen.queryByText("Candidate One")).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe(
    en.interviewReview.accessDenied,
  );
  mocks.refetch.mockResolvedValueOnce({ data: fixture(), error: null });
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
  );
  await waitFor(() => expect(screen.getByText("Candidate One")).toBeTruthy());
  expect(mocks.complete).not.toHaveBeenCalled();
});

it.each(["save", "reload"])(
  "conceals a cached-success host after %s denial and recovers only through a successful fresh read",
  async (source) => {
    const denial = Object.assign(
      new Error("Current management access revoked"),
      { data: { code: "FORBIDDEN" } },
    );
    mocks.complete.mockRejectedValueOnce(
      source === "save" ? denial : new Error("Evidence changed"),
    );
    if (source === "reload")
      mocks.fetch
        .mockImplementationOnce(
          async ({ applicationId }: { applicationId: string }) => {
            const application = fixture().applications.rows.find(
              (row) => row.id === applicationId,
            )!;
            return {
              ...application,
              completionParticipants: application.interviewers.map(
                (person) => ({
                  ...person,
                  tutor: { ...person.tutor, status: "ACTIVE" },
                  creditHours: 0,
                  currentPanel: true,
                }),
              ),
            };
          },
        )
        .mockRejectedValueOnce(denial);
    show();
    fireEvent.click(
      screen.getByRole("button", { name: /Candidate One Needs completion/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.record }),
    );
    await waitFor(() =>
      expect(
        document.getElementById("interview-completion-editor"),
      ).not.toBeNull(),
    );
    fireEvent.change(screen.getByLabelText(en.workflows.interviewComplete), {
      target: { value: "2026-09-10T16:00" },
    });
    fireEvent.change(screen.getByLabelText(en.interviewReview.reason), {
      target: { value: "Verified attendance" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.review }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.confirmAward }),
    );
    if (source === "reload") {
      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: en.interviewReview.reloadEvidence,
          }),
        ).toBeTruthy(),
      );
      fireEvent.click(
        screen.getByRole("button", { name: en.interviewReview.reloadEvidence }),
      );
    }
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        en.interviewReview.accessDenied,
      ),
    );
    expect(screen.queryByText("Candidate One")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    mocks.refetch.mockRejectedValueOnce(new Error("Transport failed"));
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: en.interviewReview.refreshOnly,
        }).disabled,
      ).toBe(false),
    );
    expect(screen.queryByText("Candidate One")).toBeNull();
    mocks.refetch.mockResolvedValueOnce({ data: fixture(), error: null });
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
    );
    await waitFor(() => expect(screen.getByText("Candidate One")).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  },
);

it("loads exact completion evidence before opening, retains readable history on failure and retries reads only", async () => {
  mocks.fetch.mockRejectedValueOnce(
    new Error("Historical service evidence unavailable"),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  const open = screen.getByRole("button", { name: en.interviewReview.record });
  fireEvent.click(open);
  fireEvent.click(open);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Historical service evidence unavailable",
    ),
  );
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledWith(
    { applicationId: "candidate" },
    { staleTime: 0 },
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Candidate One")).toBeTruthy();
  expect(mocks.complete).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
  );
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("opens historical correction when all current assignments are gone using only evidenced former participants", async () => {
  const former = {
    tutorId: "historical",
    tutor: {
      englishName: "Historical Inactive Participant",
      status: "GRADUATED",
    },
    attended: true,
    creditHours: 0.75,
    currentPanel: false,
  };
  mocks.fetch.mockResolvedValueOnce({
    ...evidence("completed"),
    completionParticipants: [former],
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: /Earlier Candidate/ }));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.correct }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Historical Inactive Participant"),
    ).toBeTruthy(),
  );
  expect(
    screen.getByLabelText<HTMLInputElement>("Historical Inactive Participant")
      .checked,
  ).toBe(true);
  expect(screen.getByText(en.admin.tutorStatus.GRADUATED)).toBeTruthy();
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("blocks dependent opening and confirmation on failed owning reads while preserving a historical draft", async () => {
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <InterviewManagement />
    </NextIntlClientProvider>
  );
  mocks.options.mockReturnValue({
    data: fixture(),
    error: new Error("Background read failed"),
    refetch: mocks.refetch,
  });
  const view = render(tree());
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  const open = screen.getByRole<HTMLButtonElement>("button", {
    name: en.interviewReview.record,
  });
  expect(open.disabled).toBe(true);
  fireEvent.click(open);
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.options.mockReturnValue({ data: fixture(), refetch: mocks.refetch });
  view.rerender(tree());
  fireEvent.click(open);
  await waitFor(() =>
    expect(
      document.getElementById("interview-completion-editor"),
    ).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText(en.workflows.interviewComplete), {
    target: { value: "2026-09-10T16:00" },
  });
  fireEvent.change(screen.getByLabelText(en.interviewReview.reason), {
    target: { value: "Retain evidence through failed reads" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.review }),
  );
  mocks.options.mockReturnValue({
    data: fixture(),
    error: new Error("Background read failed again"),
    refetch: mocks.refetch,
  });
  view.rerender(tree());
  const confirm = screen.getByRole<HTMLButtonElement>("button", {
    name: en.interviewReview.confirmAward,
  });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(screen.getByText("Retain evidence through failed reads")).toBeTruthy();
});

it("does not let a late evidence success reopen private details after denial and explicit recovery", async () => {
  let finish!: (value: ReturnType<typeof evidence>) => void;
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <InterviewManagement />
    </NextIntlClientProvider>
  );
  const view = render(tree());
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.record }),
  );
  const denied = Object.assign(new Error("Management access revoked"), {
    data: { code: "FORBIDDEN" },
  });
  mocks.options.mockReturnValue({
    data: fixture(),
    error: denied,
    isSuccess: false,
    refetch: mocks.refetch,
  });
  view.rerender(tree());
  expect(screen.queryByText("Candidate One")).toBeNull();
  expect(screen.queryByText(/Total credit/)).toBeNull();
  mocks.options.mockReturnValue({
    data: fixture(),
    isSuccess: true,
    refetch: mocks.refetch,
  });
  view.rerender(tree());
  mocks.refetch.mockResolvedValueOnce({ data: fixture(), error: null });
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
  );
  await waitFor(() => expect(screen.getByText("Candidate One")).toBeTruthy());
  await act(async () => finish(evidence()));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.complete).not.toHaveBeenCalled();
});

it.each(["different identity", "denied read"] as const)(
  "refuses a completion evidence %s without revealing a private editor",
  async (scenario) => {
    if (scenario === "different identity")
      mocks.fetch.mockResolvedValueOnce({
        ...evidence(),
        id: "another-application",
      });
    else
      mocks.fetch.mockRejectedValueOnce(
        Object.assign(new Error("Read denied"), {
          data: { code: "FORBIDDEN" },
        }),
      );
    show();
    fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.record }),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
    if (scenario === "denied read")
      expect(screen.queryByText("Candidate One")).toBeNull();
    expect(mocks.complete).not.toHaveBeenCalled();
  },
);

const sourceEvidence = () => ({
  ...evidence("completed"),
  completionParticipants: [
    {
      tutorId: "original",
      tutor: {
        englishName: "Original Interview Participant",
        status: "OPTED_OUT",
      },
      attended: true,
      creditHours: 0.75,
      currentPanel: false,
    },
    {
      tutorId: "missed",
      tutor: {
        englishName: "Original Missed Participant",
        status: "GRADUATED",
      },
      attended: false,
      creditHours: 0,
      currentPanel: false,
    },
    {
      tutorId: "other",
      tutor: { englishName: "Original Other Participant", status: "ACTIVE" },
      attended: false,
      creditHours: 0,
      currentPanel: false,
    },
  ],
});
const arriveAtCompletion = (id: string) => {
  window.history.replaceState(
    null,
    "",
    `/admin/applications#interview-completion-${encodeURIComponent(id)}`,
  );
};

it("opens an exact completed source outside saved list scope once through reads without changing the list", async () => {
  const owner = fixture();
  owner.applications.rows = owner.applications.rows.filter(
    (row) => row.id === "candidate",
  );
  mocks.options.mockReturnValue({ data: owner, refetch: mocks.refetch });
  mocks.fetch.mockResolvedValueOnce(sourceEvidence());
  arriveAtCompletion("completed");
  show();
  await waitFor(() =>
    expect(
      screen.getByLabelText("Original Interview Participant"),
    ).toBeTruthy(),
  );
  expect(mocks.exactFetch).toHaveBeenCalledWith(
    {
      applicationId: "completed",
      page: 0,
      search: "",
      completion: "ALL",
      status: "",
      sort: "CREATED_DESC",
    },
    { staleTime: 0 },
  );
  expect(mocks.fetch).toHaveBeenCalledWith(
    { applicationId: "completed" },
    { staleTime: 0 },
  );
  expect(mocks.options).toHaveBeenLastCalledWith({
    page: 0,
    search: "",
    completion: "OPEN",
    status: "",
    sort: "CREATED_DESC",
  });
  fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
  fireEvent.change(
    screen.getByRole("combobox", {
      name: en.admin.applications.filters.status,
    }),
    { target: { value: "ACCEPTED" } },
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.exactFetch).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("offers top-level read-only retry when an exact source arrival cannot load outside the current list", async () => {
  mocks.exactFetch.mockRejectedValueOnce(
    new Error("Exact interview read failed"),
  );
  mocks.fetch.mockResolvedValueOnce(sourceEvidence());
  arriveAtCompletion("completed");
  show();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Exact interview read failed",
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: en.interviewReview.correctionEvidence.retryArrival,
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Original Interview Participant"),
    ).toBeTruthy(),
  );
  expect(mocks.exactFetch).toHaveBeenCalledTimes(2);
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("defers a source arrival while another completion draft is open and preserves that draft", async () => {
  mocks.fetch.mockImplementation(
    async ({ applicationId }: { applicationId: string }) =>
      applicationId === "completed"
        ? sourceEvidence()
        : evidence(applicationId),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: /Candidate One/ }));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.record }),
  );
  await waitFor(() =>
    expect(
      document.getElementById("interview-completion-editor"),
    ).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText(en.interviewReview.reason), {
    target: { value: "Retained unrelated completion draft" },
  });
  act(() => {
    arriveAtCompletion("completed");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(
    screen.getByDisplayValue("Retained unrelated completion draft"),
  ).toBeTruthy();
  expect(mocks.exactFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
  await waitFor(() =>
    expect(
      screen.getByLabelText("Original Interview Participant"),
    ).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.record }),
  );
  await waitFor(() =>
    expect(
      screen.getByDisplayValue("Retained unrelated completion draft"),
    ).toBeTruthy(),
  );
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("invalidates a late exact-arrival read across denied access and explicit recovery", async () => {
  let finish!: (value: ReturnType<typeof fixture>) => void;
  mocks.exactFetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  arriveAtCompletion("completed");
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <InterviewManagement />
    </NextIntlClientProvider>
  );
  const view = render(tree());
  await waitFor(() => expect(mocks.exactFetch).toHaveBeenCalledOnce());
  mocks.options.mockReturnValue({
    data: fixture(),
    error: Object.assign(new Error("Management access revoked"), {
      data: { code: "FORBIDDEN" },
    }),
    refetch: mocks.refetch,
  });
  view.rerender(tree());
  expect(screen.queryByText("Candidate One")).toBeNull();
  mocks.options.mockReturnValue({
    data: fixture(),
    isSuccess: true,
    refetch: mocks.refetch,
  });
  view.rerender(tree());
  mocks.refetch.mockResolvedValueOnce({ data: fixture(), error: null });
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.refreshOnly }),
  );
  await waitFor(() => expect(screen.getByText("Candidate One")).toBeTruthy());
  await act(async () => finish(fixture()));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
});

it.each(["%ZZ", "%00", "a".repeat(201), "record/other"])(
  "ignores an invalid exact completion fragment before any private reader: %s",
  (id) => {
    window.history.replaceState(
      null,
      "",
      `/admin/applications#interview-completion-${id}`,
    );
    show();
    expect(mocks.exactFetch).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

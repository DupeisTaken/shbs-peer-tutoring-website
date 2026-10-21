// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
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
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  qualify: vi.fn(),
  complete: vi.fn(),
  refetch: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      interviewManagement: {
        options: { invalidate: mocks.refetch, fetch: mocks.fetch },
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
  });
  fireEvent.submit(search.closest("form")!);
  expect(mocks.options).toHaveBeenLastCalledWith({
    page: 0,
    search: "Math",
    completion: "COMPLETED",
  });
});
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
    });
    fireEvent.change(search, { target: { value: "Unsubmitted search" } });
    fireEvent.click(reset);
    expect(mocks.options).toHaveBeenLastCalledWith({
      page: 0,
      search: "",
      completion: "OPEN",
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
    mocks.fetch.mockRejectedValueOnce(denial);
    show();
    fireEvent.click(
      screen.getByRole("button", { name: /Candidate One Needs completion/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.record }),
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

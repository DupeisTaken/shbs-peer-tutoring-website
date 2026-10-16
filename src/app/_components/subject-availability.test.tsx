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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import { SubjectAvailability } from "./subject-availability";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  qualify: vi.fn(),
  willing: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: () => ["subject-options"],
}));
let client: QueryClient;
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      subjectAvailability: { options: { invalidate: mocks.invalidate } },
      admin: { subjectEligibility: { invalidate: mocks.invalidate } },
    }),
    subjectAvailability: {
      options: { useQuery: mocks.options },
      setWillingness: { useMutation: () => ({ mutate: mocks.willing }) },
    },
    interviewManagement: {
      qualify: { useMutation: () => ({ mutate: mocks.qualify }) },
    },
  },
}));
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  mocks.options.mockReturnValue({
    data: {
      tutors: [
        { id: "t", englishName: "Tutor One", status: "ACTIVE", user: null },
      ],
      subjects: ["AP Math", "Math", "Biology"].map((name, i) => ({
        id: String(i),
        name,
        active: true,
        groupId: "g",
        group: { name: "Science" },
        level: null,
      })),
      qualifications: [{ tutorId: "t", subjectId: "0", status: "APPROVED" }],
      grants: [
        { tutorId: "t", sourceSubjectId: "0", subjectId: "0" },
        { tutorId: "t", sourceSubjectId: "0", subjectId: "1" },
      ],
      pendingRequests: [],
      willingness: [{ tutorId: "t", subjectId: "2", willing: true }],
    },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
const content = () => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="en" messages={en}>
      <SubjectAvailability />
    </NextIntlClientProvider>
  </QueryClientProvider>
);
const show = () => render(content());
it("shows separate willingness, qualification and recorded inheritance and mutates only intent", () => {
  show();
  fireEvent.click(
    screen.getByRole("button", { name: /Tutor One 2 qualified · 1 willing/ }),
  );
  const inheritedRow = within(screen.getByRole("article", { name: "Math" }));
  expect(inheritedRow.queryByRole("combobox")).toBeNull();
  expect(
    inheritedRow.queryByText("Recorded inheritance from: AP Math"),
  ).toBeNull();
  expect(inheritedRow.getByText("Not recorded")).toBeTruthy();
  const biology = within(screen.getByRole("article", { name: "Biology" }));
  expect(biology.getByText("Not qualified")).toBeTruthy();
  const trigger = inheritedRow.getByRole("button", { name: "Edit details" });
  trigger.focus();
  fireEvent.click(trigger);
  const inherited = within(screen.getByRole("dialog"));
  expect(
    inherited.getByText("Recorded inheritance from: AP Math"),
  ).toBeTruthy();
  expect(inherited.getByRole<HTMLSelectElement>("combobox").value).toBe(
    "UNKNOWN",
  );
  fireEvent.change(inherited.getByRole("combobox"), {
    target: { value: "YES" },
  });
  expect(mocks.willing).toHaveBeenCalledWith({
    tutorId: "t",
    subjectId: "1",
    willing: true,
  });
  expect(mocks.qualify).not.toHaveBeenCalled();
});
it("filters the qualified-and-willing intersection rather than either state alone", () => {
  show();
  fireEvent.change(screen.getByRole("combobox", { name: "Show subjects" }), {
    target: { value: "AVAILABLE" },
  });
  expect(
    screen.getByText("No tutors or subjects match these filters."),
  ).toBeTruthy();
});
it("keeps the on-demand editor open across filtering and restores its exact opener when still present", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: /Tutor One/ }));
  const trigger = within(
    screen.getByRole("article", { name: "Math" }),
  ).getByRole("button", { name: "Edit details" });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Qualified" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.change(screen.getByRole("combobox", { name: "Show subjects" }), {
    target: { value: "AVAILABLE" },
  });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(
    within(screen.getByRole("dialog")).getByRole<HTMLSelectElement>("combobox")
      .value,
  ).toBe("UNKNOWN");
  expect(mocks.willing).not.toHaveBeenCalled();
});
it("surfaces loading and query errors", () => {
  mocks.options.mockReturnValue({});
  const view = show();
  expect(screen.getByRole("status")).toBeTruthy();
  view.unmount();
  mocks.options.mockReturnValue({ error: { message: "Access denied" } });
  show();
  expect(screen.getByRole("alert").textContent).toBe("Access denied");
});
it("retains cached content for transport recovery but latches denial until a successful read", () => {
  const result = mocks.options() as { data: unknown };
  const refetch = vi.fn();
  mocks.options.mockReturnValue({
    ...result,
    error: { message: "Transport failure" },
    refetch,
  });
  const view = show();
  expect(screen.getByRole("button", { name: /Tutor One/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(refetch).toHaveBeenCalledOnce();
  client.setQueryData(["subject-options"], result.data);
  mocks.options.mockReturnValue({
    ...result,
    error: { message: "Revoked", data: { code: "FORBIDDEN" } },
    refetch,
  });
  view.rerender(content());
  expect(screen.queryByRole("button", { name: /Tutor One/ })).toBeNull();
  expect(client.getQueryData(["subject-options"])).toBeUndefined();
  mocks.options.mockReturnValue({
    ...result,
    error: { message: "Offline" },
    refetch,
  });
  view.rerender(content());
  expect(screen.queryByRole("button", { name: /Tutor One/ })).toBeNull();
  mocks.options.mockReturnValue({
    ...result,
    isSuccess: true,
    isFetching: false,
    refetch,
  });
  view.rerender(content());
  expect(screen.getByRole("button", { name: /Tutor One/ })).toBeTruthy();
});

it("mounts exactly three mutually exclusive filters only while expanded and clears on a second click", () => {
  show();
  expect(screen.queryByRole("group")).toBeNull();
  const toggle = screen.getByRole("button", { name: /Tutor One/ });
  fireEvent.click(toggle);
  const filters = within(
    screen.getByRole("group", { name: "Subject filters for Tutor One" }),
  );
  expect(filters.getAllByRole("button")).toHaveLength(3);
  fireEvent.click(filters.getByRole("button", { name: "Qualified" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.click(
    filters.getByRole("button", { name: en.subjectAvailability.willing }),
  );
  expect(
    filters
      .getByRole("button", { name: "Qualified" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "Biology" })).toBeTruthy();
  fireEvent.click(
    filters.getByRole("button", { name: en.subjectAvailability.willing }),
  );
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(filters.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  fireEvent.click(toggle);
  expect(screen.queryByRole("group")).toBeNull();
});

it("includes pending direct approvals and open requests, retains an empty card, and isolates tutor filters", () => {
  const { data } = mocks.options() as {
    data: {
      tutors: Array<{
        id: string;
        englishName: string;
        status: string;
        user: null;
      }>;
      qualifications: Array<{
        tutorId: string;
        subjectId: string;
        status: string;
      }>;
      pendingRequests: Array<{
        requestedTutorId: string;
        requestedSubjectId: string;
      }>;
    };
  };
  data.tutors.push({
    id: "other",
    englishName: "Tutor Two",
    status: "ACTIVE",
    user: null,
  });
  data.qualifications.push({ tutorId: "t", subjectId: "1", status: "PENDING" });
  data.pendingRequests.push({ requestedTutorId: "t", requestedSubjectId: "2" });
  show();
  fireEvent.click(screen.getByRole("button", { name: /Tutor One/ }));
  fireEvent.click(screen.getByRole("button", { name: /Tutor Two/ }));
  const one = within(screen.getByRole("group", { name: /Tutor One/ }));
  const two = within(screen.getByRole("group", { name: /Tutor Two/ }));
  fireEvent.click(one.getByRole("button", { name: "Pending Review" }));
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(two.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  fireEvent.click(two.getByRole("button", { name: "Pending Review" }));
  expect(screen.getByText("No subjects match these filters.")).toBeTruthy();
  expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Biology" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

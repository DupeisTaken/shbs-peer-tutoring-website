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
import { SubjectAvailability } from "./subject-availability";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  qualify: vi.fn(),
  willing: vi.fn(),
  invalidate: vi.fn(),
}));
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
      willingness: [{ tutorId: "t", subjectId: "2", willing: true }],
    },
  });
});
afterEach(cleanup);
const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SubjectAvailability />
    </NextIntlClientProvider>,
  );
it("shows separate willingness, qualification and recorded inheritance and mutates only intent", () => {
  show();
  fireEvent.click(
    screen.getByRole("button", { name: /Tutor One 2 qualified · 1 willing/ }),
  );
  const inherited = within(screen.getByRole("article", { name: "Math" }));
  expect(
    inherited.getByText("Recorded inheritance from: AP Math"),
  ).toBeTruthy();
  expect(inherited.getByRole<HTMLSelectElement>("combobox").value).toBe(
    "UNKNOWN",
  );
  const biology = within(screen.getByRole("article", { name: "Biology" }));
  expect(biology.getByText("Not qualified")).toBeTruthy();
  expect(biology.getByRole<HTMLSelectElement>("combobox").value).toBe(
    "YES",
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
it("surfaces loading and query errors", () => {
  mocks.options.mockReturnValue({});
  const view = show();
  expect(screen.getByRole("status")).toBeTruthy();
  view.unmount();
  mocks.options.mockReturnValue({ error: { message: "Access denied" } });
  show();
  expect(screen.getByRole("alert").textContent).toBe("Access denied");
});

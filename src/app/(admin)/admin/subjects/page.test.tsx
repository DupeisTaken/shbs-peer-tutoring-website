/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import SubjectsPage from "./page";
const mock = vi.hoisted(() => ({
  update: vi.fn(),
  reorder: vi.fn(),
  readOnly: false,
  subjects: [{ id: "s", name: "Math", levelId: "regular", active: true }],
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => mock.readOnly,
}));
vi.mock("~/app/_components/ui/action-review", () => ({
  useActionReview: () => ({
    dialog: null,
    open: vi.fn(),
    blocked: () => false,
  }),
}));
vi.mock("~/trpc/react", () => {
  const mutation = () => ({ mutate: vi.fn() });
  const invalidator = { invalidate: vi.fn() };
  return {
    api: {
      useUtils: () => ({
        admin: {
          subjects: invalidator,
          subjectLevels: invalidator,
          courseGroups: invalidator,
        },
      }),
      admin: {
        courseGroups: {
          useQuery: () => ({
            data: [
              {
                id: "g",
                name: "Mathematics",
                subjects: [{ id: "s", name: "Math", active: true }],
              },
              { id: "g2", name: "Science", subjects: [] },
            ],
          }),
        },
        subjectLevels: {
          useQuery: () => ({
            data: [
              { id: "regular", name: "Standard", prefix: "", apScored: false },
              { id: "ap", name: "AP", prefix: "AP", apScored: true },
            ],
          }),
        },
        subjects: {
          useQuery: () => ({
            data: mock.subjects,
          }),
        },
        batchUpdateSubjects: { useMutation: mutation },
        reorderCatalogue: { useMutation: () => ({ mutate: mock.reorder }) },
        updateSubjectLevel: { useMutation: () => ({ mutate: mock.update }) },
        createSubjectLevel: { useMutation: mutation },
        deleteSubjectLevel: { useMutation: mutation },
        importSubjects: { useMutation: mutation },
        importCourseGroups: { useMutation: mutation },
      },
    },
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.readOnly = false;
  mock.subjects = [{ id: "s", name: "Math", levelId: "regular", active: true }];
});
afterEach(cleanup);
const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SubjectsPage />
    </NextIntlClientProvider>,
  );
it("explains blur saves once and preserves no-change versus changed field behavior", () => {
  show();
  expect(screen.getAllByText(en.saveBoundary.blur)).toHaveLength(1);
  const control = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Level name: Standard",
  });
  expect(control.getAttribute("aria-describedby")).toBe(
    "subject-level-save-help",
  );
  fireEvent.blur(control);
  expect(mock.update).not.toHaveBeenCalled();
  fireEvent.change(control, { target: { value: "Regular" } });
  fireEvent.blur(control);
  expect(mock.update).toHaveBeenCalledExactlyOnceWith({
    id: "regular",
    name: "Regular",
  });
});
it("keeps group actions beside the complete summary and preserves configured reordering", () => {
  show();
  const name = screen.getByRole("heading", { name: "Mathematics" });
  expect(name.parentElement?.textContent).toContain("Math");
  fireEvent.click(
    screen.getByRole("button", { name: "Move Mathematics later" }),
  );
  expect(mock.reorder).toHaveBeenCalledExactlyOnceWith({
    kind: "groups",
    ids: ["g2", "g"],
  });
});
it("retains readable subject summaries while removing mutation controls for observers", () => {
  mock.readOnly = true;
  show();
  expect(screen.getByRole("heading", { name: "Mathematics" })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Move Mathematics later" }),
  ).toBeNull();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(2);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", {
      name: "Level name: Standard",
    }).readOnly,
  ).toBe(true);
});
it("preserves the server's level-first signup order through the parent catalogue", () => {
  // Alphabetical ordering would put AP Biology first and silently override policy.
  mock.subjects = [
    { id: "biology", name: "Biology", levelId: "regular", active: true },
    { id: "ap-biology", name: "AP Biology", levelId: "ap", active: true },
  ];
  show();
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  expect(
    rows.map((row) => within(row).getAllByRole("cell")[1]?.textContent),
  ).toEqual(["Biology", "AP Biology"]);
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import SubjectsPage from "../(admin)/admin/subjects/page";

type ImportResult = { created: number; received: number };
type GroupImportResult = ImportResult & { skipped: number };
type ImportCallbacks<Result> = {
  onSuccess: (result: Result) => Promise<void>;
  onSettled: () => void;
};

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  reorder: vi.fn(),
  readOnly: false,
  importGroups: vi.fn(),
  importSubjects: vi.fn(),
  pendingGroupImport: null as ImportCallbacks<GroupImportResult> | null,
  pendingSubjectsImport: null as ImportCallbacks<ImportResult> | null,
  remove: vi.fn(),
}));
const levels = [
  { id: "standard", name: "Standard", prefix: "", rank: 0, active: true },
  { id: "ap", name: "AP", prefix: "AP", rank: 2, active: true },
];
const successfulRead = <Data,>(data: Data) => ({
  data,
  isSuccess: true,
  error: null,
  refetch: async () => ({ data, error: null }),
});
const catalogueReads = {
  groups: successfulRead([]),
  levels: successfulRead(levels),
  subjects: successfulRead([]),
};
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => mocks.readOnly,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: Object.fromEntries(
        ["courseGroups", "subjectLevels", "subjects"].map((key) => [
          key,
          { invalidate: vi.fn() },
        ]),
      ),
    }),
    admin: {
      courseGroups: { useQuery: () => catalogueReads.groups },
      subjectLevels: { useQuery: () => catalogueReads.levels },
      subjects: { useQuery: () => catalogueReads.subjects },
      batchUpdateSubjects: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      saveCourseGroup: { useMutation: () => ({ mutate: mocks.save }) },
      reorderCatalogue: { useMutation: () => ({ mutate: mocks.reorder }) },
      updateSubjectLevel: { useMutation: () => ({ mutate: vi.fn() }) },
      createSubjectLevel: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteSubjectLevel: {
        useMutation: () => ({ mutateAsync: mocks.remove }),
      },
      importSubjects: {
        useMutation: (callbacks: ImportCallbacks<ImportResult>) => ({
          mutate: (input: unknown) => {
            mocks.pendingSubjectsImport = callbacks;
            mocks.importSubjects(input);
          },
          reset: vi.fn(),
        }),
      },
      importCourseGroups: {
        useMutation: (callbacks: ImportCallbacks<GroupImportResult>) => ({
          mutate: (input: unknown) => {
            mocks.pendingGroupImport = callbacks;
            mocks.importGroups(input);
          },
          reset: vi.fn(),
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
  mocks.pendingGroupImport = null;
  mocks.pendingSubjectsImport = null;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);
const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SubjectsPage />
    </NextIntlClientProvider>,
  );

it("requires named level review and permits cancellation without deletion", async () => {
  show();
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
  expect(screen.getByRole("dialog").textContent).toContain("Standard");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }),
  );
  await waitFor(() =>
    expect(mocks.remove).toHaveBeenCalledWith({ id: "standard" }),
  );
});

it("selects multiple levels, accepts distinct base names and previews generated names", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Add subject group" }));
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "Computer Science" },
  });
  const offers = screen.getByRole("group", { name: "Offered levels" });
  fireEvent.click(within(offers).getByRole("checkbox", { name: "Standard" }));
  fireEvent.click(within(offers).getByRole("checkbox", { name: "AP" }));
  fireEvent.change(screen.getByLabelText("Base subject name · Standard"), {
    target: { value: "Intro to Computer Science" },
  });
  fireEvent.change(screen.getByLabelText("Base subject name · AP"), {
    target: { value: "Computer Science A" },
  });
  expect(screen.getByText("AP Computer Science A")).toBeTruthy();
  expect(screen.getByText("Intro to Computer Science")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save group" }));
  expect(mocks.save).toHaveBeenCalledWith({
    id: undefined,
    name: "Computer Science",
    offerings: [
      {
        levelId: "standard",
        baseName: "Intro to Computer Science",
        subjectId: undefined,
      },
      { levelId: "ap", baseName: "Computer Science A", subjectId: undefined },
    ],
  });
});

it("labels the direction and exposes accessible reorder controls", () => {
  show();
  expect(screen.getByText("Beginner → Advanced")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Move AP earlier" }));
  expect(mocks.reorder).toHaveBeenCalledWith({
    kind: "levels",
    ids: ["ap", "standard"],
  });
});

it("hides catalogue mutations for a read-only viewer", () => {
  mocks.readOnly = true;
  show();
  expect(
    screen.queryByRole("button", { name: "Add subject group" }),
  ).toBeNull();
  expect(screen.getByRole("searchbox")).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>("Level name: AP").readOnly,
  ).toBe(true);
});

const upload = (name: string, text: string, size = text.length) =>
  fireEvent.change(screen.getByLabelText("JSON or CSV file"), {
    target: { files: [{ name, size, text: async () => text }] },
  });

const completeImport = async <Result,>(
  callbacks: ImportCallbacks<Result> | null,
  result: Result,
) => {
  if (!callbacks) throw new Error("Expected a submitted import mutation");
  // Accepted imports retain admission until their prerequisite reads settle.
  await act(async () => {
    await callbacks.onSuccess(result);
    callbacks.onSettled();
  });
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLInputElement>("JSON or CSV file").disabled,
    ).toBe(false),
  );
};

it("uploads grouped JSON and retains the CSV path", async () => {
  show();
  expect(
    screen
      .getByRole("link", { name: "Download JSON example" })
      .getAttribute("href"),
  ).toBe("/examples/course-groups.json");
  const input = {
    groups: [
      { name: "Science", offerings: [{ baseName: "Science", level: "AP" }] },
    ],
  };
  upload("courses.JSON", JSON.stringify(input));
  await waitFor(() => expect(mocks.importGroups).toHaveBeenCalledWith(input));
  await completeImport(mocks.pendingGroupImport, {
    created: 1,
    received: 1,
    skipped: 0,
  });
  upload("courses.csv", "name,level\nScience,AP");
  await waitFor(() =>
    expect(mocks.importSubjects).toHaveBeenCalledWith({
      subjects: [{ name: "Science", level: "AP" }],
    }),
  );
  await completeImport(mocks.pendingSubjectsImport, {
    created: 1,
    received: 1,
  });
});

it.each([
  ["courses.json", "{bad", 4],
  ["courses.json", '{"groups":[]}', 13],
  ["courses.json", "{}", 1024 * 1024 + 1],
  ["courses.txt", "{}", 2],
  ["courses.csv", "name,level", 10],
] as const)(
  "shows file errors without importing (%s, %s)",
  async (name, text, size) => {
    show();
    upload(name, text, size);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Could not import file",
      ),
    );
    expect(mocks.importGroups).not.toHaveBeenCalled();
    expect(mocks.importSubjects).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText<HTMLInputElement>("JSON or CSV file").disabled,
    ).toBe(false);
  },
);

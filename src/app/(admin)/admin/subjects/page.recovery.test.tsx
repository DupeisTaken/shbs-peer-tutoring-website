/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const fixture = vi.hoisted(() => ({
  failRead: false,
  failAfterWrite: true,
  deniedRead: null as string | null,
  nullRead: null as string | null,
  holdRead: null as string | null,
  readGate: undefined as Promise<void> | undefined,
  writeGate: undefined as Promise<void> | undefined,
  rejectWrite: false,
  queueWrite: false,
  revoke: vi.fn(),
  writes: vi.fn(),
  failedReads: vi.fn(),
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
vi.mock("~/app/_components/ui/action-review", () => ({
  useActionReview: () => ({
    dialog: null,
    open: vi.fn(),
    blocked: () => false,
    revoke: fixture.revoke,
  }),
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  type Input = Record<string, unknown>;
  type Options = UseMutationOptions<{ ok: true }, Error, Input>;
  const subject = {
    id: "s",
    name: "Math",
    baseName: "Math",
    levelId: "regular",
    active: true,
  };
  const data = {
    courseGroups: [{ id: "g", name: "Mathematics", subjects: [subject] }],
    subjectLevels: [
      { id: "regular", name: "Standard", prefix: "", apScored: false, rank: 0 },
    ],
    subjects: [subject],
  };
  const read = (name: keyof typeof data) => ({
    useQuery: () =>
      useQuery({
        queryKey: ["audit-catalogue", name],
        queryFn: async () => {
          if (fixture.holdRead === name) await fixture.readGate;
          if (fixture.deniedRead === name) {
            throw Object.assign(
              new Error("Synthetic catalogue access denied"),
              { data: { code: "FORBIDDEN" } },
            );
          }
          if (fixture.failRead) {
            fixture.failedReads(name);
            throw new Error(`Synthetic ${name} read unavailable`);
          }
          if (fixture.nullRead === name) return null;
          return data[name];
        },
        retry: false,
      }),
  });
  const mutation = (name: string) => ({
    useMutation: (options?: Options) =>
      useMutation({
        mutationFn: async (input: Input) => {
          fixture.writes(name, input);
          await fixture.writeGate;
          if (fixture.rejectWrite)
            throw new Error("Synthetic catalogue write rejected");
          if (fixture.queueWrite)
            throw Object.assign(new Error("Synthetic accepted proposal"), {
              data: { approvalId: "synthetic-proposal" },
            });
          // Accepted write and response; only the consequent catalogue reads fail.
          if (fixture.failAfterWrite) fixture.failRead = true;
          return { ok: true as const };
        },
        ...options,
      }),
  });
  return {
    api: {
      useUtils: () => {
        const client = useQueryClient();
        const invalidator = (name: string) => ({
          invalidate: (
            _input?: unknown,
            _filters?: unknown,
            options?: { throwOnError?: boolean },
          ) =>
            client.invalidateQueries(
              { queryKey: ["audit-catalogue", name] },
              options,
            ),
        });
        return {
          admin: {
            courseGroups: invalidator("courseGroups"),
            subjectLevels: invalidator("subjectLevels"),
            subjects: invalidator("subjects"),
          },
        };
      },
      admin: {
        courseGroups: read("courseGroups"),
        subjectLevels: read("subjectLevels"),
        subjects: read("subjects"),
        saveCourseGroup: mutation("saveCourseGroup"),
        batchUpdateSubjects: mutation("batchUpdateSubjects"),
        reorderCatalogue: mutation("reorderCatalogue"),
        updateSubjectLevel: mutation("updateSubjectLevel"),
        createSubjectLevel: mutation("createSubjectLevel"),
        deleteSubjectLevel: mutation("deleteSubjectLevel"),
        importSubjects: mutation("importSubjects"),
        importCourseGroups: mutation("importCourseGroups"),
      },
    },
  };
});
import SubjectsPage from "./page";

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.failRead = false;
  fixture.failAfterWrite = true;
  fixture.deniedRead = null;
  fixture.nullRead = null;
  fixture.holdRead = null;
  fixture.readGate = undefined;
  fixture.writeGate = undefined;
  fixture.rejectWrite = false;
  fixture.queueWrite = false;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
const show = () =>
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <SubjectsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

it("an initial catalogue failure offers an explicit read-only retry", async () => {
  fixture.failRead = true;
  show();
  await screen.findAllByRole("alert");
  expect(fixture.failedReads).toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: en.courseGroups.addGroup }),
  ).toBeNull();
  expect(screen.queryByText(en.courseCatalogue.empty)).toBeNull();
  const retry = screen.getByRole("button", { name: /retry|refresh|reload/i });
  fixture.failRead = false;
  fireEvent.click(retry);
  await screen.findByRole("heading", { name: "Mathematics" });
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("a failed cached catalogue read retains evidence but blocks dependent writes", async () => {
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fixture.failRead = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["audit-catalogue"] });
  });
  await screen.findAllByRole("alert");
  expect(screen.getByRole("heading", { name: "Mathematics" })).toBeTruthy();
  const level = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Level name: Standard",
  });
  expect(level.disabled || level.readOnly).toBe(true);
  // A direct event must also be fenced while its catalogue evidence is unavailable.
  fireEvent.change(level, { target: { value: "Synthetic retained level" } });
  fireEvent.blur(level);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("an accepted group save with failed synchronization recovers through reads without saving twice", async () => {
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.edit }));
  fireEvent.change(screen.getByLabelText(en.courseGroups.groupName), {
    target: { value: "Synthetic retained group" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.save }));
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(fixture.failedReads).toHaveBeenCalled());
  await screen.findAllByRole("alert");
  expect(
    screen.getByLabelText<HTMLInputElement>(en.courseGroups.groupName).value,
  ).toBe("Synthetic retained group");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.save,
    }).disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.courseGroups.cancel,
      }).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.cancel }));
  expect(screen.queryByLabelText(en.courseGroups.groupName)).toBeNull();
  // The accepted receipt belongs to the page, even after the editor closes.
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.addGroup,
    }).disabled,
  ).toBe(true);
  const retry = screen.getByRole("button", { name: /retry|refresh|reload/i });
  fixture.failRead = false;
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("treats a missing catalogue response as unavailable rather than an empty catalogue", async () => {
  fixture.nullRead = "subjects";
  show();
  await screen.findAllByRole("alert");
  expect(screen.queryByText(en.courseCatalogue.empty)).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.courseGroups.addGroup }),
  ).toBeNull();
  fixture.nullRead = null;
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await screen.findByRole("heading", { name: "Mathematics" });
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("retains separate group and level drafts through cached read failures and read-only recovery", async () => {
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.edit }));
  const group = screen.getByLabelText<HTMLInputElement>(
    en.courseGroups.groupName,
  );
  const level = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Level name: Standard",
  });
  const newLevel = screen.getByLabelText<HTMLInputElement>(
    en.courseGroups.newLevel,
  );
  fireEvent.change(group, { target: { value: "Independent group draft" } });
  fireEvent.change(level, { target: { value: "Independent level draft" } });
  fireEvent.change(newLevel, { target: { value: "Independent new level" } });
  fixture.failRead = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["audit-catalogue"] });
  });
  await screen.findAllByRole("alert");
  fireEvent.submit(group.closest("form")!);
  fireEvent.submit(newLevel.closest("form")!);
  fireEvent.blur(level);
  expect(fixture.writes).not.toHaveBeenCalled();
  expect(group.value).toBe("Independent group draft");
  expect(level.value).toBe("Independent level draft");
  expect(newLevel.value).toBe("Independent new level");
  fixture.failRead = false;
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
  expect(group.value).toBe("Independent group draft");
  expect(level.value).toBe("Independent level draft");
  expect(newLevel.value).toBe("Independent new level");
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("preserves an unsubmitted level field when a successful background read changes its row metadata", async () => {
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  const level = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Level name: Standard",
  });
  fireEvent.change(level, { target: { value: "Retained local name" } });
  act(() => {
    client.setQueryData(
      ["audit-catalogue", "subjectLevels"],
      [
        {
          id: "regular",
          name: "Server renamed level",
          prefix: "Updated",
          apScored: false,
          rank: 0,
        },
      ],
    );
  });
  // QueryClient batches observer delivery on its scheduler, after setQueryData.
  const refreshed = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Level name: Server renamed level",
  });
  expect(refreshed).toBe(level);
  expect(refreshed.value).toBe("Retained local name");
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("admits one pending group save, freezes its fields, and retains a rejected draft for an explicit retry", async () => {
  fixture.failAfterWrite = false;
  fixture.rejectWrite = true;
  let finishWrite!: () => void;
  fixture.writeGate = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.edit }));
  const group = screen.getByLabelText<HTMLInputElement>(
    en.courseGroups.groupName,
  );
  fireEvent.change(group, { target: { value: "Rejected group draft" } });
  act(() => {
    fireEvent.submit(group.closest("form")!);
    fireEvent.submit(group.closest("form")!);
  });
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(1));
  expect(group.closest("fieldset")?.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.cancel,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    finishWrite();
  });
  await screen.findByText("Synthetic catalogue write rejected");
  expect(group.value).toBe("Rejected group draft");
  expect(group.closest("fieldset")?.disabled).toBe(false);
  fixture.rejectWrite = false;
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.save }));
  await waitFor(() =>
    expect(screen.queryByLabelText(en.courseGroups.groupName)).toBeNull(),
  );
  expect(fixture.writes).toHaveBeenCalledTimes(2);
  expect(fixture.writes.mock.calls[1]).toEqual([
    "saveCourseGroup",
    expect.objectContaining({ name: "Rejected group draft" }),
  ]);
});

it("clears only the accepted new-level draft after synchronization and retains the independent group draft", async () => {
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.edit }));
  const group = screen.getByLabelText<HTMLInputElement>(
    en.courseGroups.groupName,
  );
  fireEvent.change(group, { target: { value: "Independent unsaved group" } });
  const level = screen.getByLabelText<HTMLInputElement>(
    en.courseGroups.newLevel,
  );
  fireEvent.change(level, { target: { value: "Accepted level name" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.courseGroups.addLevel }),
  );
  await screen.findAllByRole("alert");
  expect(level.value).toBe("Accepted level name");
  expect(group.value).toBe("Independent unsaved group");
  expect(fixture.writes).toHaveBeenCalledExactlyOnceWith("createSubjectLevel", {
    name: "Accepted level name",
    rank: 1,
  });
  fixture.failRead = false;
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(level.value).toBe(""));
  expect(group.value).toBe("Independent unsaved group");
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("holds accepted recovery until all catalogue reads settle even when another read fails first", async () => {
  let finishRead!: () => void;
  fixture.readGate = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.edit }));
  fixture.holdRead = "subjectLevels";
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.save }));
  await waitFor(() => expect(fixture.failedReads).toHaveBeenCalled());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.cancel,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(
    screen.getByLabelText(en.courseGroups.groupName).closest("form")!,
  );
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishRead();
  });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.courseGroups.cancel,
      }).disabled,
    ).toBe(false),
  );
  fixture.holdRead = null;
  fixture.failRead = false;
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
  expect(fixture.writes).toHaveBeenCalledTimes(1);
});

it("conceals cached catalogue evidence after authoritative denial through a later transport failure", async () => {
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fixture.deniedRead = "courseGroups";
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["audit-catalogue"] });
  });
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Mathematics" })).toBeNull(),
  );
  expect(fixture.revoke).toHaveBeenCalledTimes(1);
  fixture.deniedRead = null;
  fixture.failRead = true;
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(fixture.failedReads).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("heading", { name: "Mathematics" })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  fixture.failRead = false;
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /retry/i })
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await screen.findByRole("heading", { name: "Mathematics" });
  expect(fixture.writes).not.toHaveBeenCalled();
});

it("reports a queued group proposal separately and prevents replay of the accepted intent after reopening", async () => {
  fixture.queueWrite = true;
  show();
  await screen.findByRole("heading", { name: "Mathematics" });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.edit }));
  fireEvent.change(screen.getByLabelText(en.courseGroups.groupName), {
    target: { value: "Proposed group draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.save }));
  const receipt = await screen.findByRole("link", {
    name: en.actionReview.viewRequest,
  });
  expect(receipt.getAttribute("href")).toBe(
    "/admin/approvals?request=synthetic-proposal",
  );
  expect(screen.queryByText("Synthetic accepted proposal")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.save,
    }).disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.courseGroups.cancel,
      }).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.cancel }));
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.edit }));
  const group = screen.getByLabelText<HTMLInputElement>(
    en.courseGroups.groupName,
  );
  fireEvent.change(group, { target: { value: "Proposed group draft" } });
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.save,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(group.closest("form")!);
  expect(fixture.writes).toHaveBeenCalledTimes(1);
  // A deliberate different proposal remains a separate intent and save scope.
  fireEvent.change(group, { target: { value: "Different proposed group" } });
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.save }));
  await waitFor(() => expect(fixture.writes).toHaveBeenCalledTimes(2));
});

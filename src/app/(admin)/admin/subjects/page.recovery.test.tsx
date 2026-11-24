/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClientProvider,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import { createQueryClient } from "~/trpc/query-client";
import SubjectsPage from "./page";

const state = vi.hoisted(() => ({
  groupsFn: vi.fn<() => Promise<unknown>>(),
  levelsFn: vi.fn<() => Promise<unknown>>(),
  subjectsFn: vi.fn<() => Promise<unknown>>(),
  saveCourseGroup: vi.fn(),
  saveGroupOpts: undefined as
    | undefined
    | {
        onSuccess?: () => Promise<void>;
        onError?: (error: unknown) => void;
        onSettled?: () => void;
      },
  invalidateGroups: vi.fn(async () => undefined),
  invalidateLevels: vi.fn(async () => undefined),
  invalidateSubjects: vi.fn(async () => undefined),
  revoke: vi.fn(),
  readOnly: false,
}));

let queryClient: QueryClient;

vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/ui/action-review", () => ({
  useActionReview: () => ({
    review: vi.fn(),
    revoke: state.revoke,
    blocked: () => false,
    dialog: null,
  }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("~/trpc/react", () => {
  const noopMutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  return {
    api: {
      useUtils: () => ({
        admin: {
          courseGroups: { invalidate: state.invalidateGroups },
          subjectLevels: { invalidate: state.invalidateLevels },
          subjects: { invalidate: state.invalidateSubjects },
        },
      }),
      admin: {
        courseGroups: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
            useQuery({
              queryKey: [["admin", "courseGroups"], { type: "query" }],
              queryFn: () => state.groupsFn(),
              enabled: options?.enabled !== false,
            }),
        },
        subjectLevels: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
            useQuery({
              queryKey: [["admin", "subjectLevels"], { type: "query" }],
              queryFn: () => state.levelsFn(),
              enabled: options?.enabled !== false,
            }),
        },
        subjects: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
            useQuery({
              queryKey: [["admin", "subjects"], { type: "query" }],
              queryFn: () => state.subjectsFn(),
              enabled: options?.enabled !== false,
            }),
        },
        saveCourseGroup: {
          useMutation: (opts: typeof state.saveGroupOpts) => {
            state.saveGroupOpts = opts;
            return {
              mutate: state.saveCourseGroup,
              isPending: false,
              error: null,
            };
          },
        },
        batchUpdateSubjects: { useMutation: noopMutation },
        reorderCatalogue: { useMutation: noopMutation },
        updateSubjectLevel: { useMutation: noopMutation },
        createSubjectLevel: { useMutation: noopMutation },
        deleteSubjectLevel: { useMutation: noopMutation },
        importSubjects: { useMutation: noopMutation },
        importCourseGroups: { useMutation: noopMutation },
      },
    },
  };
});

const sampleLevel = {
  id: "lvl-h",
  name: "Honors",
  prefix: "H",
  rank: 1,
  subjectCount: 1,
  _count: { subjects: 1 },
};
const sampleSubject = {
  id: "sub-1",
  name: "H Algebra",
  baseName: "Algebra",
  active: true,
  levelId: "lvl-h",
  groupId: "grp-1",
  level: sampleLevel,
  group: { id: "grp-1", name: "Algebra", sortOrder: 0 },
  _count: {
    pairings: 0,
    qualificationGrants: 0,
    tutorWillingnesses: 0,
  },
};
const sampleGroup = {
  id: "grp-1",
  name: "Algebra",
  sortOrder: 0,
  subjects: [sampleSubject],
};

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SubjectsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: 30_000,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  vi.clearAllMocks();
  state.readOnly = false;
  state.groupsFn.mockResolvedValue([sampleGroup]);
  state.levelsFn.mockResolvedValue([sampleLevel]);
  state.subjectsFn.mockResolvedValue([sampleSubject]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("distinguishes initial read failures from empty states and recovers via named read-only Retry (#635)", async () => {
  state.subjectsFn.mockRejectedValueOnce(new Error("Subjects offline"));
  renderPage();

  await waitFor(() =>
    expect(screen.getByText(en.courseGroups.loadFailed)).toBeTruthy(),
  );
  // Must NOT show misleading empty catalogue states while a read failed.
  expect(screen.queryByText(en.courseGroups.empty)).toBeNull();
  expect(screen.queryByText(en.courseCatalogue.empty)).toBeNull();

  // Named read-only Retry recovers the catalogue.
  state.subjectsFn.mockResolvedValueOnce([sampleSubject]);
  fireEvent.click(screen.getByRole("button", { name: en.courseGroups.retry }));
  await waitFor(() =>
    expect(screen.getAllByText("H Algebra").length).toBeGreaterThan(0),
  );
});

it("retains drafts and gates dependent writes during cached refresh failures (#635)", async () => {
  renderPage();
  await waitFor(() =>
    expect(screen.getAllByText("Algebra").length).toBeGreaterThan(0),
  );

  fireEvent.click(
    screen.getByRole("button", { name: en.courseGroups.addGroup }),
  );
  const nameInput = screen.getByLabelText<HTMLInputElement>(
    en.courseGroups.groupName,
  );
  fireEvent.change(nameInput, { target: { value: "Calculus Draft" } });

  // Cached refresh fails for levels.
  state.levelsFn.mockRejectedValueOnce(new Error("Levels refresh failed"));
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [["admin", "subjectLevels"]],
    });
  });

  await waitFor(() =>
    expect(screen.getByText(en.courseGroups.refreshFailed)).toBeTruthy(),
  );
  // Draft stays intact while Save is disabled during cached failure.
  expect(
    screen.getByLabelText<HTMLInputElement>(en.courseGroups.groupName).value,
  ).toBe("Calculus Draft");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.save,
    }).disabled,
  ).toBe(true);
});

it("keeps GroupEditor open with Save disabled on accepted-write failed-refresh and retries reads without replaying saveCourseGroup (#635)", async () => {
  renderPage();
  await waitFor(() =>
    expect(screen.getAllByText("Algebra").length).toBeGreaterThan(0),
  );

  fireEvent.click(
    screen.getByRole("button", { name: en.courseGroups.addGroup }),
  );
  fireEvent.change(screen.getByLabelText(en.courseGroups.groupName), {
    target: { value: "Biology" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Honors" }));

  // Make saveCourseGroup succeed, then the post-save refetch of groups fails.
  state.groupsFn.mockRejectedValueOnce(new Error("Refresh failed"));
  state.saveCourseGroup.mockImplementationOnce(() => {
    void state.saveGroupOpts?.onSuccess?.();
    state.saveGroupOpts?.onSettled?.();
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.courseGroups.save }));
  });

  await waitFor(() =>
    expect(screen.getByText(en.courseGroups.savedRefreshFailed)).toBeTruthy(),
  );
  expect(state.saveCourseGroup).toHaveBeenCalledTimes(1);
  // Editor remains open and Save is disabled so it cannot be replayed.
  expect(
    screen.getByLabelText<HTMLInputElement>(en.courseGroups.groupName).value,
  ).toBe("Biology");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.courseGroups.save,
    }).disabled,
  ).toBe(true);

  // Clicking Retry refreshes read-only queries and closes the editor without replaying saveCourseGroup.
  state.groupsFn.mockResolvedValueOnce([sampleGroup]);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.courseGroups.retry }),
    );
  });
  await waitFor(() =>
    expect(screen.queryByLabelText(en.courseGroups.groupName)).toBeNull(),
  );
  expect(state.saveCourseGroup).toHaveBeenCalledTimes(1);
});

it("conceals and evicts cached catalogue data and revokes pending review on FORBIDDEN denial (#635)", async () => {
  renderPage();
  await waitFor(() =>
    expect(screen.getAllByText("H Algebra").length).toBeGreaterThan(0),
  );

  state.groupsFn.mockRejectedValueOnce(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [["admin", "courseGroups"]],
    });
  });

  await waitFor(() =>
    expect(screen.getByText(en.courseGroups.accessDenied)).toBeTruthy(),
  );
  expect(screen.queryByText("H Algebra")).toBeNull();
  expect(state.revoke).toHaveBeenCalled();
  expect(
    queryClient.getQueryData([["admin", "subjects"], { type: "query" }]),
  ).toBeUndefined();
});

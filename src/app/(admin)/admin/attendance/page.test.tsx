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
import messages from "../../../../../messages/en.json";
import AttendancePage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import { createQueryClient } from "~/trpc/query-client";

const state = vi.hoisted(() => ({
  realQueries: false,
  data: undefined as
    | undefined
    | {
        id: string;
        date: Date;
        tutor: { englishName: string };
        pairing: { subject: string };
        tutorStatus: string;
        tutees: [];
        shCount: number;
        mergeGroupId: null;
      }[],
  error: null as null | { message: string; data?: { code?: string } },
  refetch: vi.fn(),
  input: ((): unknown => undefined)(),
  tutorsLoaded: true,
  tutorIds: ["tutor"],
  sessionsQueryFn: undefined as
    undefined | ((input: unknown) => Promise<unknown>),
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_procedure: unknown, input: unknown) =>
    input === undefined ? ["attendance-test"] : ["attendance-test", input],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      tutors: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          const live = useQuery({
            queryKey: ["attendance-test"],
            queryFn: async () =>
              state.tutorIds.map((id) => ({
                id,
                englishName: "Tutor name",
                status: "ACTIVE",
              })),
            enabled: state.realQueries && options?.enabled !== false,
          });
          if (state.realQueries) return live;
          return {
            data: state.tutorsLoaded
              ? state.tutorIds.map((id) => ({
                  id,
                  englishName: "Tutor name",
                  status: "ACTIVE",
                }))
              : undefined,
            isSuccess: true,
            isFetching: false,
          };
        },
      },
      sessions: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          state.input = input;
          const live = useQuery({
            queryKey: ["attendance-test", input],
            queryFn: async () => {
              if (state.sessionsQueryFn) return state.sessionsQueryFn(input);
              if (state.error)
                throw Object.assign(
                  new Error(state.error.message),
                  state.error,
                );
              return state.data ?? [];
            },
            enabled: state.realQueries && options?.enabled !== false,
          });
          if (state.realQueries) return live;
          return {
            data: state.data,
            error: state.error,
            isSuccess: state.data !== undefined && !state.error,
            isFetching: false,
            refetch: state.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("~/app/_components/attendance-correction", () => ({
  AttendanceCorrection: () => (
    <input aria-label="Correction draft" defaultValue="Original" />
  ),
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SessionViewProvider
        identity="head"
        pathname="/admin/attendance"
        verified
      >
        {children}
      </SessionViewProvider>
    </NextIntlClientProvider>
  </QueryClientProvider>
);
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
  sessionStorage.clear();
  state.realQueries = false;
  state.sessionsQueryFn = undefined;
  state.tutorsLoaded = true;
  state.tutorIds = ["tutor"];
  state.data = undefined;
  state.error = null;
  state.refetch.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const row = {
  id: "session",
  date: new Date("2026-10-01"),
  tutor: { englishName: "Tutor name" },
  pairing: { subject: "Math" },
  tutorStatus: "PRESENT",
  tutees: [] as [],
  shCount: 1,
  mergeGroupId: null,
};

it("labels both filters and distinguishes initial error from loaded empty results", () => {
  state.error = { message: "Read failed" };
  const view = render(<AttendancePage />, { wrapper });
  expect(screen.getByLabelText("Month")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Tutor" })).toBeTruthy();
  expect(screen.queryByText(messages.admin.submissions.empty)).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.admin.submissions.title}`,
    }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  state.error = null;
  state.data = [];
  view.rerender(<AttendancePage />);
  expect(screen.getByText(messages.admin.submissions.empty)).toBeTruthy();
});

it("keeps a correction draft mounted beside background read recovery", () => {
  state.data = [row];
  const view = render(<AttendancePage />, { wrapper });
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.corrections.editAttendance}: Tutor name · Math`,
    }),
  );
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Correction draft",
  });
  fireEvent.change(draft, { target: { value: "Unsaved correction" } });
  state.error = { message: "Background failure" };
  view.rerender(<AttendancePage />);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Correction draft" })
      .value,
  ).toBe("Unsaved correction");
  expect(screen.getByRole("alert").textContent).toContain(
    "Previously loaded content is still shown",
  );
});

it("evicts denied sessions and waits for successful permission recovery", async () => {
  state.realQueries = true;
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  state.data = [row];
  render(<AttendancePage />, { wrapper });
  await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

  now = Date.UTC(2026, 10, 9, 12, 0);
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: ["attendance-test", state.input],
    });
  });
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  expect(
    queryClient.getQueryData(["attendance-test", state.input]),
  ).toBeUndefined();

  state.error = { message: "Network failure" };
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.admin.submissions.title}`,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());

  // Backward clock skew must not block fresh authorized recovery.
  now = Date.UTC(2026, 10, 9, 11, 50);
  state.error = null;
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.admin.submissions.title}`,
    }),
  );
  await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
});

it("waits for tutor options then restores month/visibility and removes obsolete IDs", () => {
  const key = viewStateKey(
    "head",
    "/admin/attendance",
    "attendance-filters-v1",
    "",
  );
  const saved = { month: "2026-08", tutorId: "tutor", showPast: true };
  writeViewState(sessionStorage, key, saved);
  state.data = [];
  state.tutorsLoaded = false;
  const view = render(<AttendancePage />, { wrapper });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(saved);
  state.tutorsLoaded = true;
  view.rerender(<AttendancePage />);
  expect(screen.getByLabelText<HTMLInputElement>("Month").value).toBe(
    "2026-08",
  );
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Tutor" }).value,
  ).toBe("tutor");
  expect(
    screen.getByRole("button", { name: messages.pastTutors.hide }),
  ).toBeTruthy();
  state.tutorIds = [];
  view.rerender(<AttendancePage />);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({
    ...saved,
    tutorId: "",
  });
});
it("clears saved filters and every cached month when attendance access is revoked", () => {
  const key = viewStateKey(
    "head",
    "/admin/attendance",
    "attendance-filters-v1",
    "",
  );
  writeViewState(sessionStorage, key, {
    month: "2026-08",
    tutorId: "tutor",
    showPast: false,
  });
  state.data = [row];
  const view = render(<AttendancePage />, { wrapper });
  queryClient.setQueryData(["attendance-test", { month: "2026-09" }], [row]);
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(<AttendancePage />);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(
    queryClient.getQueryData(["attendance-test", { month: "2026-09" }]),
  ).toBeUndefined();
  expect(screen.queryByRole("table")).toBeNull();
  state.error = { message: "Transport error" };
  view.rerender(<AttendancePage />);
  expect(screen.queryByRole("table")).toBeNull();
});

it("does not release a denied month for an older cached success after filters reset", async () => {
  state.realQueries = true;
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let denyAugust = false;
  let failDefault: null | { message: string; data?: { code?: string } } = null;
  state.sessionsQueryFn = async (input) => {
    const month = (input as { month?: string } | undefined)?.month;
    if (month === "2026-08" && denyAugust)
      throw Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
    if (month !== "2026-08" && failDefault)
      throw Object.assign(new Error(failDefault.message), failDefault);
    return [row];
  };
  render(<AttendancePage />, { wrapper });
  await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

  // Move wall clock backward before denying the filtered month.
  now = Date.UTC(2026, 10, 9, 12, 0);
  denyAugust = true;
  fireEvent.change(screen.getByLabelText("Month"), {
    target: { value: "2026-08" },
  });
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());

  // Transport failure on the reset default key stays denied.
  failDefault = { message: "Transport failure" };
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.admin.submissions.title}`,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());

  // Fresh authorized read recovers even with another backward clock jump.
  now = Date.UTC(2026, 10, 9, 11, 50);
  failDefault = null;
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.admin.submissions.title}`,
    }),
  );
  await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
});

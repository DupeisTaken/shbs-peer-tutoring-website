/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { dehydrate, hydrate, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import AttendancePage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";

type SessionInput = { month?: string; tutorId?: string };
type Session = {
  id: string;
  date: Date;
  tutor: { englishName: string };
  pairing: { subject: string };
  tutorStatus: string;
  tutees: [];
  shCount: number;
  mergeGroupId: null;
};
type Tutor = { id: string; englishName: string; status: string };
type ReadError = Error & { data?: { code?: string } };
const state = vi.hoisted(() => ({
  data: undefined as Session[] | undefined,
  error: null as ReadError | null,
  read: vi.fn<(input?: SessionInput) => Promise<Session[]>>(),
  tutorsRead: vi.fn<() => Promise<Tutor[]>>(),
  refetch: vi.fn<() => Promise<unknown>>(),
  input: undefined as SessionInput | undefined,
  tutorIds: ["tutor"],
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      admin: {
        tutors: {
          _def: () => ({ path: ["admin", "tutors"] }),
          useQuery: (_input?: undefined, options?: { enabled?: boolean }) =>
            useQuery<Tutor[], ReadError>({
              queryKey: tutorsKey(),
              queryFn: state.tutorsRead,
              ...options,
            }),
        },
        sessions: {
          _def: () => ({ path: ["admin", "sessions"] }),
          useQuery: (input?: SessionInput, options?: { enabled?: boolean }) => {
            state.input = input;
            const result = useQuery<Session[], ReadError>({
              queryKey: sessionsKey(input),
              queryFn: () => state.read(input),
              ...options,
            });
            // Observe manual Retry calls while forwarding the real read lifecycle.
            state.refetch.mockImplementation(() => result.refetch());
            return { ...result, refetch: state.refetch };
          },
        },
      },
    },
  };
});
vi.mock("~/app/_components/attendance-correction", () => ({
  AttendanceCorrection: () => (
    <input aria-label="Correction draft" defaultValue="Original" />
  ),
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
let queryClient: QueryClient;
const tutorsKey = () => getQueryKey(api.admin.tutors, undefined, "query");
const sessionsKey = (input = state.input) => getQueryKey(api.admin.sessions, input, "query");
const failure = (message: string, code?: string): ReadError =>
  Object.assign(new Error(message), code ? { data: { code } } : {});
const tutorRows = () => state.tutorIds.map((id) => ({ id, englishName: "Tutor name", status: "ACTIVE" }));
async function refetchSessions() {
  await act(async () => { await state.refetch(); });
}
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
    queries: { ...defaults.queries, retry: false, gcTime: Infinity },
  });
  sessionStorage.clear();
  state.tutorIds = ["tutor"];
  state.data = undefined;
  state.error = null;
  state.refetch.mockReset();
  state.read.mockReset().mockImplementation(async () => {
    if (state.error) throw state.error;
    return state.data ?? [];
  });
  state.tutorsRead.mockReset().mockImplementation(async () => tutorRows());
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
  queryClient.clear();
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

it("labels both filters and distinguishes initial error from loaded empty results", async () => {
  state.error = failure("Read failed");
  render(<AttendancePage />, { wrapper });
  await screen.findByRole("button", { name: `Retry ${messages.admin.submissions.title}` });
  expect(screen.getByLabelText("Month")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Tutor" })).toBeTruthy();
  expect(screen.queryByText(messages.admin.submissions.empty)).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  state.error = null;
  state.data = [];
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${messages.admin.submissions.title}`,
      }),
    );
    await state.refetch.mock.results.at(-1)?.value;
  });
  expect(state.refetch).toHaveBeenCalledOnce();
  await screen.findByText(messages.admin.submissions.empty);
  expect(screen.getByText(messages.admin.submissions.empty)).toBeTruthy();
});

it("keeps a correction draft mounted beside background read recovery", async () => {
  state.data = [row];
  render(<AttendancePage />, { wrapper });
  await screen.findByRole("table");
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.corrections.editAttendance}: Tutor name · Math`,
    }),
  );
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Correction draft",
  });
  fireEvent.change(draft, { target: { value: "Unsaved correction" } });
  state.error = failure("Background failure");
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: sessionsKey(), exact: true });
  });
  await screen.findByRole("alert");
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Correction draft" })
      .value,
  ).toBe("Unsaved correction");
  expect(screen.getByRole("alert").textContent).toContain(
    "Previously loaded content is still shown",
  );
});

it("evicts denied sessions and waits for successful permission recovery", async () => {
  state.data = [row];
  render(<AttendancePage />, { wrapper });
  await screen.findByRole("table");
  state.error = failure("Denied", "FORBIDDEN");
  await refetchSessions();
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  expect(screen.queryByRole("table")).toBeNull();
  expect(
    queryClient.getQueryData(sessionsKey()),
  ).toBeUndefined();
  state.error = failure("Network failure");
  await refetchSessions();
  expect(screen.queryByRole("table")).toBeNull();
  state.error = null;
  await refetchSessions();
  await screen.findByRole("table");
  expect(screen.getByRole("table")).toBeTruthy();
});

it("waits for tutor options then restores month/visibility and removes obsolete IDs", async () => {
  const key = viewStateKey(
    "head",
    "/admin/attendance",
    "attendance-filters-v1",
    "",
  );
  const saved = { month: "2026-08", tutorId: "tutor", showPast: true };
  writeViewState(sessionStorage, key, saved);
  state.data = [];
  let tutorsReady!: (value: Tutor[]) => void;
  state.tutorsRead.mockReturnValueOnce(new Promise<Tutor[]>((resolve) => { tutorsReady = resolve; }));
  render(<AttendancePage />, { wrapper });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(saved);
  await act(async () => { tutorsReady(tutorRows()); });
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Month").value).toBe("2026-08"));
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
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: tutorsKey(), exact: true });
  });
  await waitFor(() => {
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({
      ...saved,
      tutorId: "",
    });
  });
});
it("clears saved filters and every cached month when attendance access is revoked", async () => {
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
  render(<AttendancePage />, { wrapper });
  await screen.findByRole("table");
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Month").value).toBe("2026-08"));
  await act(async () => {
    await queryClient.fetchQuery({ queryKey: sessionsKey({ month: "2026-09" }), queryFn: () => state.read({ month: "2026-09" }) });
  });
  state.error = failure("Denied", "FORBIDDEN");
  await refetchSessions();
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(
    queryClient.getQueryData(sessionsKey({ month: "2026-09" })),
  ).toBeUndefined();
  expect(screen.queryByRole("table")).toBeNull();
  state.error = failure("Transport error");
  await refetchSessions();
  expect(screen.queryByRole("table")).toBeNull();
});

it("does not release a denied month for an older cached success after filters reset", async () => {
  state.data = [row];
  const view = render(<AttendancePage />, { wrapper });
  await screen.findByRole("table");
  const olderCache = dehydrate(queryClient);
  fireEvent.change(screen.getByLabelText("Month"), {
    target: { value: "2026-08" },
  });
  await waitFor(() => expect(queryClient.getQueryState(sessionsKey())?.status).toBe("success"));
  await screen.findByRole("table");
  state.error = failure("Denied", "FORBIDDEN");
  await refetchSessions();
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  expect(screen.queryByRole("table")).toBeNull();

  // The reset query key may already have a successful cache entry from before denial.
  state.error = null;
  await act(async () => {
    hydrate(queryClient, olderCache);
    view.rerender(<AttendancePage />);
  });
  expect(screen.queryByRole("table")).toBeNull();
  state.error = failure("Transport failure");
  await refetchSessions();
  expect(screen.queryByRole("table")).toBeNull();

  state.error = null;
  await refetchSessions();
  await screen.findByRole("table");
  expect(screen.getByRole("table")).toBeTruthy();
});

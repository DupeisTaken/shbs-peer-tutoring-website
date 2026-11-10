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
import { Component, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import AttendancePage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import { currentMonth } from "~/lib/time";
import { api } from "~/trpc/react";
import { createQueryClient } from "~/trpc/query-client";
import type * as SummaryTableModule from "~/app/_components/ui/summary-table";

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
type Tutor = {
  id: string;
  englishName: string;
  username: string;
  status: string;
};
type ReadError = Error & { data?: { code?: string } };
type Observation = { key: string; status: string; fetching: boolean };
const fixture = vi.hoisted(() => ({
  sessions: vi.fn<(input: SessionInput | undefined) => Promise<Session[]>>(),
  tutors: vi.fn<() => Promise<Tutor[]>>(),
  committedSessions: null as Observation | null,
  ownerErrors: [] as Error[],
  recordPrivateCommits: false,
  privateCommits: 0,
  sessionRenders: 0,
}));

// Only the transport adapter is replaced: keys, cache events and observer
// publication come from the installed QueryClient/useQuery implementation.
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const { useLayoutEffect } = await import("react");
  const read = <T,>(
    path: string[],
    load: (input?: SessionInput) => Promise<T>,
  ) => ({
    _def: () => ({ path }),
    useQuery(input?: SessionInput, options?: { enabled?: boolean }) {
      const queryKey = [
        path,
        { ...(input === undefined ? {} : { input }), type: "query" },
      ];
      const result = useQuery<T, ReadError>({
        queryKey,
        queryFn: () => load(input),
        ...options,
      });
      if (path[1] === "sessions") fixture.sessionRenders++;
      useLayoutEffect(() => {
        if (path[1] !== "sessions") return;
        const committed = {
          key: JSON.stringify(queryKey),
          status: result.status,
          fetching: result.isFetching,
        };
        fixture.committedSessions = committed;
        return () => {
          if (fixture.committedSessions === committed)
            fixture.committedSessions = null;
        };
      });
      return result;
    },
  });
  return {
    api: {
      admin: {
        sessions: read(["admin", "sessions"], fixture.sessions),
        tutors: read(["admin", "tutors"], fixture.tutors),
      },
    },
  };
});
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => true }));
vi.mock("~/app/_components/session-record-details", () => ({
  SessionRecordDetails: () => null,
}));
vi.mock("~/app/_components/attendance-correction", () => ({
  AttendanceCorrection: () => null,
}));
vi.mock("~/app/_components/ui/summary-table", async (importOriginal) => {
  const actual = await importOriginal<typeof SummaryTableModule>();
  const { useLayoutEffect } = await import("react");
  return {
    ...actual,
    SummaryTable: function ObservedSummaryTable(
      props: Parameters<typeof actual.SummaryTable>[0],
    ) {
      useLayoutEffect(() => {
        if (fixture.recordPrivateCommits) fixture.privateCommits++;
      });
      return <actual.SummaryTable {...props} />;
    },
  };
});

class OwnerBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    fixture.ownerErrors.push(error);
  }
  render() {
    return this.state.failed ? (
      <p role="alert">Attendance owner crashed</p>
    ) : (
      this.props.children
    );
  }
}

const epoch = Date.UTC(2026, 10, 9, 12);
let clock: number;
let client: QueryClient;
let unsubscribeCache: (() => void) | undefined;
let defaultInput: SessionInput;
let filteredInput: { month: string; tutorId: string };
const sessionsKey = (input: SessionInput) =>
  getQueryKey(api.admin.sessions, input, "query");
const tutorsKey = () => getQueryKey(api.admin.tutors, undefined, "query");
const section = en.admin.submissions.title;
const recovery = (kind: "denied" | "retry", name = section) =>
  en.managementRecovery[kind].replace("{section}", name);
const row = (label: string): Session => ({
  id: label,
  date: new Date("2026-08-01T00:00:00Z"),
  tutor: { englishName: label },
  pairing: { subject: "Synthetic math" },
  tutorStatus: "PRESENT",
  tutees: [],
  shCount: 1,
  mergeGroupId: null,
});
const deny = () =>
  Object.assign(new Error("Synthetic access denial"), {
    data: { code: "FORBIDDEN" },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function app() {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionViewProvider
          identity="synthetic-head"
          pathname="/admin/attendance"
          verified
        >
          <OwnerBoundary>
            <AttendancePage />
          </OwnerBoundary>
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function saveFilteredView() {
  writeViewState(
    sessionStorage,
    viewStateKey(
      "synthetic-head",
      "/admin/attendance",
      "attendance-filters-v1",
      "",
    ),
    { ...filteredInput, showPast: true },
  );
}
async function denySessions(input = defaultInput) {
  fixture.sessions.mockRejectedValueOnce(deny());
  await act(async () => {
    await client.refetchQueries({ queryKey: sessionsKey(input), exact: true });
  });
  await waitFor(() => {
    expect(fixture.ownerErrors).toEqual([]);
    expect(screen.getByText(recovery("denied"))).toBeTruthy();
  });
}
async function retrySessions(label = "Fresh authorized attendance") {
  fixture.sessions.mockResolvedValueOnce([row(label)]);
  fireEvent.click(screen.getByRole("button", { name: recovery("retry") }));
  await waitFor(() => {
    expect(fixture.committedSessions).toEqual({
      key: JSON.stringify(sessionsKey(defaultInput)),
      status: "success",
      fetching: false,
    });
    expect(screen.queryByText(recovery("denied"))).toBeNull();
    expect(screen.getByText(label)).toBeTruthy();
  });
  expect(client.getQueryState(sessionsKey(defaultInput))?.status).toBe(
    "success",
  );
}

beforeEach(() => {
  clock = epoch;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  sessionStorage.clear();
  fixture.sessions.mockReset();
  fixture.tutors.mockReset();
  fixture.committedSessions = null;
  fixture.ownerErrors = [];
  fixture.recordPrivateCommits = false;
  fixture.privateCommits = 0;
  fixture.sessionRenders = 0;
  defaultInput = { month: currentMonth(), tutorId: undefined };
  filteredInput = {
    month: defaultInput.month === "2026-08" ? "2026-07" : "2026-08",
    tutorId: "tutor",
  };
  fixture.tutors.mockResolvedValue([
    {
      id: "tutor",
      englishName: "Synthetic tutor option",
      username: "synthetic-tutor",
      status: "ACTIVE",
    },
  ]);
  fixture.sessions.mockResolvedValue([row("Private attendance evidence")]);
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
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
  unsubscribeCache = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "error" &&
      ["FORBIDDEN", "UNAUTHORIZED"].includes(
        (event.action.error as ReadError).data?.code ?? "",
      )
    ) {
      // Start observing private commits at terminal denial, not while the
      // legitimate background request is merely fetching its old content.
      fixture.recordPrivateCommits = true;
      fixture.privateCommits = 0;
    }
  });
});
afterEach(() => {
  cleanup();
  unsubscribeCache?.();
  client.clear();
  vi.restoreAllMocks();
});

it.each(["backward", "equal"] as const)(
  "recovers attendance after a newly admitted authorized read with a %s clock",
  async (correction) => {
    render(app());
    await screen.findByText("Private attendance evidence");
    clock = epoch + 60_000;
    await denySessions();
    const tutorReads = fixture.tutors.mock.calls.length;
    const reads = fixture.sessions.mock.calls.length;
    clock = correction === "backward" ? epoch : clock;
    await retrySessions();
    expect(fixture.sessions).toHaveBeenCalledTimes(reads + 1);
    expect(fixture.tutors).toHaveBeenCalledTimes(tutorReads);
    expect(client.getQueryState(sessionsKey(defaultInput))?.dataUpdatedAt).toBe(
      clock,
    );
  },
);

it("converges to denial without committing a future-dated cached month after saved filters reset", async () => {
  clock = epoch + 60_000;
  fixture.sessions.mockResolvedValueOnce([row("Private cached attendance")]);
  await client.fetchQuery({
    queryKey: sessionsKey(defaultInput),
    queryFn: () => fixture.sessions(defaultInput),
  });
  clock = epoch;
  saveFilteredView();
  render(app());
  await screen.findByText("Private attendance evidence");
  await waitFor(() =>
    expect(fixture.committedSessions).toEqual({
      key: JSON.stringify(sessionsKey(filteredInput)),
      status: "success",
      fetching: false,
    }),
  );
  const renders = fixture.sessionRenders;
  clock += 100;
  await denySessions(filteredInput);
  expect(fixture.sessionRenders - renders).toBeLessThan(40);
  expect(fixture.privateCommits).toBe(0);
  expect(screen.queryByText("Private cached attendance")).toBeNull();
  clock += 100;
  await retrySessions();
});

it("does not treat a manual reset-scope cache write as attendance authorization", async () => {
  const rendered = render(app());
  await screen.findByText("Private attendance evidence");
  clock += 100;
  await denySessions();
  const reads = fixture.sessions.mock.calls.length;
  clock += 100;
  act(() => {
    client.setQueryData(sessionsKey(defaultInput), [
      row("Manual private attendance"),
    ]);
  });
  rendered.rerender(app());
  await waitFor(() =>
    expect(fixture.committedSessions?.status).toBe("success"),
  );
  expect(fixture.sessions).toHaveBeenCalledTimes(reads);
  expect(screen.getByText(recovery("denied"))).toBeTruthy();
  expect(screen.queryByText("Manual private attendance")).toBeNull();
  expect(fixture.privateCommits).toBe(0);
  await retrySessions();
});

it("does not authorize the reset month from an old pending read canceled by denial eviction", async () => {
  await client.fetchQuery({
    queryKey: sessionsKey(defaultInput),
    queryFn: () => fixture.sessions(defaultInput),
  });
  saveFilteredView();
  render(app());
  await screen.findByText("Private attendance evidence");
  await waitFor(() =>
    expect(fixture.committedSessions).toEqual({
      key: JSON.stringify(sessionsKey(filteredInput)),
      status: "success",
      fetching: false,
    }),
  );
  const old = deferred<Session[]>();
  fixture.sessions.mockReturnValueOnce(old.promise);
  let oldRead!: Promise<Session[] | undefined>;
  await act(async () => {
    oldRead = client
      .fetchQuery({
        queryKey: sessionsKey(defaultInput),
        queryFn: () => fixture.sessions(defaultInput),
        staleTime: 0,
      })
      .catch(() => undefined);
  });
  await waitFor(() =>
    expect(client.getQueryState(sessionsKey(defaultInput))?.fetchStatus).toBe(
      "fetching",
    ),
  );
  clock += 100;
  await denySessions(filteredInput);
  await act(async () => {
    old.resolve([row("Old pending private attendance")]);
    await oldRead;
  });
  expect(screen.getByText(recovery("denied"))).toBeTruthy();
  expect(screen.queryByText("Old pending private attendance")).toBeNull();
  expect(fixture.privateCommits).toBe(0);
  clock += 100;
  await retrySessions();
});

it("recovers the tutor section independently without refreshing successful sessions", async () => {
  render(app());
  await screen.findByText("Private attendance evidence");
  const sessionReads = fixture.sessions.mock.calls.length;
  fixture.tutors.mockRejectedValueOnce(deny());
  await act(async () => {
    await client.refetchQueries({ queryKey: tutorsKey(), exact: true });
  });
  await screen.findByText(recovery("denied", en.admin.submissions.colTutor));
  expect(screen.getByText("Private attendance evidence")).toBeTruthy();
  fixture.tutors.mockResolvedValueOnce([
    {
      id: "tutor",
      englishName: "Recovered synthetic tutor",
      username: "synthetic-tutor",
      status: "ACTIVE",
    },
  ]);
  fireEvent.click(
    screen.getByRole("button", {
      name: recovery("retry", en.admin.submissions.colTutor),
    }),
  );
  await screen.findByRole("option", { name: "Recovered synthetic tutor" });
  expect(
    screen.queryByText(recovery("denied", en.admin.submissions.colTutor)),
  ).toBeNull();
  expect(fixture.sessions).toHaveBeenCalledTimes(sessionReads);
});

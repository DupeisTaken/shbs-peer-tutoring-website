/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import ReportsPage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";

const remote = vi.hoisted(() => ({
  periods: vi.fn(),
  features: vi.fn(),
  report: vi.fn(),
}));
vi.mock("~/app/_components/branding-provider", () => ({
  useBranding: () => ({ TEAM_TITLE: "Synthetic tutoring team" }),
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useQueryClient } = await import("@tanstack/react-query");
  const key = (path: string[], input?: unknown) => [
    path,
    { ...(input === undefined ? {} : { input }), type: "query" },
  ];
  const read = (path: string[], load: typeof remote.report) => ({
    _def: () => ({ path }),
    useQuery(input?: unknown, options?: { enabled?: boolean }) {
      return useQuery({
        queryKey: key(path, input),
        queryFn: (): unknown => load(input),
        ...options,
      });
    },
  });
  return {
    api: {
      account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
      useUtils: () => {
        const queryClient = useQueryClient();
        return {
          admin: {
            periodReport: {
              fetch: (input: unknown, options: { staleTime: number }) =>
                queryClient.fetchQuery({
                  queryKey: key(["admin", "periodReport"], input),
                  queryFn: (): unknown => remote.report(input),
                  ...options,
                }),
            },
          },
        };
      },
      admin: {
        periods: read(["admin", "periods"], remote.periods),
        periodReport: read(["admin", "periodReport"], remote.report),
      },
      program: { features: read(["program", "features"], remote.features) },
    },
  };
});
const report = {
  scope: { label: "Recorded report", masked: false },
  summary: {
    hours: { earned: 3, extras: 0, punishments: 0, total: 3 },
    sessions: 3,
    counts: {
      tuteesServed: 1,
      cards: 1,
      meetings: 0,
      signups: 0,
      applications: 0,
      removals: 0,
      statusRequests: 0,
      patrols: 0,
      flags: 0,
    },
    attendance: { present: 3, excused: 0, unexcused: 0 },
  },
  tutors: [],
  sessions: [],
  cards: [],
  meetings: [],
  meetingStats: [],
  adjustments: [],
  crewStats: [],
  flags: [],
  applications: [],
  signups: [],
  removals: [],
  statusRequests: [],
};

const year = "2026–2027";
const defaultInput = { schoolYear: year, depth: "summary", maskPii: false };
const selectedInput = { ...defaultInput, semester: "S1" };
const reportKey = (input: typeof defaultInput & { semester?: string }) => [
  ["admin", "periodReport"],
  { input, type: "query" },
];
const denial = { message: "Forbidden", data: { code: "FORBIDDEN" } };
const title = en.managementRecovery.denied.replace(
  "{section}",
  en.admin.reports.title,
);
const retryLabel = en.managementRecovery.retry.replace(
  "{section}",
  en.admin.reports.title,
);
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  remote.periods.mockResolvedValue([{ schoolYear: year }]);
  remote.features.mockResolvedValue({ QUARTER_SYSTEM: true });
  remote.report.mockResolvedValue(report);
});
afterEach(() => {
  cleanup();
  client.clear();
  sessionStorage.clear();
});
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <SessionViewProvider identity="head" pathname="/admin/history" verified>
          <ReportsPage />
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it("keeps a denied saved scope concealed when clearing controls selects a cached successful default", async () => {
  const storageKey = viewStateKey(
    "head",
    "/admin/history",
    "report-controls-v1",
    "manager",
  );
  writeViewState(sessionStorage, storageKey, {
    schoolYear: year,
    scope: "S1",
    depth: "summary",
    maskPii: false,
  });
  client.setQueryData(
    [["admin", "periods"], { type: "query" }],
    [{ schoolYear: year }],
  );
  client.setQueryData([["program", "features"], { type: "query" }], {
    QUARTER_SYSTEM: true,
  });
  const cachedDefault = {
    ...report,
    scope: { ...report.scope, label: "Cached default private report" },
  };
  client.setQueryData(reportKey(defaultInput), cachedDefault);
  client.setQueryData(reportKey(selectedInput), {
    ...report,
    scope: { ...report.scope, label: "Selected private report" },
  });
  mount();
  await screen.findAllByText(/Selected private report/);
  remote.report.mockRejectedValue(denial);
  await act(async () => {
    await client.refetchQueries({
      queryKey: reportKey(selectedInput),
      exact: true,
    });
  });
  await screen.findByText(title);
  expect(screen.queryAllByText(/private report/)).toHaveLength(0);
  expect(client.getQueryData(reportKey(defaultInput))).toBeUndefined();
  expect(client.getQueryData(reportKey(selectedInput))).toBeUndefined();
  expect(sessionStorage.getItem(storageKey)).toBeNull();

  // Another reader can populate the default cache; only this owner's fresh
  // explicit recovery may authorize it, even after a failed retry.
  act(() => {
    client.setQueryData(reportKey(defaultInput), cachedDefault);
  });
  remote.report.mockRejectedValue(new Error("Offline"));
  fireEvent.click(screen.getByRole("button", { name: retryLabel }));
  await waitFor(() => expect(remote.report).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: retryLabel })
        .disabled,
    ).toBe(false),
  );
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.queryAllByText(/private report/)).toHaveLength(0);
  remote.report.mockResolvedValue({
    ...report,
    scope: { ...report.scope, label: "Fresh authorized report" },
  });
  fireEvent.click(screen.getByRole("button", { name: retryLabel }));
  await screen.findAllByText(/Fresh authorized report/);
  expect(remote.report).toHaveBeenLastCalledWith(defaultInput);
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: en.admin.reports.scope,
    }).value,
  ).toBe("year");
  expect(screen.queryAllByText(/Cached default private report/)).toHaveLength(
    0,
  );
});

it("requires fresh prerequisites and a fresh report after an initially denied periods read", async () => {
  remote.periods.mockRejectedValue(denial);
  mount();
  await screen.findByText(title);
  expect(remote.report).not.toHaveBeenCalled();
  remote.periods.mockResolvedValue([{ schoolYear: year }]);
  remote.features.mockRejectedValue(new Error("Feature read offline"));
  fireEvent.click(screen.getByRole("button", { name: retryLabel }));
  await waitFor(() => expect(remote.periods).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: retryLabel })
        .disabled,
    ).toBe(false),
  );
  expect(screen.getByText(title)).toBeTruthy();
  expect(remote.report).not.toHaveBeenCalled();
  remote.features.mockResolvedValue({ QUARTER_SYSTEM: true });
  fireEvent.click(screen.getByRole("button", { name: retryLabel }));
  await screen.findAllByText(/Recorded report/);
  expect(remote.report).toHaveBeenCalledExactlyOnceWith(defaultInput);
});

it("evicts periods when a report-denial recovery subsequently loses prerequisite authority", async () => {
  mount();
  await screen.findAllByText(/Recorded report/);
  remote.report.mockRejectedValue(denial);
  await act(async () => {
    await client.refetchQueries({
      queryKey: reportKey(defaultInput),
      exact: true,
    });
  });
  await screen.findByText(title);
  expect(
    client.getQueryData([["admin", "periods"], { type: "query" }]),
  ).toBeDefined();
  remote.periods.mockRejectedValue(denial);
  fireEvent.click(screen.getByRole("button", { name: retryLabel }));
  await waitFor(() =>
    expect(
      client.getQueryData([["admin", "periods"], { type: "query" }]),
    ).toBeUndefined(),
  );
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.queryAllByText(/Recorded report/)).toHaveLength(0);
});

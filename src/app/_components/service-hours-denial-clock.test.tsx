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
import en from "../../../messages/en.json";
import ServiceHoursPage from "../(admin)/admin/service-hours/(roster)/page";
import { SessionViewProvider } from "./session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import type { ServiceHoursRow } from "~/lib/service-hours-view";
import { api } from "~/trpc/react";
import { createQueryClient } from "~/trpc/query-client";
import type * as ServiceHoursComparisonModule from "./service-hours-comparison";

type SummaryInput = { month: string } | undefined;
type Summary = {
  scope: { label: string };
  rows: ServiceHoursRow[];
  totals: {
    earned: number;
    extras: number;
    punishments: number;
    total: number;
  };
};
type ReadError = Error & { data?: { code?: string } };
type Observation = { key: string; status: string; fetching: boolean };
const fixture = vi.hoisted(() => ({
  summary: vi.fn<(input: SummaryInput) => Promise<Summary>>(),
  committed: null as Observation | null,
  ownerErrors: [] as Error[],
  recordPrivateCommits: false,
  privateCommits: 0,
  renders: 0,
}));

vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const { useLayoutEffect } = await import("react");
  const path = ["admin", "periodSummary"];
  return {
    api: {
      admin: {
        periodSummary: {
          _def: () => ({ path }),
          useQuery(input?: { month: string }, options?: { enabled?: boolean }) {
            const queryKey = [
              path,
              { ...(input === undefined ? {} : { input }), type: "query" },
            ];
            const result = useQuery<Summary, ReadError>({
              queryKey,
              queryFn: () => fixture.summary(input),
              ...options,
            });
            fixture.renders++;
            useLayoutEffect(() => {
              const committed = {
                key: JSON.stringify(queryKey),
                status: result.status,
                fetching: result.isFetching,
              };
              fixture.committed = committed;
              return () => {
                if (fixture.committed === committed) fixture.committed = null;
              };
            });
            return result;
          },
        },
      },
    },
  };
});
vi.mock("./school-hours-panel", () => ({ SchoolHoursPanel: () => null }));
vi.mock("./service-hours-comparison", async (importOriginal) => {
  const actual = await importOriginal<typeof ServiceHoursComparisonModule>();
  const { useLayoutEffect } = await import("react");
  return {
    ...actual,
    ServiceHoursComparison: function ObservedComparison(
      props: Parameters<typeof actual.ServiceHoursComparison>[0],
    ) {
      useLayoutEffect(() => {
        if (fixture.recordPrivateCommits) fixture.privateCommits++;
      });
      return <actual.ServiceHoursComparison {...props} />;
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
      <p role="alert">Service-hour owner crashed</p>
    ) : (
      this.props.children
    );
  }
}

const epoch = Date.UTC(2026, 10, 9, 12);
const filteredInput = { month: "2026-08" };
let clock: number;
let client: QueryClient;
let unsubscribeCache: (() => void) | undefined;
const summaryKey = (input?: { month: string }) =>
  getQueryKey(api.admin.periodSummary, input, "query");
const recovery = (kind: "denied" | "retry") =>
  en.managementRecovery[kind].replace("{section}", en.admin.summary.title);
const summary = (label: string): Summary => ({
  scope: { label: "Synthetic semester" },
  rows: [
    {
      tutorId: "synthetic-tutor",
      englishName: label,
      active: true,
      sessions: 1,
      adjustmentCount: 0,
      earned: 1,
      extras: 0,
      punishments: 0,
      total: 1,
    },
  ],
  totals: { earned: 1, extras: 0, punishments: 0, total: 1 },
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
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <SessionViewProvider
          identity="synthetic-head"
          pathname="/admin/service-hours"
          verified
        >
          <OwnerBoundary>
            <ServiceHoursPage />
          </OwnerBoundary>
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function saveFilteredMonth() {
  writeViewState(
    sessionStorage,
    viewStateKey(
      "synthetic-head",
      "/admin/service-hours",
      "service-hours-month-v1",
      "",
    ),
    filteredInput.month,
  );
}
async function denySummary(input?: { month: string }) {
  fixture.summary.mockRejectedValueOnce(deny());
  await act(async () => {
    await client.refetchQueries({ queryKey: summaryKey(input), exact: true });
  });
  await waitFor(() => {
    expect(fixture.ownerErrors).toEqual([]);
    expect(screen.getByText(recovery("denied"))).toBeTruthy();
  });
}
async function retrySummary(label = "Fresh authorized service hours") {
  fixture.summary.mockResolvedValueOnce(summary(label));
  fireEvent.click(screen.getByRole("button", { name: recovery("retry") }));
  await waitFor(() => {
    expect(fixture.committed).toEqual({
      key: JSON.stringify(summaryKey()),
      status: "success",
      fetching: false,
    });
    expect(screen.queryByText(recovery("denied"))).toBeNull();
    expect(screen.getByText(label)).toBeTruthy();
  });
  expect(client.getQueryState(summaryKey())?.status).toBe("success");
}

beforeEach(() => {
  clock = epoch;
  // Keep Query's natural notification timers; change wall-clock readings only.
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  sessionStorage.clear();
  fixture.summary.mockReset();
  fixture.summary.mockResolvedValue(summary("Private service-hour evidence"));
  fixture.committed = null;
  fixture.ownerErrors = [];
  fixture.recordPrivateCommits = false;
  fixture.privateCommits = 0;
  fixture.renders = 0;
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
      // Count real private comparison commits only after terminal access denial.
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
  "recovers service hours after a newly admitted authorized read with a %s clock",
  async (correction) => {
    render(app());
    await screen.findByText("Private service-hour evidence");
    clock = epoch + 60_000;
    await denySummary();
    const reads = fixture.summary.mock.calls.length;
    clock = correction === "backward" ? epoch : clock;
    await retrySummary();
    expect(fixture.summary).toHaveBeenCalledTimes(reads + 1);
    expect(client.getQueryState(summaryKey())?.dataUpdatedAt).toBe(clock);
  },
);

it("converges to denial without committing future-dated active-semester cache after a saved month resets", async () => {
  clock = epoch + 60_000;
  fixture.summary.mockResolvedValueOnce(
    summary("Private cached service hours"),
  );
  await client.fetchQuery({
    queryKey: summaryKey(),
    queryFn: () => fixture.summary(undefined),
  });
  clock = epoch;
  saveFilteredMonth();
  render(app());
  await screen.findByText("Private service-hour evidence");
  await waitFor(() =>
    expect(fixture.committed).toEqual({
      key: JSON.stringify(summaryKey(filteredInput)),
      status: "success",
      fetching: false,
    }),
  );
  const renders = fixture.renders;
  clock += 100;
  await denySummary(filteredInput);
  expect(fixture.renders - renders).toBeLessThan(40);
  expect(fixture.privateCommits).toBe(0);
  expect(screen.queryByText("Private cached service hours")).toBeNull();
  expect(
    screen.queryByRole("region", { name: en.admin.summary.programTotals }),
  ).toBeNull();
  clock += 100;
  await retrySummary();
});

it("does not treat a manual active-semester cache write as service-hour authorization", async () => {
  const rendered = render(app());
  await screen.findByText("Private service-hour evidence");
  clock += 100;
  await denySummary();
  const reads = fixture.summary.mock.calls.length;
  clock += 100;
  act(() => {
    client.setQueryData(summaryKey(), summary("Manual private service hours"));
  });
  rendered.rerender(app());
  await waitFor(() => expect(fixture.committed?.status).toBe("success"));
  expect(fixture.summary).toHaveBeenCalledTimes(reads);
  expect(screen.getByText(recovery("denied"))).toBeTruthy();
  expect(screen.queryByText("Manual private service hours")).toBeNull();
  expect(fixture.privateCommits).toBe(0);
  await retrySummary();
});

it("does not authorize active-semester totals from an old pending read canceled by denial eviction", async () => {
  await client.fetchQuery({
    queryKey: summaryKey(),
    queryFn: () => fixture.summary(undefined),
  });
  saveFilteredMonth();
  render(app());
  await screen.findByText("Private service-hour evidence");
  await waitFor(() =>
    expect(fixture.committed).toEqual({
      key: JSON.stringify(summaryKey(filteredInput)),
      status: "success",
      fetching: false,
    }),
  );
  const old = deferred<Summary>();
  fixture.summary.mockReturnValueOnce(old.promise);
  let oldRead!: Promise<Summary | undefined>;
  await act(async () => {
    oldRead = client
      .fetchQuery({
        queryKey: summaryKey(),
        queryFn: () => fixture.summary(undefined),
        staleTime: 0,
      })
      .catch(() => undefined);
  });
  await waitFor(() =>
    expect(client.getQueryState(summaryKey())?.fetchStatus).toBe("fetching"),
  );
  clock += 100;
  await denySummary(filteredInput);
  await act(async () => {
    old.resolve(summary("Old pending private service hours"));
    await oldRead;
  });
  expect(screen.getByText(recovery("denied"))).toBeTruthy();
  expect(screen.queryByText("Old pending private service hours")).toBeNull();
  expect(fixture.privateCommits).toBe(0);
  clock += 100;
  await retrySummary();
});

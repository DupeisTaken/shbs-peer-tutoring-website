/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { NextIntlClientProvider } from "next-intl";
import { Component, type ReactNode } from "react";
import messages from "../../../messages/en.json";
import { api } from "~/trpc/react";
import { createQueryClient } from "~/trpc/query-client";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import { SessionViewProvider } from "./session-view-state";
import { StudentSupport } from "./student-support";

type Feed = "feedback" | "appeals";
type FeedbackInput = { page: number };
type AppealInput = { page: number; state: "PENDING" | "RESOLVED" };
type Feedback = {
  id: string;
  studentName: string;
  subject: string;
  rating: number;
  body: string;
  updatedAt: Date;
};
type AppealRead = {
  rows: {
    id: string;
    studentName: string;
    state: "PENDING" | "RESOLVED";
    cardReason: string;
    body: string;
    updatedAt: Date;
  }[];
  total: number;
};
type FeedData = Feedback[] | AppealRead;
type ObservedRead = {
  data: unknown;
  error: unknown;
  status: string;
  fetchStatus: string;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
};
const remote = vi.hoisted(() => ({
  me: vi.fn<() => Promise<{ id: string; role: "HEAD" }>>(),
  setting: vi.fn<() => Promise<boolean>>(),
  feedback: vi.fn<(input: FeedbackInput) => Promise<Feedback[]>>(),
  appeals: vi.fn<(input: AppealInput) => Promise<AppealRead>>(),
  write: vi.fn<() => Promise<{ ok: true }>>(),
  observed: new Map<string, { key: QueryKey; result: ObservedRead }>(),
  renderErrors: [] as Error[],
}));

vi.mock("~/trpc/react", async () => {
  const { useQuery, useMutation } = await import("@tanstack/react-query");
  const { useLayoutEffect } = await import("react");
  // Preserve tRPC's input-aware key and _def so production getQueryKey bindings
  // address the same real Query, rather than a fabricated endpoint-only cache.
  function read<TInput, TData>(path: string[], load: (input: TInput) => Promise<TData>) {
    return {
      _def: () => ({ path }),
      useQuery(input?: TInput, options?: { enabled?: boolean }) {
        const queryKey = [path, { ...(input === undefined ? {} : { input }), type: "query" }];
        const result = useQuery({
          queryKey,
          queryFn: () => load(input as TInput),
          ...options,
        });
        useLayoutEffect(() => {
          // A reset can abandon an intermediate render. Record only the actual
          // committed observer, without adding fields to its Query result.
          const committed = { key: queryKey, result };
          const id = path.join(".");
          remote.observed.set(id, committed);
          return () => {
            if (remote.observed.get(id) === committed) remote.observed.delete(id);
          };
        });
        return result;
      },
    };
  }
  const write = {
    useMutation(options?: { onSuccess?: () => unknown }) {
      return useMutation({ mutationFn: remote.write, ...options });
    },
  };
  return {
    api: {
      account: { me: read(["account", "me"], remote.me) },
      student: {
        feedbackSettings: read(["student", "feedbackSettings"], remote.setting),
        feedbackList: read(["student", "feedbackList"], remote.feedback),
        appeals: read(["student", "appeals"], remote.appeals),
        setFeedbackSettings: write,
        decideAppeal: write,
      },
    },
  };
});

const epoch = Date.UTC(2026, 10, 9, 12);
const identity = "synthetic-support-head";
const pathname = "/admin/student-support";
let clock: number;
let client: QueryClient;
let unsubscribe: () => void;
type Terminal = {
  key: QueryKey;
  kind: "success" | "error";
  manual: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
};
let terminals: Terminal[];

class SupportBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    remote.renderErrors.push(error);
  }
  render() {
    return this.state.error
      ? <p role="alert">Synthetic support render failed</p>
      : this.props.children;
  }
}

function marker(feed: Feed, source: "current" | "cached" | "fresh" | "manual") {
  return `Synthetic ${feed} ${source} private evidence`;
}
function data(feed: Feed, source: "current" | "cached" | "fresh" | "manual"): FeedData {
  const common = {
    id: `${feed}-${source}`,
    studentName: "Synthetic learner",
    body: marker(feed, source),
    updatedAt: new Date("2026-11-01T06:30:00Z"),
  };
  return feed === "feedback"
    ? [{ ...common, subject: "Synthetic subject", rating: 5 }]
    : { rows: [{ ...common, state: source === "current" ? "RESOLVED" : "PENDING", cardReason: "Synthetic recorded reason" }], total: 40 };
}
function input(feed: Feed, nondefault = false): FeedbackInput | AppealInput {
  const page = nondefault ? 1 : 0;
  return feed === "feedback" ? { page } : { page, state: nondefault ? "RESOLVED" : "PENDING" };
}
function key(feed: Feed, nondefault = false) {
  return feed === "feedback"
    ? getQueryKey(api.student.feedbackList, { page: nondefault ? 1 : 0 }, "query")
    : getQueryKey(api.student.appeals, { page: nondefault ? 1 : 0, state: nondefault ? "RESOLVED" : "PENDING" }, "query");
}
function isQueryKey(value: unknown): value is QueryKey {
  return Array.isArray(value);
}
function read(feed: Feed, nondefault = false): Promise<FeedData> {
  return feed === "feedback"
    ? remote.feedback(input(feed, nondefault))
    : remote.appeals(input(feed, nondefault) as AppealInput);
}
function calls(feed: Feed) {
  return feed === "feedback"
    ? remote.feedback.mock.calls.map(([value]) => value)
    : remote.appeals.mock.calls.map(([value]) => value);
}
function path(feed: Feed) {
  return feed === "feedback" ? "student.feedbackList" : "student.appeals";
}
function events(feed: Feed, nondefault = false) {
  return terminals.filter((event) => JSON.stringify(event.key) === JSON.stringify(key(feed, nondefault)));
}
function retryName(feed: Feed) {
  const label = feed === "feedback" ? messages.workflows.feedback : messages.workflows.staffAppeals;
  return `${label} · ${messages.participantRecovery.retry}`;
}
function savedKey(id: string) {
  return viewStateKey(identity, pathname, id, "");
}
function subject() {
  return <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Shanghai">
      <SessionViewProvider identity={identity} pathname={pathname} verified>
        <SupportBoundary><StudentSupport /></SupportBoundary>
      </SessionViewProvider>
    </NextIntlClientProvider>
  </QueryClientProvider>;
}
async function observed(feed: Feed) {
  await waitFor(() => {
    expect(remote.renderErrors).toEqual([]);
    const cached = client.getQueryState(key(feed));
    const current = remote.observed.get(path(feed));
    expect(current?.key).toEqual(key(feed));
    expect(current?.result.status).toBe(cached?.status);
    expect(current?.result.fetchStatus).toBe("idle");
    expect(current?.result.data).toBe(cached?.data);
    expect(current?.result.error).toBe(cached?.error);
    expect(current?.result.dataUpdatedAt).toBe(cached?.dataUpdatedAt);
  });
}
async function deniedNondefault(feed: Feed, futureCache: boolean) {
  clock = futureCache ? epoch + 60_000 : epoch;
  await client.fetchQuery<FeedData>({ queryKey: key(feed), queryFn: () => read(feed) });
  const cachedAt = clock;
  // The ordinary cached default is still fresh when denial resets navigation;
  // this isolates authorization recovery from an automatic stale-cache refetch.
  clock = futureCache ? epoch : epoch + 1_000;
  await client.fetchQuery<FeedData>({ queryKey: key(feed, true), queryFn: () => read(feed, true) });
  writeViewState(window.sessionStorage, savedKey(`support-${feed === "feedback" ? "feedback" : "appeal"}-page-v1`), 1);
  if (feed === "appeals") {
    writeViewState(window.sessionStorage, savedKey("support-panel-v1"), "appeals");
    writeViewState(window.sessionStorage, savedKey("support-appeal-filter-v1"), "RESOLVED");
  }
  const view = render(subject());
  await screen.findByText(marker(feed, "current"));
  expect(calls(feed)).toEqual([input(feed), input(feed, true)]);

  clock += 100;
  const deniedAt = clock;
  const error = Object.assign(new Error("Synthetic revoked feed"), { data: { code: "FORBIDDEN" } });
  if (feed === "feedback") remote.feedback.mockRejectedValueOnce(error);
  else remote.appeals.mockRejectedValueOnce(error);
  await act(async () => { await client.refetchQueries({ queryKey: key(feed, true), exact: true }); });
  expect(events(feed, true).at(-1)).toMatchObject({ kind: "error", errorUpdatedAt: deniedAt });
  await observed(feed);
  // No queryFn ran at the reset/default key: its earlier real response is fresh
  // under the same cache policy even when its wall-clock stamp is in the future.
  expect(calls(feed)).toEqual([input(feed), input(feed, true), input(feed, true)]);
  expect(client.getQueryState(key(feed))?.dataUpdatedAt).toBe(cachedAt);
  expect(window.sessionStorage.getItem(savedKey(`support-${feed === "feedback" ? "feedback" : "appeal"}-page-v1`))).toBeNull();
  return { view, deniedAt, cachedAt };
}
function expectConcealed(feed: Feed) {
  for (const source of ["current", "cached", "manual"] as const)
    expect(screen.queryByText(marker(feed, source))).toBeNull();
  // Appeals denial resets its panel to Feedback. This accessible action must
  // therefore remain outside the hidden panel, rather than requiring a tab visit.
  expect(screen.getByRole("button", { name: retryName(feed) })).toBeTruthy();
  if (feed === "appeals")
    expect(screen.getByRole("tab", { name: messages.workflows.feedback }).getAttribute("aria-selected")).toBe("true");
  expect(remote.write).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  clock = epoch;
  // Keep Query's notification timers real while independently correcting the clock.
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  window.sessionStorage.clear();
  remote.observed.clear();
  remote.renderErrors.length = 0;
  remote.me.mockResolvedValue({ id: identity, role: "HEAD" });
  remote.setting.mockResolvedValue(false);
  remote.feedback.mockImplementation(async ({ page }) => data("feedback", page ? "current" : "cached") as Feedback[]);
  remote.appeals.mockImplementation(async ({ page }) => data("appeals", page ? "current" : "cached") as AppealRead);
  remote.write.mockResolvedValue({ ok: true });
  // Keep production cache construction so a shared receipt mechanism installed
  // there participates without a test-only installer or fabricated read result.
  client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: {
      ...client.getDefaultOptions().queries,
      retry: false,
      staleTime: 30_000,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { ...client.getDefaultOptions().mutations, retry: false },
  });
  terminals = [];
  unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || (event.action.type !== "success" && event.action.type !== "error")) return;
    const queryKey: unknown = event.query.queryKey;
    if (!isQueryKey(queryKey)) throw new Error("Expected an array query key");
    terminals.push({
      key: queryKey,
      kind: event.action.type,
      manual: event.action.type === "success" && event.action.manual === true,
      dataUpdatedAt: event.query.state.dataUpdatedAt,
      errorUpdatedAt: event.query.state.errorUpdatedAt,
    });
  });
});
afterEach(() => {
  cleanup();
  unsubscribe();
  client.clear();
  vi.restoreAllMocks();
});

it.each(["feedback", "appeals"] as const)(
  "keeps %s concealed when denial resets to a future-dated cached default without another read or render loop",
  async (feed) => {
    const { view, deniedAt, cachedAt } = await deniedNondefault(feed, true);
    expect(cachedAt).toBeGreaterThan(deniedAt);
    expect(events(feed)).toEqual([expect.objectContaining({ kind: "success", manual: false, dataUpdatedAt: cachedAt })]);
    expectConcealed(feed);
    view.rerender(subject());
    await observed(feed);
    expectConcealed(feed);
    expect(calls(feed)).toHaveLength(3);
  },
);

it.each([
  { feed: "feedback", completion: "backward" },
  { feed: "feedback", completion: "equal" },
  { feed: "appeals", completion: "backward" },
  { feed: "appeals", completion: "equal" },
] as const)(
  "recovers $feed after a genuinely new successful fetch at a $completion wall clock",
  async ({ feed, completion }) => {
    const { deniedAt } = await deniedNondefault(feed, false);
    expectConcealed(feed);
    clock = completion === "equal" ? deniedAt : epoch + 200;
    if (feed === "feedback") remote.feedback.mockResolvedValueOnce(data(feed, "fresh") as Feedback[]);
    else remote.appeals.mockResolvedValueOnce(data(feed, "fresh") as AppealRead);
    fireEvent.click(screen.getByRole("button", { name: retryName(feed) }));
    await waitFor(() => expect(events(feed)).toHaveLength(2));
    expect(events(feed).at(-1)).toMatchObject({ kind: "success", manual: false, dataUpdatedAt: clock });
    await observed(feed);
    expect(calls(feed)).toEqual([input(feed), input(feed, true), input(feed, true), input(feed)]);
    expect(client.getQueryState(key(feed))?.dataUpdatedAt).toBeLessThanOrEqual(deniedAt);
    await waitFor(() => expect(screen.queryByRole("button", { name: retryName(feed) })).toBeNull());
    if (feed === "appeals") fireEvent.click(screen.getByRole("tab", { name: messages.workflows.staffAppeals }));
    expect(await screen.findByText(marker(feed, "fresh"))).toBeTruthy();
    expect(remote.write).not.toHaveBeenCalled();
  },
);

it.each(["feedback", "appeals"] as const)(
  "does not treat manual setQueryData success as fresh authorization for denied %s",
  async (feed) => {
    const { deniedAt } = await deniedNondefault(feed, false);
    expectConcealed(feed);
    clock = deniedAt + 60_000;
    await act(async () => { client.setQueryData(key(feed), data(feed, "manual"), { updatedAt: clock }); });
    await observed(feed);
    expect(events(feed).at(-1)).toMatchObject({ kind: "success", manual: true, dataUpdatedAt: clock });
    expect(calls(feed)).toEqual([input(feed), input(feed, true), input(feed, true)]);
    expectConcealed(feed);
  },
);

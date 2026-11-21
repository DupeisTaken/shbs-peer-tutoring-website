/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import ReportsPage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
import { toCsv } from "~/lib/csv";

vi.mock("~/lib/csv", { spy: true });

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

const preciseHours = {
  earned: 0.25,
  extras: 0.75,
  punishments: 1.25,
  total: -0.25,
};
const minuteHours = 1 / 60;
const preciseReport = {
  ...report,
  summary: { ...report.summary, hours: preciseHours },
  tutors: [
    {
      tutorId: "precise-tutor",
      englishName: "Quarter-hour Tutor",
      active: true,
      sessions: 1,
      ...preciseHours,
    },
  ],
  sessions: [
    {
      id: "precise-session",
      date: new Date("2026-06-01T00:00:00.000Z"),
      tutor: "Quarter-hour Tutor",
      subject: "Synthetic Subject",
      tutorStatus: "PRESENT",
      shCount: 0.25,
      tutees: [],
      comments: "Stored session credit",
    },
  ],
  adjustments: [
    {
      id: "minute-credit",
      date: new Date("2026-06-01T00:00:00.000Z"),
      tutor: "Quarter-hour Tutor",
      type: "EXTRA",
      amount: minuteHours,
      reason: "One-minute interview credit",
    },
  ],
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(locale: "en" | "zh" = "en") {
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="Asia/Shanghai"
      >
        <SessionViewProvider identity="head" pathname="/admin/history" verified>
          <ReportsPage />
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it.each(["en", "zh"] as const)(
  "retains exact service-hour values in report totals, tutor cells and Details (%s)",
  async (locale) => {
    const catalog = locale === "zh" ? zh : en;
    const copy = catalog.admin.reports;
    remote.report.mockResolvedValue(preciseReport);
    mount(locale);
    const table = await screen.findByRole("table", {
      name: copy.sections.perTutor,
    });

    for (const [label, value] of [
      [copy.stat.total, "-0.25 h"],
      [copy.stat.earned, "0.25 h"],
      [copy.stat.extras, "+0.75 h"],
      [copy.stat.penalties, "−1.25 h"],
    ] as const) {
      expect(
        screen.getByText(label, { selector: "p" }).nextElementSibling
          ?.textContent,
      ).toBe(value);
    }

    const row = within(table).getByText("Quarter-hour Tutor").closest("tr")!;
    expect(
      within(row)
        .getAllByRole("cell")
        .slice(0, 6)
        .map((cell) => cell.textContent),
    ).toEqual(["Quarter-hour Tutor", "1", "0.25", "0.75", "1.25", "-0.25"]);
    fireEvent.click(within(row).getByRole("button"));
    const details = screen.getByRole("dialog", {
      name: `${copy.sections.perTutor} · Quarter-hour Tutor · 1`,
    });
    for (const [label, value] of [
      [copy.col.earned, "0.25"],
      [copy.col.extras, "0.75"],
      [copy.col.penalties, "1.25"],
      [copy.col.total, "-0.25"],
    ] as const) {
      expect(
        within(details).getByText(label, { selector: "dt" }).nextElementSibling
          ?.textContent,
      ).toBe(value);
    }
  },
);

it.each(["en", "zh"] as const)(
  "retains quarter-hour session and minute-derived adjustment values in detailed reports (%s)",
  async (locale) => {
    const catalog = locale === "zh" ? zh : en;
    const copy = catalog.admin.reports;
    remote.report.mockResolvedValue(preciseReport);
    mount(locale);
    await screen.findByRole("table", { name: copy.sections.perTutor });
    fireEvent.change(screen.getByRole("combobox", { name: copy.depth }), {
      target: { value: "detailed" },
    });
    const sessions = await screen.findByRole("table", {
      name: copy.sections.sessions,
    });
    const session = within(sessions)
      .getByText("Quarter-hour Tutor")
      .closest("tr")!;
    expect(within(session).getByText("0.25")).toBeTruthy();
    fireEvent.click(within(session).getByRole("button"));
    const sessionDetails = screen.getByRole("dialog");
    expect(
      within(sessionDetails).getByText(copy.col.hours, { selector: "dt" })
        .nextElementSibling?.textContent,
    ).toBe("0.25");
    fireEvent.click(
      within(sessionDetails).getByRole("button", {
        name: catalog.tablePatterns.close,
      }),
    );

    const adjustments = screen.getByRole("table", {
      name: copy.sections.adjustments,
    });
    const adjustment = within(adjustments)
      .getByText("Quarter-hour Tutor")
      .closest("tr")!;
    expect(within(adjustment).getByText(minuteHours.toString())).toBeTruthy();
    fireEvent.click(within(adjustment).getByRole("button"));
    expect(
      within(screen.getByRole("dialog")).getByText(copy.col.amount, {
        selector: "dt",
      }).nextElementSibling?.textContent,
    ).toBe(minuteHours.toString());
  },
);

it("keeps report CSV quantities numeric with the existing two-decimal export precision", async () => {
  remote.report.mockResolvedValue(preciseReport);
  mount();
  const tutors = await screen.findByRole("table", {
    name: en.admin.reports.sections.perTutor,
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:report");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  const exportTable = (table: HTMLElement) =>
    fireEvent.click(
      within(table.closest("section")!).getByRole("button", {
        name: en.admin.reports.csv,
      }),
    );
  exportTable(tutors);
  expect(toCsv).toHaveBeenLastCalledWith([
    ["Tutor", "Active", "Sessions", "Earned", "Extras", "Penalties", "Total"],
    ["Quarter-hour Tutor", "yes", 1, 0.25, 0.75, 1.25, -0.25],
  ]);

  fireEvent.change(
    screen.getByRole("combobox", { name: en.admin.reports.depth }),
    { target: { value: "detailed" } },
  );
  const adjustments = await screen.findByRole("table", {
    name: en.admin.reports.sections.adjustments,
  });
  expect(within(adjustments).getByText(minuteHours.toString())).toBeTruthy();
  exportTable(adjustments);
  expect(toCsv).toHaveBeenLastCalledWith([
    ["Date", "Tutor", "Type", "Amount", "Reason"],
    [
      expect.any(String),
      "Quarter-hour Tutor",
      "EXTRA",
      0.02,
      "One-minute interview credit",
    ],
  ]);
});

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

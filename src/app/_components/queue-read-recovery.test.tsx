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
import type { ReactElement, ReactNode } from "react";
import en from "../../../messages/en.json";
import CardsPage from "../(admin)/admin/discipline/page";
import TutorRequestsPage from "../(admin)/admin/tutor-requests/page";
import TuteeRequestsPage from "../(admin)/admin/tutee-requests/page";
import ReportsPage from "../(admin)/admin/history/page";
import { StudentWithdrawals } from "../(admin)/admin/tutee-requests/student-withdrawals";
import { ReadOnlyProvider } from "./read-only";

const remote = vi.hoisted(() => ({
  cards: vi.fn(),
  tutors: vi.fn(),
  removals: vi.fn(),
  periods: vi.fn(),
  features: vi.fn(),
  report: vi.fn(),
  requests: vi.fn(),
  legacy: vi.fn(),
  write: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const read = (path: string[], load: typeof remote.cards) => ({
    _def: () => ({ path }),
    useQuery(input?: unknown, options?: { enabled?: boolean }) {
      return useQuery({
        queryKey: [
          path,
          { ...(input === undefined ? {} : { input }), type: "query" },
        ],
        queryFn: (): unknown => load(input),
        ...options,
      });
    },
  });
  const write = {
    useMutation: () => ({ mutate: remote.write, reset: vi.fn() }),
  };
  const refresh = { invalidate: vi.fn(), fetch: vi.fn() };
  return {
    api: {
      useUtils: () => ({
        admin: {
          disciplinaryCards: refresh,
          tutorRequests: refresh,
          tuteeRemovalRequests: refresh,
        },
      }),
      account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
      program: { features: read(["program", "features"], remote.features) },
      admin: {
        disciplinaryCards: read(["admin", "disciplinaryCards"], remote.cards),
        reviewCard: write,
        tutorRequests: read(["admin", "tutorRequests"], remote.tutors),
        decideTutorRequest: write,
        requeueTutorTutees: write,
        tuteeRemovalRequests: read(
          ["admin", "tuteeRemovalRequests"],
          remote.removals,
        ),
        cancelTuteeOptOut: write,
        reinstateTutee: write,
        periods: read(["admin", "periods"], remote.periods),
        periodReport: read(["admin", "periodReport"], remote.report),
      },
      studentWorkflow: {
        adminRequests: read(
          ["studentWorkflow", "adminRequests"],
          remote.requests,
        ),
        legacyReviews: read(
          ["studentWorkflow", "legacyReviews"],
          remote.legacy,
        ),
        resolveReview: write,
      },
    },
  };
});
// Tickets/delay have their own tests; this fixture exercises the caller's read
// gate and retained decision, without preparing a real mutation or ticket.
vi.mock("./timed-action-dialog", () => ({
  TimedActionDialog: ({
    children,
    canConfirm,
    onConfirm,
    message,
  }: {
    children: ReactNode;
    canConfirm: boolean;
    onConfirm: (ticket: string) => void;
    message: string;
  }) => (
    <div role="dialog">
      <p>{message}</p>
      {children}
      <button
        disabled={!canConfirm}
        onClick={() => onConfirm("existing-ticket")}
      >
        Confirm decision
      </button>
    </div>
  ),
}));

const version = new Date("2026-09-01");
const card = {
  id: "card",
  color: "YELLOW",
  source: "TUTOR",
  reason: "Private discipline evidence",
  reviewStatus: "PENDING",
  reviewNote: null,
  createdAt: version,
  updatedAt: version,
  tutee: { id: "student", englishName: "Private Student" },
  issuedByTutor: null,
  session: null,
};
const tutor = {
  id: "request",
  kind: "OPT_OUT",
  tutor: { id: "tutor", englishName: "Private Tutor" },
  reason: "Private opt-out reason",
  approvable: true,
  affectedTutees: 1,
  eligibleAt: version,
};
const removals = {
  pendingOptOuts: [
    {
      id: "removal",
      tutee: { id: "student", englishName: "Private Student" },
      reason: "Private withdrawal reason",
      tutorName: "Tutor",
      subject: "Math",
      eligibleAt: version,
    },
  ],
  finalized: [],
};
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
const withdrawal = {
  name: "Private Review Student",
  reviews: [
    {
      id: "review",
      kind: "STUDENT_ABORT",
      state: "PENDING",
      createdAt: version,
      reason: "Private staff review reason",
    },
  ],
};
let client: QueryClient;
function mount(ui: ReactElement, readOnly = false) {
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <ReadOnlyProvider value={readOnly}>{ui}</ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
async function refresh(name: string, namespace = "admin") {
  await act(async () => {
    await client.refetchQueries({ queryKey: [[namespace, name]] });
  });
}
const text = (
  key: "loadFailed" | "refreshFailed" | "retry" | "denied",
  section: string,
) => en.managementRecovery[key].replace("{section}", section);
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  remote.cards.mockResolvedValue([card]);
  remote.tutors.mockResolvedValue([tutor]);
  remote.removals.mockResolvedValue(removals);
  remote.periods.mockResolvedValue([{ schoolYear: "2026–2027" }]);
  remote.features.mockResolvedValue({});
  remote.report.mockResolvedValue(report);
  remote.requests.mockResolvedValue([withdrawal]);
  remote.legacy.mockResolvedValue([]);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  client.clear();
});

const cases = [
  {
    name: "disciplinaryCards",
    load: remote.cards,
    Page: CardsPage,
    section: en.admin.cards.title,
    marker: "Private Student",
    value: [card],
    empty: en.admin.cards.nothingPending,
  },
  {
    name: "tutorRequests",
    load: remote.tutors,
    Page: TutorRequestsPage,
    section: en.admin.tutorRequests.title,
    marker: "Private opt-out reason",
    value: [tutor],
    empty: en.admin.tutorRequests.empty,
  },
  {
    name: "tuteeRemovalRequests",
    load: remote.removals,
    Page: TuteeRequestsPage,
    section: en.admin.tuteeRequests.title,
    marker: "Private withdrawal reason",
    value: removals,
    empty: en.admin.tuteeRequests.pendingEmpty,
  },
  {
    name: "periodReport",
    load: remote.report,
    Page: ReportsPage,
    section: en.admin.reports.title,
    marker: "Recorded report",
    value: report,
    empty: en.admin.reports.noData,
  },
];
for (const item of cases) {
  it(`${item.name}: initial failure is not an empty result and Retry only reads`, async () => {
    item.load.mockRejectedValue(new Error("Offline"));
    mount(<item.Page />, true);
    await screen.findByText(text("loadFailed", item.section));
    if (item.empty) expect(screen.queryByText(item.empty)).toBeNull();
    item.load.mockResolvedValue(item.value);
    fireEvent.click(
      screen.getByRole("button", { name: text("retry", item.section) }),
    );
    await screen.findAllByText(item.marker, {
      exact: item.name !== "periodReport",
    });
    expect(remote.write).not.toHaveBeenCalled();
  });
  it(`${item.name}: cached failure retains permitted records with a read-only Retry`, async () => {
    mount(<item.Page />, true);
    await screen.findAllByText(item.marker, {
      exact: item.name !== "periodReport",
    });
    item.load.mockRejectedValue(new Error("Offline"));
    await refresh(item.name);
    await screen.findByText(text("refreshFailed", item.section));
    expect(
      screen.getAllByText(item.marker, { exact: item.name !== "periodReport" })
        .length,
    ).toBeGreaterThan(0);
    item.load.mockResolvedValue(item.value);
    fireEvent.click(
      screen.getByRole("button", { name: text("retry", item.section) }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(text("refreshFailed", item.section)),
      ).toBeNull(),
    );
    expect(remote.write).not.toHaveBeenCalled();
  });
  it(`${item.name}: denial evicts private records and a failed retry cannot restore them`, async () => {
    mount(<item.Page />, true);
    await screen.findAllByText(item.marker, {
      exact: item.name !== "periodReport",
    });
    item.load.mockRejectedValue({
      message: "Forbidden",
      data: { code: "FORBIDDEN" },
    });
    await refresh(item.name);
    await screen.findByText(text("denied", item.section));
    expect(
      screen.queryAllByText(item.marker, {
        exact: item.name !== "periodReport",
      }),
    ).toHaveLength(0);
    expect(
      client
        .getQueriesData({ queryKey: [["admin", item.name]] })
        .every(([, data]) => data === undefined),
    ).toBe(true);
    item.load.mockRejectedValue(new Error("Offline"));
    fireEvent.click(
      screen.getByRole("button", { name: text("retry", item.section) }),
    );
    await waitFor(() => expect(item.load).toHaveBeenCalledTimes(3));
    expect(screen.getByText(text("denied", item.section))).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: text("retry", item.section),
        }).disabled,
      ).toBe(false),
    );
    item.load.mockResolvedValue(item.value);
    fireEvent.click(
      screen.getByRole("button", { name: text("retry", item.section) }),
    );
    await screen.findAllByText(item.marker, {
      exact: item.name !== "periodReport",
    });
    expect(remote.write).not.toHaveBeenCalled();
  });
}

it("discipline keeps the review draft and original version while Retry refreshes the list", async () => {
  mount(<CardsPage />);
  await screen.findAllByText("Private Student");
  fireEvent.click(screen.getByRole("button", { name: /^Edit:/ }));
  const dialog = screen.getByRole("dialog");
  const note = within(dialog).getByRole<HTMLInputElement>("textbox");
  fireEvent.change(note, { target: { value: "Unsubmitted review" } });
  remote.cards.mockRejectedValue(new Error("Offline"));
  await refresh("disciplinaryCards");
  await within(dialog).findByText(text("refreshFailed", en.admin.cards.title));
  expect(note.value).toBe("Unsubmitted review");
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: en.admin.cards.valid,
    }).disabled,
  ).toBe(true);
  remote.cards.mockResolvedValue([
    { ...card, updatedAt: new Date("2026-09-02") },
  ]);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: text("retry", en.admin.cards.title),
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByText(text("refreshFailed", en.admin.cards.title)),
    ).toBeNull(),
  );
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(note.value).toBe("Unsubmitted review");
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.admin.cards.valid }),
  );
  expect(remote.write).toHaveBeenCalledWith({
    id: "card",
    reviewStatus: "VALID",
    reviewNote: "Unsubmitted review",
    expectedUpdatedAt: version,
  });
});

it("tutor decisions are disabled while cached eligibility cannot be refreshed", async () => {
  mount(<TutorRequestsPage />);
  await screen.findByText("Private opt-out reason");
  remote.tutors.mockRejectedValue(new Error("Offline"));
  await refresh("tutorRequests");
  await screen.findByText(text("refreshFailed", en.admin.tutorRequests.title));
  for (const name of [
    en.admin.tutorRequests.approve,
    en.admin.tutorRequests.deny,
  ])
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name }).disabled,
    ).toBe(true);
  expect(remote.write).not.toHaveBeenCalled();
});

it("VIEWER never mounts staff withdrawal reads while removal summaries recover", async () => {
  mount(<TuteeRequestsPage />, true);
  await screen.findByText("Private withdrawal reason");
  expect(remote.requests).not.toHaveBeenCalled();
  expect(remote.legacy).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: en.admin.tuteeRequests.cancel }),
  ).toBeNull();
});

it("report waits for known feature configuration and retries the missing prerequisite only", async () => {
  remote.features.mockRejectedValue(new Error("Offline"));
  mount(<ReportsPage />);
  await screen.findByText(
    text("loadFailed", en.admin.program.features.heading),
  );
  expect(remote.report).not.toHaveBeenCalled();
  expect(screen.queryByRole("option", { name: "Q1" })).toBeNull();
  remote.features.mockResolvedValue({ QUARTER_SYSTEM: false });
  fireEvent.click(
    screen.getByRole("button", {
      name: text("retry", en.admin.program.features.heading),
    }),
  );
  await screen.findAllByText(/Recorded report/);
  expect(screen.queryByRole("option", { name: "Q1" })).toBeNull();
  expect(remote.write).not.toHaveBeenCalled();
});

it("report period failure offers recovery without requesting a fabricated empty year", async () => {
  remote.periods.mockRejectedValue(new Error("Offline"));
  mount(<ReportsPage />);
  await screen.findByText(text("loadFailed", en.admin.reports.schoolYear));
  expect(remote.report).not.toHaveBeenCalled();
  remote.periods.mockResolvedValue([{ schoolYear: "2026–2027" }]);
  fireEvent.click(
    screen.getByRole("button", {
      name: text("retry", en.admin.reports.schoolYear),
    }),
  );
  await screen.findAllByText(/Recorded report/);
  expect(remote.report).toHaveBeenCalledWith({
    schoolYear: "2026–2027",
    depth: "summary",
    maskPii: false,
  });
});

it("report recovers its evicted implicit year and freshly authorizes content with one periods Retry", async () => {
  mount(<ReportsPage />);
  await screen.findAllByText(/Recorded report/);
  remote.periods.mockRejectedValue({
    message: "Forbidden",
    data: { code: "FORBIDDEN" },
  });
  await refresh("periods");
  await screen.findByText(text("denied", en.admin.reports.title));
  expect(screen.queryAllByText(/Recorded report/)).toHaveLength(0);
  expect(
    client
      .getQueriesData({ queryKey: [["admin", "periodReport"]] })
      .every(([, data]) => data === undefined),
  ).toBe(true);
  remote.periods.mockRejectedValue(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", { name: text("retry", en.admin.reports.title) }),
  );
  await waitFor(() => expect(remote.periods).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: text("retry", en.admin.reports.title),
      }).disabled,
    ).toBe(false),
  );
  expect(screen.queryAllByText(/Recorded report/)).toHaveLength(0);
  remote.periods.mockResolvedValue([{ schoolYear: "2026–2027" }]);
  fireEvent.click(
    screen.getByRole("button", { name: text("retry", en.admin.reports.title) }),
  );
  await screen.findAllByText(/Recorded report/);
  expect(remote.report).toHaveBeenCalledTimes(2);
  expect(remote.write).not.toHaveBeenCalled();
});

it("report refresh keeps selected scope and masking keys without replaying an action", async () => {
  mount(<ReportsPage />);
  await screen.findAllByText(/Recorded report/);
  fireEvent.change(
    screen.getByRole("combobox", { name: en.admin.reports.scope }),
    { target: { value: "S1" } },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.admin.reports.maskPii }),
  );
  await waitFor(() =>
    expect(remote.report).toHaveBeenLastCalledWith({
      schoolYear: "2026–2027",
      semester: "S1",
      depth: "summary",
      maskPii: true,
    }),
  );
  await screen.findAllByText(/Recorded report/);
  remote.report.mockRejectedValue(new Error("Offline"));
  await refresh("periodReport");
  await screen.findByText(text("refreshFailed", en.admin.reports.title));
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: en.admin.reports.scope,
    }).value,
  ).toBe("S1");
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: en.admin.reports.maskPii,
    }).checked,
  ).toBe(true);
  expect(remote.write).not.toHaveBeenCalled();
});

it("withdrawal partial failure does not claim zero pending and retries only its failed source", async () => {
  remote.requests.mockRejectedValue(new Error("Offline"));
  mount(<StudentWithdrawals />);
  await screen.findByText(
    text("loadFailed", en.admin.tuteeRequests.studentHeading),
  );
  expect(screen.queryByText(en.admin.tuteeRequests.studentEmpty)).toBeNull();
  expect(
    screen.getByRole("heading", { name: en.admin.tuteeRequests.studentHeading })
      .textContent,
  ).not.toContain("0");
  remote.requests.mockResolvedValue([withdrawal]);
  fireEvent.click(
    screen.getByRole("button", {
      name: text("retry", en.admin.tuteeRequests.studentHeading),
    }),
  );
  await screen.findByText("Private staff review reason");
  expect(remote.legacy).toHaveBeenCalledOnce();
  expect(remote.write).not.toHaveBeenCalled();
});

it("withdrawal cached failure retains the admitted decision and blocks confirmation until read recovery", async () => {
  mount(<StudentWithdrawals />);
  await screen.findByText("Private staff review reason");
  fireEvent.click(screen.getByRole("button", { name: en.workflow.approve }));
  const dialog = screen.getByRole("dialog");
  remote.requests.mockRejectedValue(new Error("Offline"));
  await refresh("adminRequests", "studentWorkflow");
  await within(dialog).findByText(
    text("refreshFailed", en.admin.tuteeRequests.studentHeading),
  );
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Confirm decision",
    }).disabled,
  ).toBe(true);
  remote.requests.mockResolvedValue([withdrawal]);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: text("retry", en.admin.tuteeRequests.studentHeading),
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByText(
        text("refreshFailed", en.admin.tuteeRequests.studentHeading),
      ),
    ).toBeNull(),
  );
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(remote.write).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Confirm decision" }),
  );
  expect(remote.write).toHaveBeenCalledWith({
    id: "review",
    approve: true,
    ticket: "existing-ticket",
  });
});

it.each(["adminRequests", "legacyReviews"])(
  "staff %s denial conceals review reasons while viewer-safe removal summaries remain",
  async (name) => {
    mount(<TuteeRequestsPage />);
    await screen.findByText("Private staff review reason");
    await screen.findByText("Private withdrawal reason");
    const load = name === "adminRequests" ? remote.requests : remote.legacy;
    load.mockRejectedValue({
      message: "Unauthorized",
      data: { code: "UNAUTHORIZED" },
    });
    await refresh(name, "studentWorkflow");
    await screen.findByText(
      text("denied", en.admin.tuteeRequests.studentHeading),
    );
    expect(screen.queryByText("Private staff review reason")).toBeNull();
    expect(screen.getByText("Private withdrawal reason")).toBeTruthy();
    for (const key of ["adminRequests", "legacyReviews"])
      expect(
        client
          .getQueriesData({ queryKey: [["studentWorkflow", key]] })
          .every(([, data]) => data === undefined),
      ).toBe(true);
    load.mockRejectedValue(new Error("Offline"));
    fireEvent.click(
      screen.getByRole("button", {
        name: text("retry", en.admin.tuteeRequests.studentHeading),
      }),
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("Private staff review reason")).toBeNull();
    expect(remote.write).not.toHaveBeenCalled();
  },
);

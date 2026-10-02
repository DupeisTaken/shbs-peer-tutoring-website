/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import zh from "../../../messages/zh.json";
import messages from "../../../messages/en.json";
import AuditPage from "../(admin)/admin/audit/page";
import AttendancePage from "../(admin)/admin/attendance/page";
import DisciplinePage from "../(admin)/admin/discipline/page";
import ServiceHoursPage from "../(admin)/admin/service-hours/page";
import HistoryPage from "../(admin)/admin/history/page";

const state = vi.hoisted(() => {
  const permissions: { accountRole: string | null } = { accountRole: "HEAD" };
  const date = new Date("2026-09-15T08:00:00Z");
  const tutor = {
    tutorId: "tutor-1",
    englishName: "Alex Tutor",
    active: true,
    sessions: 3,
    earned: 3,
    extras: 2,
    punishments: 1,
    total: 4,
  };
  return {
    readOnly: false,
    ...permissions,
    undo: vi.fn(),
    review: vi.fn(),
    correction: vi.fn(),
    csv: vi.fn(() => "csv"),
    audit: [
      {
        id: "audit-1",
        createdAt: date,
        userName: "Coordinator",
        kind: "ACTION",
        action: "Updated tutoring settings",
        details: { privateNote: "Detailed audit payload" },
        approvalId: "approval-1",
        undoData: { previous: true },
        undone: false,
      },
    ],
    sessions: [
      {
        id: "session-1",
        date,
        tutor: { englishName: "Alex Tutor" },
        pairing: { subject: "Mathematics" },
        tutorStatus: "PRESENT",
        tutees: [
          { tutee: { englishName: "First Student" } },
          { tutee: { englishName: "Second Student" } },
        ],
        shCount: 1,
        mergeGroupId: null as string | null,
      },
    ],
    cards: [
      {
        id: "card-1",
        color: "YELLOW",
        source: "TUTOR",
        reason: "Detailed disciplinary reason",
        reviewStatus: "PENDING",
        reviewNote: "Recorded review note",
        createdAt: date,
        updatedAt: date,
        tutee: { id: "student-1", englishName: "First Student" },
        issuedByTutor: { englishName: "Alex Tutor" },
        session: { date },
      },
    ],
    tutor,
    report: {
      scope: { label: "2026–2027", masked: false },
      summary: {
        hours: { earned: 3, extras: 2, punishments: 1, total: 4 },
        sessions: 1,
        counts: {
          tuteesServed: 2,
          cards: 1,
          meetings: 1,
          signups: 1,
          applications: 1,
          removals: 1,
          statusRequests: 1,
          patrols: 1,
          flags: 1,
        },
        attendance: { present: 1, excused: 0, unexcused: 0 },
      },
      tutors: [tutor],
      sessions: [
        {
          id: "session-1",
          date,
          tutor: "Alex Tutor",
          subject: "Mathematics",
          tutorStatus: "PRESENT",
          shCount: 1,
          tutees: [{ name: "First Student", status: "PRESENT" }],
          comments: "Session comments",
        },
      ],
      cards: [
        {
          id: "card-1",
          date,
          tutee: "First Student",
          color: "YELLOW",
          source: "TUTOR",
          reviewStatus: "VALID",
          issuedBy: "Alex Tutor",
          reason: "Detailed disciplinary reason",
        },
      ],
      meetings: [
        {
          id: "meeting-1",
          date,
          title: "Weekly meeting",
          present: 2,
          excused: 1,
          unexcused: 0,
        },
      ],
      meetingStats: [
        {
          tutorId: "tutor-1",
          tutor: "Alex Tutor",
          present: 2,
          excused: 1,
          unexcused: 0,
        },
      ],
      adjustments: [
        {
          id: "adjustment-1",
          date,
          tutor: "Alex Tutor",
          type: "EXTRA",
          amount: 2,
          reason: "Detailed adjustment reason",
        },
      ],
      crewStats: [
        { userId: "crew-1", member: "Crew Member", patrols: 1, hours: 0.5 },
      ],
      flags: [
        {
          id: "flag-1",
          date,
          tutor: "Alex Tutor",
          subject: "Mathematics",
          expected: 2,
          observed: 1,
          state: "PENDING",
        },
      ],
      applications: [
        {
          id: "application-1",
          date,
          name: "Applicant",
          status: "PENDING",
          contact: "application@example.test",
        },
      ],
      signups: [
        {
          id: "signup-1",
          date,
          name: "Student Signup",
          grade: "10",
          status: "PENDING",
          firstChoice: "Mathematics",
          secondChoice: "Physics",
          contact: "signup@example.test",
        },
      ],
      removals: [
        {
          id: "removal-1",
          date,
          tutee: "First Student",
          kind: "REMOVAL",
          state: "PENDING",
        },
      ],
      statusRequests: [
        {
          id: "request-1",
          date,
          tutor: "Alex Tutor",
          kind: "OPT_OUT",
          state: "PENDING",
        },
      ],
    },
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./read-only", () => ({ useReadOnly: () => state.readOnly }));
vi.mock("./branding-provider", () => ({
  useBranding: () => ({ TEAM_TITLE: "Tutoring" }),
}));
vi.mock("./audit-filters", () => ({ AuditFilters: () => null }));
vi.mock("./attendance-correction", () => ({
  AttendanceCorrection: ({ id }: { id: string }) => {
    state.correction(id);
    return (
      <label>
        Correction
        <input defaultValue={id} />
      </label>
    );
  },
}));
vi.mock("~/lib/csv", () => ({ toCsv: state.csv }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        auditLog: { invalidate: vi.fn() },
        disciplinaryCards: { invalidate: vi.fn() },
      },
    }),
    program: { features: { useQuery: () => ({ data: {} }) } },
    account: {
      me: {
        useQuery: () => ({
          data:
            state.accountRole === null
              ? undefined
              : { role: state.accountRole },
        }),
      },
    },
    admin: {
      auditLog: { useQuery: () => ({ data: state.audit }) },
      undoAudit: {
        useMutation: () => ({ mutate: state.undo, isPending: false }),
      },
      tutors: {
        useQuery: () => ({
          data: [{ id: "tutor-1", englishName: "Alex Tutor" }],
        }),
      },
      sessions: { useQuery: () => ({ data: state.sessions }) },
      disciplinaryCards: { useQuery: () => ({ data: state.cards }) },
      reviewCard: {
        useMutation: () => ({ mutate: state.review, isPending: false }),
      },
      periodSummary: {
        useQuery: () => ({
          data: { scope: { label: "Current semester" }, rows: [state.tutor] },
        }),
      },
      periods: { useQuery: () => ({ data: [{ schoolYear: "2026–2027" }] }) },
      periodReport: { useQuery: () => ({ data: state.report }) },
    },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider
    locale="en"
    messages={messages}
    timeZone="Asia/Shanghai"
  >
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  state.readOnly = false;
  state.accountRole = "HEAD";
  state.sessions[0]!.mergeGroupId = null;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Every row-level entry must stay in the final cell, independent of desktop/mobile CSS. */
function rightmostActions(table: HTMLElement) {
  const row = within(table).getAllByRole("row")[1]!;
  const cells = within(row).getAllByRole("cell");
  const actions = cells.at(-1)!;
  expect(actions.classList.contains("table-actions")).toBe(true);
  for (const cell of cells.slice(0, -1))
    expect(within(cell).queryAllByRole("button")).toHaveLength(0);
  return actions;
}

it("keeps audit payload off the summary and preserves request links and undo identity in the last cell", () => {
  render(<AuditPage />, { wrapper });
  const actions = rightmostActions(screen.getByRole("table"));
  expect(screen.queryByText(/Detailed audit payload/)).toBeNull();
  expect(
    within(actions)
      .getByRole("link", { name: messages.approvals.viewRequest })
      .getAttribute("href"),
  ).toBe("/admin/approvals?request=approval-1");
  fireEvent.click(
    within(actions).getByRole("button", { name: messages.admin.audit.undo }),
  );
  expect(state.undo).toHaveBeenCalledWith({ id: "audit-1" });
  fireEvent.click(
    within(actions).getByRole("button", { name: /^View details:/ }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    "Detailed audit payload",
  );
});

it("allows audit detail summaries to viewers without exposing restricted payload or mutations", () => {
  state.readOnly = true;
  render(<AuditPage />, { wrapper });
  const actions = rightmostActions(screen.getByRole("table"));
  expect(within(actions).queryByRole("link")).toBeNull();
  expect(
    within(actions).queryByRole("button", { name: messages.admin.audit.undo }),
  ).toBeNull();
  fireEvent.click(
    within(actions).getByRole("button", { name: /^View details:/ }),
  );
  expect(screen.getByRole("dialog").textContent).not.toContain(
    "Detailed audit payload",
  );
});

it("summarizes attendance with a tutee count and mounts its selected correction only after Edit", () => {
  render(<AttendancePage />, { wrapper });
  const actions = rightmostActions(screen.getByRole("table"));
  expect(screen.queryByText("First Student")).toBeNull();
  expect(state.correction).not.toHaveBeenCalled();
  fireEvent.click(
    within(actions).getByRole("button", { name: /^View details:/ }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("First Student"),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("dialog")).getByText("Second Student"),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tablePatterns.close }),
  );
  fireEvent.click(
    within(actions).getByRole("button", {
      name: new RegExp(`^${messages.corrections.editAttendance}:`),
    }),
  );
  expect(state.correction).toHaveBeenCalledWith("session-1");
  expect(
    within(screen.getByRole("dialog")).getByRole<HTMLInputElement>("textbox", {
      name: "Correction",
    }).value,
  ).toBe("session-1");
});

it.each(["viewer", "merged-secondary"])(
  "preserves the attendance edit restriction for %s",
  (mode) => {
    state.readOnly = mode === "viewer";
    if (mode === "merged-secondary")
      state.sessions[0]!.mergeGroupId = "primary-session";
    render(<AttendancePage />, { wrapper });
    expect(
      screen.queryByRole("button", {
        name: new RegExp(`^${messages.corrections.editAttendance}:`),
      }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /^View details:/ })).toBeTruthy();
  },
);

it("moves disciplinary review inputs into the pending row's Edit dialog and preserves versioned decisions", () => {
  render(<DisciplinePage />, { wrapper });
  const pending = screen.getByRole("table", {
    name: messages.admin.cards.pendingReview,
  });
  const actions = rightmostActions(pending);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText("Detailed disciplinary reason")).toBeNull();
  fireEvent.click(within(actions).getByRole("button", { name: /^Edit:/ }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "Reviewed in detail" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: messages.admin.cards.valid }),
  );
  expect(state.review).toHaveBeenCalledWith({
    id: "card-1",
    reviewStatus: "VALID",
    reviewNote: "Reviewed in detail",
    expectedUpdatedAt: state.cards[0]!.updatedAt,
  });
});

it("provides discipline details to viewers while keeping review controls hidden", () => {
  state.readOnly = true;
  render(<DisciplinePage />, { wrapper });
  const pending = screen.getByRole("table", {
    name: messages.admin.cards.pendingReview,
  });
  fireEvent.click(
    within(rightmostActions(pending)).getByRole("button", {
      name: /^View details:/,
    }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    "Detailed disciplinary reason",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: messages.admin.cards.valid }),
  ).toBeNull();
});

it("keeps standing logs and card history behind rightmost detail links", () => {
  render(<DisciplinePage />, { wrapper });
  const standing = screen.getByRole("table", {
    name: messages.admin.cards.standingHeading,
  });
  fireEvent.click(
    within(rightmostActions(standing)).getByRole("button", {
      name: /^View details:/,
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(
      "Detailed disciplinary reason",
    ),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tablePatterns.close }),
  );
  fireEvent.click(
    screen.getByRole("heading", { name: messages.admin.cards.historyHeading }),
  );
  const history = screen.getByRole("table", {
    name: messages.admin.cards.historyHeading,
  });
  const actions = rightmostActions(history);
  expect(history.textContent).not.toContain("Detailed disciplinary reason");
  fireEvent.click(
    within(actions).getByRole("button", { name: /^View details:/ }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Recorded review note"),
  ).toBeTruthy();
});

it("keeps service-hour totals brief and opens the full calculation through Details", () => {
  render(<ServiceHoursPage />, { wrapper });
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
  const actions = rightmostActions(table);
  expect(
    within(table).queryByText(messages.admin.summary.columns.penalties),
  ).toBeNull();
  fireEvent.click(
    within(actions).getByRole("button", { name: /^View details:/ }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(
      messages.admin.summary.columns.penalties,
    ),
  ).toBeTruthy();
  expect(within(screen.getByRole("dialog")).getByText("4.0")).toBeTruthy();
});

it("adds a final Details link to every history report while retaining detailed print cells", () => {
  render(<HistoryPage />, { wrapper });
  fireEvent.change(
    screen.getByRole("combobox", { name: messages.admin.reports.depth }),
    { target: { value: "full" } },
  );
  const tables = screen.getAllByRole("table");
  expect(tables).toHaveLength(12);
  for (const table of tables) {
    const actions = rightmostActions(table);
    expect(
      within(actions).getByRole("button", { name: /^View details:/ }).className,
    ).toContain("table-action-link");
  }
  const adjustments = screen.getByRole("table", {
    name: messages.admin.reports.sections.adjustments,
  });
  const reasonCell = within(adjustments)
    .getByText("Detailed adjustment reason")
    .closest("td");
  expect(reasonCell?.className).toContain("print-only");
  fireEvent.click(
    within(rightmostActions(adjustments)).getByRole("button", {
      name: /^View details:/,
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Detailed adjustment reason"),
  ).toBeTruthy();
});

it("keeps full signup contact and subject columns in CSV exports after compacting screen tables", () => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:report"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  render(<HistoryPage />, { wrapper });
  fireEvent.change(
    screen.getByRole("combobox", { name: messages.admin.reports.depth }),
    { target: { value: "full" } },
  );
  const section = screen
    .getByRole("table", { name: messages.admin.reports.sections.signups })
    .closest("section")!;
  fireEvent.click(
    within(section).getByRole("button", { name: messages.admin.reports.csv }),
  );
  expect(state.csv).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.arrayContaining([
        "Student Signup",
        "Mathematics",
        "Physics",
        "signup@example.test",
      ]),
    ]),
  );
});

it.each(["ADMIN", "COORDINATOR", "VIEWER", null])(
  "keeps report detail access without exposing Head-only CSV exports for role %s",
  (role) => {
    // A missing account response must not briefly expose privileged exports.
    state.accountRole = role;
    render(<HistoryPage />, { wrapper });
    fireEvent.change(
      screen.getByRole("combobox", { name: messages.admin.reports.depth }),
      { target: { value: "full" } },
    );
    expect(screen.getAllByRole("table")).toHaveLength(12);
    expect(
      screen.queryByRole("button", { name: messages.admin.reports.csv }),
    ).toBeNull();
    const adjustments = screen.getByRole("table", {
      name: messages.admin.reports.sections.adjustments,
    });
    fireEvent.click(
      within(rightmostActions(adjustments)).getByRole("button", {
        name: /^View details:/,
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Detailed adjustment reason",
      ),
    ).toBeTruthy();
    expect(state.csv).not.toHaveBeenCalled();
  },
);

it.each(["en", "zh"] as const)(
  "localizes attendance in both viewer summary and expanded detail (%s)",
  (locale) => {
    state.readOnly = true;
    const copy = locale === "en" ? messages : zh;
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={copy}
        timeZone="Asia/Shanghai"
      >
        <AttendancePage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("table").textContent).toContain(
      copy.tutor.attendance.tutorStatusOpt.PRESENT,
    );
    expect(screen.getByRole("table").textContent).not.toContain("PRESENT");
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`^${copy.tablePatterns.details}:`),
      }),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      copy.tutor.attendance.tutorStatusOpt.PRESENT,
    );
    expect(screen.getByRole("dialog").textContent).not.toContain("PRESENT");
    expect(state.correction).not.toHaveBeenCalled();
  },
);

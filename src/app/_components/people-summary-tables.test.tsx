/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import UsersPage from "../(admin)/admin/users/page";
import TutorsPage from "../(admin)/admin/tutors/page";
import TuteesPage from "../(admin)/admin/tutees/page";
import CrewPage from "../(admin)/admin/crew/page";
import { ReadOnlyProvider } from "./read-only";

const state = vi.hoisted(() => ({
  readOnly: false,
  callerRole: "HEAD",
  pending: false,
  sendSetup: vi.fn(),
  deleteUser: vi.fn(),
  reinstate: vi.fn(),
  deleteTutee: vi.fn(),
  crewStatus: vi.fn(),
  details: vi.fn(),
  history: vi.fn(),
  accountDetails: vi.fn(),
  tutors: [
    {
      id: "tutor",
      englishName: "Synthetic Tutor",
      firstName: "Synthetic",
      lastName: "Tutor",
      username: "tutor",
      alternativeNames: "Tutor alternate identity",
      gradeLevel: 11,
      academic: {
        status: "REPORTED",
        gradeLevel: 11,
        expectedGraduationYear: 2028,
        schoolYear: "26-27",
        needsConfirmation: false,
      },
      status: "ACTIVE",
      email: "tutor@example.test",
      user: null,
    },
  ],
  tutees: [
    {
      id: "tutee",
      englishName: "Synthetic Tutee",
      alternativeNames: "Tutee alternate identity",
      gradeLevel: "10",
      historical: false,
      academic: {
        status: "UNKNOWN",
        gradeLevel: null,
        needsConfirmation: true,
      },
      enrollmentPeriod: { schoolYear: "26-27", quarter: "Q1" },
      status: "ACTIVE",
      email: "tutee@example.test",
      user: null,
      firstChoice: {
        id: "course",
        name: "Advanced comparative mathematics course",
      },
      secondChoice: null,
    },
  ],
  pairings: [
    {
      id: "pair",
      tutorId: "tutor",
      subject: "Advanced comparative mathematics course",
      scheduleConfirmed: false,
      dayOfWeek: 1,
      startMin: 480,
      endMin: 540,
      timeSlot: { label: "Long afternoon slot description" },
      tutees: [
        { tutee: { id: "tutee", englishName: "Synthetic Tutee" } },
        { tutee: { id: "tutee-2", englishName: "Second Tutee" } },
      ],
    },
  ],
  stats: {
    tutee: {
      sessions: 3,
      present: 2,
      validYellow: 1,
      validRed: 1,
      effectiveReds: 1,
      removalPending: true,
    },
  },
  crew: [
    {
      id: "crew",
      name: "Synthetic Crew",
      status: "ACTIVE",
      tutor: null,
      crewOnly: true,
      patrols: 3,
      hours: 1.5,
    },
  ],
  empty: [],
}));

vi.mock("~/app/_components/tutor-profile-editor", () => ({
  TutorProfileEditor: ({ row }: { row: { englishName: string } }) => (
    <div role="dialog">Editing {row.englishName}</div>
  ),
}));
vi.mock("~/app/_components/tutee-editor", () => ({
  TuteeEditor: ({ row }: { row: { englishName: string } }) => (
    <div role="dialog">Editing {row.englishName}</div>
  ),
}));
vi.mock("~/app/_components/account-profile-editor", () => ({
  AccountProfileEditor: ({ profile }: { profile: { name: string } }) => (
    <div role="dialog">Editing {profile.name}</div>
  ),
}));
vi.mock("~/app/_components/acceptance-records", () => ({
  AcceptanceRecords: () => null,
}));
vi.mock("~/app/_components/patrol-corrections", () => ({
  PatrolCorrections: () => null,
}));
vi.mock("~/app/_components/acceptance-records", () => ({
  AcceptanceRecords: () => null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: new Proxy(
        {},
        { get: () => ({ invalidate: async () => undefined }) },
      ),
      tuteeHistory: { invalidate: async () => undefined },
    }),
    program: {
      profilePolicy: {
        useQuery: () => ({
          data: { offeredGrades: [10, 11, 12], currentSchoolYear: "26-27" },
        }),
      },
    },
    tuteeHistory: {
      permissions: {
        useQuery: () => ({
          data: {
            canLink: !state.readOnly,
            isHead: state.callerRole === "HEAD",
          },
        }),
      },
    },
    accountCombine: {
      candidates: { useQuery: () => ({ data: [] }) },
      combine: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    admin: {
      accountDetails: { useQuery: state.accountDetails },
      accounts: {
        useQuery: () => ({
          data: {
            caller: { id: "staff", role: state.callerRole },
            rows: [
              {
                userId: null,
                tutorId: "tutor",
                name: "Synthetic Tutor",
                username: "tutor",
                alternativeNames: "Tutor alternate identity",
                role: null,
                account: "none",
                tutorHasEmail: true,
                email: "tutor@example.test",
                tutor: {
                  status: "ACTIVE",
                  email: "tutor@example.test",
                  englishName: "Synthetic Tutor",
                  gradeLevel: 11,
                },
                tutorStatus: "ACTIVE",
                academic: {
                  status: "REPORTED",
                  gradeLevel: 11,
                  expectedGraduationYear: 2028,
                  schoolYear: "26-27",
                  needsConfirmation: false,
                },
                isSelf: false,
                profileVersion: null,
              },
              {
                userId: "viewer",
                tutorId: null,
                name: "Synthetic Viewer",
                username: "viewer",
                alternativeNames: "Viewer alternate identity",
                role: "VIEWER",
                academic: {
                  status: "NOT_APPLICABLE",
                  gradeLevel: null,
                  needsConfirmation: false,
                },
                account: "registered",
                email: "viewer@example.test",
                affiliation:
                  "A very detailed affiliation that belongs in the dialog",
                suspended: true,
                isSelf: false,
                profileVersion: 1,
              },
            ],
          },
        }),
      },
      backfillStudentUsernames: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      appeals: { useQuery: () => ({ data: state.empty }) },
      deleteUser: {
        useMutation: () => ({
          mutate: state.deleteUser,
          isPending: state.pending,
        }),
      },
      suspendUser: { useMutation: () => ({ mutate: vi.fn() }) },
      reinstateUser: {
        useMutation: () => ({
          mutate: state.reinstate,
          isPending: state.pending,
        }),
      },
      decideAppeal: { useMutation: () => ({ mutate: vi.fn() }) },
      sendTutorSetup: {
        useMutation: () => ({
          mutate: state.sendSetup,
          isPending: state.pending,
        }),
      },
      sendAccountVerification: { useMutation: () => ({ mutate: vi.fn() }) },
      tutors: { useQuery: () => ({ data: state.tutors }) },
      createTutor: { useMutation: () => ({ mutate: vi.fn() }) },
      tutees: { useQuery: () => ({ data: state.tutees }) },
      subjects: { useQuery: () => ({ data: state.empty }) },
      pairings: { useQuery: () => ({ data: state.pairings }) },
      tuteeStats: { useQuery: () => ({ data: state.stats }) },
      createTutee: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteTutee: { useMutation: () => ({ mutateAsync: state.deleteTutee }) },
      patrolOrder: { useQuery: () => ({ data: state.empty }) },
      crewRoster: { useQuery: () => ({ data: state.crew }) },
      crewApplications: { useQuery: () => ({ data: state.empty }) },
      crewRequests: { useQuery: () => ({ data: state.empty }) },
      crewIssuedCodes: { useQuery: () => ({ data: state.empty }) },
      setPatrolOrder: { useMutation: () => ({ mutate: vi.fn() }) },
      setCrewStatus: {
        useMutation: () => ({
          mutateAsync: state.crewStatus,
          isPending: state.pending,
        }),
      },
      deleteCrewMember: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      decideCrewApplication: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      decideCrewRequest: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    tutorDetails: { get: { useQuery: state.details } },
    student: { acceptanceRecords: { useQuery: state.history } },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    <ReadOnlyProvider value={state.readOnly}>{children}</ReadOnlyProvider>
  </NextIntlClientProvider>
);
beforeEach(() => {
  state.readOnly = false;
  state.pending = false;
  state.callerRole = "HEAD";
  localStorage.clear();
  vi.clearAllMocks();
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
  state.details.mockReturnValue({
    data: {
      id: "tutor",
      name: "Synthetic Tutor",
      userId: null,
      email: "tutor@example.test",
      alternativeNames: "Tutor alternate identity",
      username: "tutor",
      gradeLevel: 11,
      academic: {
        status: "REPORTED",
        gradeLevel: 11,
        schoolYear: "26-27",
        expectedGraduationYear: 2028,
        needsConfirmation: false,
      },
      status: "ACTIVE",
      badges: ["TUTOR"],
      groups: [],
    },
  });
  state.accountDetails.mockReturnValue({
    data: { attached: [], retained: [], membership: null },
  });
  state.history.mockReturnValue({
    data: { current: [], rows: [], more: false },
  });
  state.accountDetails.mockReturnValue({
    data: { attached: [], retained: [], membership: null },
  });
});
afterEach(cleanup);

/** A behavioral layout contract: an unfamiliar row has one predictable place for every action. */
function expectTrailingActions(table: HTMLElement) {
  const headers = within(table).getAllByRole("columnheader");
  expect(headers.at(-1)?.textContent).toBe(en.tablePatterns.actions);
  for (const row of within(table).getAllByRole("row").slice(1)) {
    const cells = within(row).getAllByRole("cell");
    for (const cell of cells.slice(0, -1))
      expect(
        cell.querySelector("button,a,input,select,textarea,summary"),
      ).toBeNull();
    for (const action of cells.at(-1)!.querySelectorAll("button,a"))
      expect(action.classList.contains("table-action-link")).toBe(true);
  }
}
function rowFor(table: HTMLElement, name: string) {
  return within(table).getAllByText(name, { exact: true })[0]!.closest("tr")!;
}

describe("people summary tables", () => {
  it("reviews tutee deletion with the participant name and preserves cancellation", async () => {
    render(<TuteesPage />, { wrapper });
    const table = screen.getByRole("table", {
      name: en.admin.tutees.viewTutees,
    });
    fireEvent.click(
      within(table).getByRole("button", { name: en.admin.tutees.deleteBtn }),
    );
    expect(screen.getByRole("dialog").textContent).toContain("Synthetic Tutee");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.deleteTutee).not.toHaveBeenCalled();
    fireEvent.click(
      within(table).getByRole("button", { name: en.admin.tutees.deleteBtn }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: en.admin.tutees.deleteBtn,
      }),
    );
    await waitFor(() =>
      expect(state.deleteTutee).toHaveBeenCalledWith({ id: "tutee" }),
    );
  });
  it("keeps Users setup and moderation in Actions while full identity/history opens on demand", () => {
    render(<UsersPage />, { wrapper });
    const table = screen.getByRole("table", { name: en.admin.users.title });
    expectTrailingActions(table);
    expect(within(table).queryByText("Viewer alternate identity")).toBeNull();
    expect(within(table).queryByText(/A very detailed affiliation/)).toBeNull();
    expect(state.history).not.toHaveBeenCalled();
    expect(state.accountDetails).not.toHaveBeenCalled();
    fireEvent.click(
      within(rowFor(table, "Synthetic Tutor")).getByRole("button", {
        name: en.admin.tutors.account.sendSetup,
      }),
    );
    expect(state.sendSetup).toHaveBeenCalledWith({ tutorId: "tutor" });
    const viewer = within(rowFor(table, "Synthetic Viewer"));
    fireEvent.click(
      viewer.getByRole("button", { name: en.admin.users.reinstate }),
    );
    expect(state.reinstate).toHaveBeenCalledWith({ userId: "viewer" });
    fireEvent.click(
      viewer.getByRole("button", {
        name: `${en.accountProfile.showDetails}: Synthetic Viewer`,
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Viewer alternate identity/)).toBeTruthy();
    expect(
      within(dialog).getByText(/A very detailed affiliation/),
    ).toBeTruthy();
    expect(state.accountDetails).toHaveBeenCalledWith(
      { userId: "viewer" },
      expect.any(Object),
    );
  });

  it("preserves head-only deletion and the existing password check", () => {
    const { rerender } = render(<UsersPage />, { wrapper });
    fireEvent.click(
      within(rowFor(screen.getByRole("table"), "Synthetic Viewer")).getByRole(
        "button",
        { name: en.admin.users.delete },
      ),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: en.admin.users.delete,
      }).disabled,
    ).toBe(true);
    fireEvent.change(
      within(dialog).getByPlaceholderText(
        en.admin.users.confirm.passwordPlaceholder,
      ),
      { target: { value: "synthetic-password" } },
    );
    fireEvent.submit(dialog.querySelector("form")!);
    expect(state.deleteUser).toHaveBeenCalledWith({
      userId: "viewer",
      confirmPassword: "synthetic-password",
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en.admin.users.confirm.cancel,
      }),
    );
    state.callerRole = "COORDINATOR";
    rerender(<UsersPage />);
    expect(
      within(screen.getByRole("table")).queryByRole("button", {
        name: en.admin.users.delete,
      }),
    ).toBeNull();
  });

  it("keeps Tutors brief and delays detailed profile queries until the final-column link opens", () => {
    render(<TutorsPage />, { wrapper });
    const table = screen.getByRole("table", { name: en.admin.tutors.title });
    expectTrailingActions(table);
    expect(within(table).queryByText("Tutor alternate identity")).toBeNull();
    expect(state.details).not.toHaveBeenCalled();
    fireEvent.click(
      within(table).getByRole("button", {
        name: "View user details for Synthetic Tutor",
      }),
    );
    expect(state.details).toHaveBeenCalledWith({ tutorId: "tutor" });
    expect(
      within(screen.getByRole("dialog")).getByText("Tutor alternate identity"),
    ).toBeTruthy();
  });

  it("opens the existing tutor editor from a text action and keeps it unavailable to viewers", () => {
    const { rerender } = render(<TutorsPage />, { wrapper });
    fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: en.accountProfile.editProfile,
      }),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Editing Synthetic Tutor",
    );
    state.readOnly = true;
    rerender(<TutorsPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      within(screen.getByRole("table")).queryByRole("button", {
        name: en.accountProfile.editProfile,
      }),
    ).toBeNull();
    expect(state.details).not.toHaveBeenCalled();
    // Sorting remains available to viewers; row-specific private actions do not.
    expect(screen.getByRole("table").querySelector("tbody button")).toBeNull();
    expect(
      within(screen.getByRole("table")).getByText("Grade 11"),
    ).toBeTruthy();
    expect(state.details).not.toHaveBeenCalled();
  });

  it("summarizes tutee courses and moves discipline, contact, and editing into the last column", () => {
    render(<TuteesPage />, { wrapper });
    const table = screen.getByRole("table", {
      name: en.admin.tutees.viewTutees,
    });
    expectTrailingActions(table);
    expect(
      within(table).queryByText("Advanced comparative mathematics course"),
    ).toBeNull();
    expect(
      within(table)
        .getByRole("link", { name: en.admin.tutees.colDiscipline })
        .getAttribute("href"),
    ).toBe("/admin/discipline");
    fireEvent.click(
      within(table).getByRole("button", {
        name: `${en.tablePatterns.details}: Synthetic Tutee · ${en.admin.tutees.colCourses}`,
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Advanced comparative mathematics course",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("dialog")).queryByText("tutee@example.test"),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: en.tablePatterns.close }),
    );
    fireEvent.click(
      within(table).getByRole("button", { name: en.accountProfile.showEmail }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText("tutee@example.test"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: en.accountProfile.copyEmail,
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: en.accountProfile.close }),
    );
    fireEvent.click(
      within(table).getByRole("button", {
        name: en.accountProfile.editProfile,
      }),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Editing Synthetic Tutee",
    );
  });

  it("puts pairing participants behind Details while preserving the unscheduled state", () => {
    render(<TuteesPage />, { wrapper });
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.tutees.viewTutors }),
    );
    const table = screen.getByRole("table", {
      name: en.admin.tutees.viewTutors,
    });
    expectTrailingActions(table);
    expect(within(table).queryByText("Second Tutee")).toBeNull();
    expect(within(table).getByText(en.scheduling.awaiting)).toBeTruthy();
    fireEvent.click(
      within(table).getByRole("button", {
        name: new RegExp(`^${en.tablePatterns.details}:`),
      }),
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Second Tutee")).toBeTruthy();
    expect(dialog.getByText("Long afternoon slot description")).toBeTruthy();
    expect(dialog.getByText(en.scheduling.awaiting)).toBeTruthy();
  });

  it("leaves tutee summary details available in read-only mode without exposing mutations or contact", () => {
    state.readOnly = true;
    render(<TuteesPage />, { wrapper });
    const table = screen.getByRole("table");
    expectTrailingActions(table);
    expect(
      within(table).queryByRole("button", {
        name: en.accountProfile.editProfile,
      }),
    ).toBeNull();
    expect(
      within(table).queryByRole("button", { name: en.admin.tutees.deleteBtn }),
    ).toBeNull();
    expect(
      within(table).queryByRole("button", {
        name: en.accountProfile.showEmail,
      }),
    ).toBeNull();
    fireEvent.click(
      within(table).getByRole("button", {
        name: `${en.tablePatterns.details}: Synthetic Tutee · ${en.admin.tutees.colCourses}`,
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Advanced comparative mathematics course",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("tutee@example.test")).toBeNull();
    expect(
      within(table).queryByRole("button", { name: en.tuteeHistory.details }),
    ).toBeNull();
    expect(state.deleteTutee).not.toHaveBeenCalled();
  });

  it("keeps Crew summary concise and confirms its named membership action", async () => {
    const { rerender } = render(<CrewPage />, { wrapper });
    const table = screen.getByRole("table", {
      name: en.admin.crew.rosterHeading,
    });
    expectTrailingActions(table);
    expect(within(table).queryByText(en.admin.crew.crewOnly)).toBeNull();
    fireEvent.click(
      within(table).getByRole("button", { name: en.admin.crew.softRemove }),
    );
    expect(state.crewStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain("Synthetic Crew");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.crewStatus).not.toHaveBeenCalled();
    fireEvent.click(
      within(table).getByRole("button", { name: en.admin.crew.softRemove }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: en.admin.crew.softRemove,
      }),
    );
    await waitFor(() =>
      expect(state.crewStatus).toHaveBeenCalledWith({
        userId: "crew",
        status: "INACTIVE",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Change applied",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(
      within(table).getByRole("button", {
        name: `${en.tablePatterns.details}: Synthetic Crew`,
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(en.admin.crew.crewOnly),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: en.tablePatterns.close }),
    );
    state.readOnly = true;
    rerender(<CrewPage />);
    expect(
      within(table).queryByRole("button", { name: en.admin.crew.softRemove }),
    ).toBeNull();
    expect(
      within(table).queryByRole("button", { name: en.admin.crew.delete }),
    ).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import TutorDashboard from "./page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  me: vi.fn(),
  total: vi.fn(),
  crew: vi.fn(),
  rooms: vi.fn(),
  features: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("~/trpc/server", () => ({
  api: {
    tutor: {
      me: mocks.me,
      myMonthlyTotal: mocks.total,
      myCrew: mocks.crew,
      schedule: mocks.rooms,
    },
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/app/_components/school-departure", () => ({
  DepartureBanner: () => null,
}));
vi.mock("~/app/_components/policy-consent", () => ({
  PolicyConsent: () => null,
}));
vi.mock("~/app/_components/session-view-state", () => ({
  SessionPagePosition: () => null,
}));
vi.mock("~/app/_components/tutor-workload-preference", () => ({
  TutorWorkloadPreference: () => null,
}));
vi.mock("~/app/_components/ui/disclosure-section", () => ({
  DisclosureSection: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("~/app/(tutor)/_components/announcements-banner", () => ({
  AnnouncementsBanner: () => null,
}));
vi.mock("~/app/(tutor)/_components/availability-editor", () => ({
  AvailabilityEditor: () => null,
}));
vi.mock("~/app/(tutor)/_components/tutor-pairings", () => ({
  TutorPairings: () => <p>Expanded pairings</p>,
}));
vi.mock("~/app/(tutor)/_components/my-interviews", () => ({
  MyInterviews: ({ audience }: { audience: string }) => (
    <p>Interview workspace: {audience}</p>
  ),
}));
vi.mock("~/app/(tutor)/_components/tutor-activation", () => ({
  TutorActivation: () => null,
}));
vi.mock("~/app/(tutor)/_components/tutor-discipline", () => ({
  TutorDiscipline: () => null,
}));
vi.mock("~/app/(tutor)/_components/qualification-requests", () => ({
  QualificationRequests: () => null,
}));
vi.mock("~/app/(tutor)/_components/subject-willingness", () => ({
  SubjectWillingness: () => null,
}));
vi.mock("~/app/(tutor)/_components/dashboard-tasks", () => ({
  DashboardTasks: () => <p>Task preview</p>,
}));
vi.mock("~/app/(tutor)/_components/dashboard-schedule-links", () => ({
  DashboardScheduleLinks: () => <p>Schedule continuation</p>,
}));
vi.mock("~/app/(tutor)/_components/tutor-room-schedule", () => ({
  TutorRoomSchedule: () => <p>Read-only room grid</p>,
}));
vi.mock("~/app/_components/program-calendar", () => ({
  ProgramCalendarNotice: () => <p>Program calendar notice</p>,
}));
vi.mock("~/app/_components/school-calendar-notice", () => ({
  SchoolCalendarNotice: () => <p>School calendar notice</p>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: "tutor-login", name: "Synthetic Tutor" },
    tutorId: "tutor",
  });
  mocks.me.mockResolvedValue({ status: "ACTIVE" });
  mocks.total.mockResolvedValue({
    periodLabel: "Synthetic quarter",
    total: 0,
    earned: 0,
    extras: 0,
    punishments: 0,
  });
  mocks.crew.mockResolvedValue({ isCrew: false });
  mocks.features.mockResolvedValue({ INTERVIEWS: true, MEETINGS: true });
});
afterEach(cleanup);

it("keeps Pairings expanded before its task preview and retains the chair workspace", async () => {
  render(await TutorDashboard());
  const pairings = screen.getByText("Expanded pairings");
  expect(pairings.closest("#tutor-pairings")).toBeTruthy();
  expect(pairings.closest("details")).toBeNull();
  expect(
    pairings.compareDocumentPosition(screen.getByText("Task preview")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("Interview workspace: chair")).toBeTruthy();
  expect(screen.getByText("Schedule continuation")).toBeTruthy();
  expect(mocks.rooms).not.toHaveBeenCalled();
  for (const label of [
    "Read-only room grid",
    "Program calendar notice",
    "School calendar notice",
  ])
    expect(screen.queryByText(label)).toBeNull();
});

it.each([
  [null, "/signin"],
  [{ user: { id: "manager" } }, "/admin"],
])(
  "guards the dashboard before participant reads for %j",
  async (session, destination) => {
    mocks.auth.mockResolvedValue(session);
    await expect(TutorDashboard()).rejects.toThrow(`redirect:${destination}`);
    expect(mocks.me).not.toHaveBeenCalled();
    expect(mocks.rooms).not.toHaveBeenCalled();
  },
);

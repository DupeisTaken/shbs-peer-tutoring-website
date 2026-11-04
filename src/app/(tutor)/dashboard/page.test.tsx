// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import TutorDashboard from "./page";
import messages from "../../../../messages/en.json";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  me: vi.fn(),
  total: vi.fn(),
  crew: vi.fn(),
  rooms: vi.fn(),
  features: vi.fn(),
  schedule: vi.fn(),
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
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: catalog } = await import("../../../../messages/en.json");
  return {
    getTranslations: async () =>
      createTranslator({ locale: "en", messages: catalog }),
  };
});
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
vi.mock("~/app/(tutor)/_components/tutor-workspace", () => ({
  TutorWorkspace: ({
    attention,
    schedule,
    pairings,
    preferences,
    history,
  }: Record<string, ReactNode>) => (
    <>
      {attention}
      {schedule}
      {pairings}
      {preferences}
      {history}
    </>
  ),
}));
vi.mock("~/app/(tutor)/_components/tutor-schedule", () => ({
  TutorSchedule: (props: unknown) => {
    mocks.schedule(props);
    return <p>Schedule content</p>;
  },
}));
vi.mock("~/app/history/personal-tutor-history", () => ({
  PersonalTutorHistory: () => <p>Personal tutor history</p>,
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

it.each(["ACTIVE", "PENDING", "OPTED_OUT", "GRADUATED", "ARCHIVED"])(
  "composes the workspace with %s access and retained feature owners",
  async (status) => {
    mocks.me.mockResolvedValue({ status });
    render(await TutorDashboard());
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        active: status === "ACTIVE",
        interviewsEnabled: true,
        meetingsEnabled: true,
        compact: true,
      }),
    );
    expect(
      screen.getByText("Expanded pairings").closest("#tutor-pairings"),
    ).toBeTruthy();
    expect(
      screen
        .getByText("Task preview")
        .compareDocumentPosition(screen.getByText("Schedule content")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(!!screen.queryByText("Interview workspace: chair")).toBe(
      status === "ACTIVE",
    );
    expect(screen.getByText("Personal tutor history")).toBeTruthy();
    expect(mocks.rooms).toHaveBeenCalledOnce();
    expect(screen.getByText("Read-only room grid")).toBeTruthy();
    expect(screen.getByText("School calendar notice")).toBeTruthy();
  },
);

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

it.each([
  { total: 0, earned: 0, extras: 0, punishments: 0 },
  { total: 13.8, earned: 11, extras: 2.8, punishments: 0 },
  { total: 10.3, earned: 11, extras: 2.8, punishments: 3.5 },
  { total: -1.5, earned: 0, extras: 0.5, punishments: 2 },
])(
  "shows the supplied service-hours total and separate breakdown for %j",
  async (hours) => {
    mocks.features.mockResolvedValue({ SERVICE_HOURS: true });
    mocks.total.mockResolvedValue({
      ...hours,
      periodLabel: "Synthetic quarter",
    });
    render(await TutorDashboard());

    const summary = within(
      screen.getByRole("region", { name: messages.dashboard.hours.title }),
    );
    expect(summary.getByText("Synthetic quarter")).toBeTruthy();
    expect(
      summary.getByText(
        (_, element) =>
          element?.textContent === `${hours.total.toFixed(1)} h` &&
          ![...element.children].some(
            (child) => child.textContent === `${hours.total.toFixed(1)} h`,
          ),
      ),
    ).toBeTruthy();
    const breakdown = within(summary.getByRole("list"));
    expect(
      breakdown.getByText(`${hours.earned.toFixed(1)} Earned`),
    ).toBeTruthy();
    expect(!!breakdown.queryByText(`+ ${hours.extras.toFixed(1)} Extras`)).toBe(
      hours.extras > 0,
    );
    expect(
      !!breakdown.queryByText(`− ${hours.punishments.toFixed(1)} Penalties`),
    ).toBe(hours.punishments > 0);
    expect(breakdown.getAllByRole("listitem")).toHaveLength(
      1 + Number(hours.extras > 0) + Number(hours.punishments > 0),
    );
  },
);

it("keeps zero hours visible without inventing a missing reporting period", async () => {
  mocks.features.mockResolvedValue({ SERVICE_HOURS: true });
  mocks.total.mockResolvedValue({
    periodLabel: null,
    total: 0,
    earned: 0,
    extras: 0,
    punishments: 0,
  });
  render(await TutorDashboard());
  const summary = screen.getByRole("region", {
    name: messages.dashboard.hours.title,
  });
  expect(within(summary).getByText("0.0 Earned")).toBeTruthy();
  expect(summary.textContent).not.toMatch(/Synthetic quarter|null|undefined|·/);
});

it.each([
  { service: false, crew: false, member: true },
  { service: true, crew: false, member: true },
  { service: false, crew: true, member: true },
  { service: true, crew: true, member: false },
  { service: true, crew: true, member: true },
])(
  "keeps service and Crew summaries independently gated for %j",
  async ({ service, crew, member }) => {
    mocks.features.mockResolvedValue({ SERVICE_HOURS: service, CREW: crew });
    mocks.crew.mockResolvedValue({ isCrew: member, hours: 4.5, patrols: 9 });
    render(await TutorDashboard());
    expect(
      !!screen.queryByRole("region", { name: messages.dashboard.hours.title }),
    ).toBe(service);
    expect(!!screen.queryByText(messages.tutor.dashboard.crew.title)).toBe(
      crew && member,
    );
    expect(!!screen.queryByText("9 patrols")).toBe(crew && member);
    expect(!!screen.queryByText("4.5", { exact: false })).toBe(crew && member);
  },
);

// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TutorSchedulePage from "./page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  me: vi.fn(),
  features: vi.fn(),
  schedule: vi.fn(),
  rooms: vi.fn(),
  roomGrid: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("~/trpc/server", () => ({
  api: { tutor: { me: mocks.me, schedule: mocks.rooms } },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/app/_components/policy-consent", () => ({
  PolicyConsent: () => null,
}));
vi.mock("~/app/_components/school-departure", () => ({
  DepartureBanner: () => null,
}));
vi.mock("~/app/_components/program-calendar", () => ({
  ProgramCalendarNotice: () => <p>Program calendar notice</p>,
}));
vi.mock("~/app/_components/school-calendar-notice", () => ({
  SchoolCalendarNotice: () => <p>School calendar notice</p>,
}));
vi.mock("~/app/(tutor)/_components/tutor-room-schedule", () => ({
  TutorRoomSchedule: (props: { initialData: unknown }) => {
    mocks.roomGrid(props);
    return <p>Read-only room grid</p>;
  },
}));
vi.mock("~/app/(tutor)/_components/tutor-schedule", () => ({
  TutorSchedule: (props: unknown) => {
    mocks.schedule(props);
    return <p>Schedule content</p>;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: "tutor-login" },
    tutorId: "tutor",
  });
  mocks.me.mockResolvedValue({ status: "ACTIVE" });
  mocks.rooms.mockResolvedValue({ myTutorId: "tutor", rooms: [] });
  mocks.features.mockResolvedValue({ INTERVIEWS: true, MEETINGS: false });
});
afterEach(cleanup);

it.each([
  [null, "/signin"],
  [{ user: { id: "manager" } }, "/admin"],
])(
  "guards the schedule before self-scoped reads for %j",
  async (session, destination) => {
    mocks.auth.mockResolvedValue(session);
    await expect(TutorSchedulePage()).rejects.toThrow(
      `redirect:${destination}`,
    );
    expect(mocks.me).not.toHaveBeenCalled();
    expect(mocks.features).not.toHaveBeenCalled();
    expect(mocks.rooms).not.toHaveBeenCalled();
  },
);

it.each(["ACTIVE", "PENDING", "OPTED_OUT", "GRADUATED", "ARCHIVED"])(
  "preserves %s membership and module gates",
  async (status) => {
    mocks.me.mockResolvedValue({ status });
    render(await TutorSchedulePage());
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        active: status === "ACTIVE",
        interviewsEnabled: true,
        meetingsEnabled: false,
      }),
    );
    expect(
      screen
        .getByRole("link", { name: "tutor.schedulePage.backToPairings" })
        .getAttribute("href"),
    ).toBe("/dashboard#tutor-pairings");
    expect(
      screen
        .getByRole("link", { name: "tutor.schedulePage.preferences" })
        .getAttribute("href"),
    ).toBe("/dashboard#tutor-preferences");
    expect(
      screen
        .getByRole("link", { name: "tutor.schedulePage.rooms" })
        .getAttribute("href"),
    ).toBe("#room-schedule");
    expect(
      !!screen.queryByRole("link", { name: "tutor.tasks.activation" }),
    ).toBe(status === "PENDING");
  },
);

it("hydrates the authorized read-only room grid below the personal agenda with its calendar notices", async () => {
  const projection = {
    myTutorId: "owned-tutor",
    rooms: [{ id: "synthetic-room" }],
  };
  mocks.rooms.mockResolvedValue(projection);
  render(await TutorSchedulePage());
  expect(mocks.rooms).toHaveBeenCalledOnce();
  expect(mocks.roomGrid).toHaveBeenCalledWith({ initialData: projection });
  const rooms = document.getElementById("room-schedule")!;
  expect(rooms.tabIndex).toBe(-1);
  expect(
    within(rooms).getByRole("heading", { name: "dashboard.schedule.title" }),
  ).toBeTruthy();
  expect(within(rooms).getByText("Program calendar notice")).toBeTruthy();
  expect(within(rooms).getByText("School calendar notice")).toBeTruthy();
  expect(within(rooms).getByText("Read-only room grid")).toBeTruthy();
  expect(
    screen.getByText("Schedule content").compareDocumentPosition(rooms) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

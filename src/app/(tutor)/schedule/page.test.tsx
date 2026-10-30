// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TutorSchedulePage from "./page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  me: vi.fn(),
  features: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("~/trpc/server", () => ({ api: { tutor: { me: mocks.me } } }));
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
    ).toBe("/dashboard#room-schedule");
    expect(
      !!screen.queryByRole("link", { name: "tutor.tasks.activation" }),
    ).toBe(status === "PENDING");
  },
);

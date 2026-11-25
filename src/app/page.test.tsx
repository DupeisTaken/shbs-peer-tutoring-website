import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type * as SignedInHeaderModule from "~/app/_components/signed-in-workspace-header";
import type { SignedInLinkMap } from "~/lib/signed-in-landing-links";
import Home from "./page";

type LandingViewProps = {
  signedInHeader?: unknown;
  signedInLinks?: SignedInLinkMap;
};

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  account: vi.fn(),
  features: vi.fn(),
  landingView: vi.fn((_props: LandingViewProps) => null),
  renderHeader: vi.fn((_opts: unknown) => "signed-in-header"),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: mocks.account } } }));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { has: () => true }),
}));
vi.mock("~/app/_components/landing-view", () => ({
  LandingView: mocks.landingView,
}));
vi.mock("~/app/_components/signed-in-workspace-header", async (importOriginal) => {
  const actual = await importOriginal<typeof SignedInHeaderModule>();
  return {
    ...actual,
    renderSignedInWorkspaceHeader: mocks.renderHeader,
  };
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const baseAccount = {
  name: "Synthetic User",
  email: "user@example.test",
  username: "user",
  role: "STUDENT",
  suspendedAt: null,
  mergedIntoId: null,
  studentId: null,
  tuteeMember: false,
  crewStatus: null,
  tutorAccessRevoked: false,
  canTranslate: false,
  schoolDeparture: null,
  tutor: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.features.mockResolvedValue({ CREW: true });
  mocks.account.mockResolvedValue({ ...baseAccount });
});

it("renders public Program Home for signed-out visitors without querying private account records", async () => {
  mocks.auth.mockResolvedValue(null);
  const el = await Home();
  expect(el.props).toEqual({});
  expect(mocks.account).not.toHaveBeenCalled();
});

it.each([
  "TUTOR",
  "ADMIN",
  "HEAD",
  "COORDINATOR",
  "VIEWER",
  "CREW",
  "STUDENT",
] as const)(
  "defaults to Program Home (not redirecting) for active signed-in %s accounts",
  async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "synthetic" }, role });
    mocks.account.mockResolvedValue({
      ...baseAccount,
      role,
      tutor: role === "TUTOR" ? { username: "t", status: "ACTIVE" } : null,
      tuteeMember: role === "STUDENT",
      crewStatus: role === "CREW" ? "ACTIVE" : null,
    });

    const el = (await Home()) as ReactElement<LandingViewProps>;
    expect(el.props.signedInHeader).toBe("signed-in-header");
    expect(mocks.renderHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "/",
        currentArea: "home",
      }),
    );

    const links = el.props.signedInLinks!;
    if (role === "TUTOR") {
      expect(links.byPath["/tutor"]).toEqual({
        href: "/dashboard",
        label: "components.userMenu.enterTutor",
      });
      expect(links.byPath["/tutee"]).toBeUndefined();
    } else if (role === "STUDENT") {
      expect(links.byPath["/tutee"]).toEqual({
        href: "/student",
        label: "components.userMenu.enterTutee",
      });
      expect(links.byPath["/tutor"]).toBeUndefined();
    } else if (role === "CREW") {
      expect(links.byPath["/crew"]).toEqual({
        href: "/patrol",
        label: "components.userMenu.enterCrew",
      });
    } else if (role === "VIEWER") {
      expect(links.byPath["/viewer"]).toEqual({
        href: "/admin",
        label: "components.userMenu.enterOverview",
      });
    } else {
      expect(links.byPath["/viewer"]).toEqual({
        href: "/admin",
        label: "components.userMenu.enterAdmin",
      });
    }
  },
);

it("still routes suspended accounts directly to /suspended", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "synthetic" },
    role: "TUTOR",
    tutorId: null,
  });
  mocks.account.mockResolvedValue({
    ...baseAccount,
    role: "TUTOR",
    suspendedAt: new Date(),
  });
  await expect(Home()).rejects.toThrow("redirect:/suspended");
});

it("replaces both tutor and tutee links when an account holds both roles", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "dual" }, role: "TUTOR" });
  mocks.account.mockResolvedValue({
    ...baseAccount,
    role: "TUTOR",
    tutor: { username: "dual", status: "ACTIVE" },
    tuteeMember: true,
  });
  const el = (await Home()) as ReactElement<LandingViewProps>;
  const links = el.props.signedInLinks!;
  expect(links.byPath["/tutor"]).toEqual({
    href: "/dashboard",
    label: "components.userMenu.enterTutor",
  });
  expect(links.byPath["/tutee"]).toEqual({
    href: "/student",
    label: "components.userMenu.enterTutee",
  });
});

it("preserves independent tutee entry for a former tutor whose tutor link was revoked", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "former" }, role: "TUTOR" });
  mocks.account.mockResolvedValue({
    ...baseAccount,
    role: "TUTOR",
    tutor: { username: "former", status: "ACTIVE" },
    tutorAccessRevoked: true,
    studentId: "independent-tutee",
    tuteeMember: false,
  });
  const el = (await Home()) as ReactElement<LandingViewProps>;
  const links = el.props.signedInLinks!;
  expect(links.byPath["/tutor"]).toBeUndefined();
  expect(links.byPath["/tutee"]).toEqual({
    href: "/student",
    label: "components.userMenu.enterTutee",
  });
});

it("omits /crew replacement when the crew module is disabled", async () => {
  mocks.features.mockResolvedValue({ CREW: false });
  mocks.auth.mockResolvedValue({ user: { id: "crew" }, role: "CREW" });
  mocks.account.mockResolvedValue({
    ...baseAccount,
    role: "CREW",
    crewStatus: "ACTIVE",
  });
  const el = (await Home()) as ReactElement<LandingViewProps>;
  const links = el.props.signedInLinks!;
  expect(links.byPath["/crew"]).toBeUndefined();
});

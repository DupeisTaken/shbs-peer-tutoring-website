import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";
import type * as SignedInHeaderModule from "~/app/_components/signed-in-header";
import type { SignedInLinkMap } from "~/lib/signed-in-landing-links";

type LandingViewProps = {
  signedInLinks?: SignedInLinkMap;
};

const state = vi.hoisted(() => ({
  studentId: null as string | null,
  tuteeMember: false,
}));
vi.mock("~/server/auth", () => ({
  auth: async () => ({ user: { id: "alumni" }, role: "STUDENT" }),
}));
vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: async () => ({
        name: "Alumni",
        email: "alumni@example.test",
        username: "alumni",
        role: "STUDENT",
        suspendedAt: null,
        mergedIntoId: null,
        crewStatus: null,
        tutorAccessRevoked: false,
        canTranslate: false,
        schoolDeparture: null,
        tutor: null,
        ...state,
      }),
    },
  },
}));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ CREW: false }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { has: () => true }),
}));
vi.mock("~/app/_components/landing-view", () => ({
  LandingView: () => null,
}));
vi.mock("~/app/_components/signed-in-header", async (importOriginal) => {
  const actual = await importOriginal<typeof SignedInHeaderModule>();
  return {
    ...actual,
    renderSignedInWorkspaceHeader: () => null,
  };
});
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(destination);
  },
}));
import Home from "../page";

it.each([
  [null, false, undefined],
  ["current", false, "/student"],
  [null, true, "/student"],
] as const)(
  "lands on Program Home and maps /tutee for studentId=%s membership=%s to %s",
  async (studentId, tuteeMember, expectedTuteeHref) => {
    Object.assign(state, { studentId, tuteeMember });
    const el = (await Home()) as ReactElement<LandingViewProps>;
    const links = el.props.signedInLinks!;
    expect(links.byPath["/tutee"]?.href).toBe(expectedTuteeHref);
  },
);

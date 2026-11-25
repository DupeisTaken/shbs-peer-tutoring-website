import { describe, expect, it } from "vitest";

import {
  resolveSignedInLandingLinks,
  resolveSignedInLink,
  type SignedInLandingLinkLabels,
} from "./signed-in-landing-links";

const labels: SignedInLandingLinkLabels = {
  enterTutor: "Enter Tutor Page",
  enterTutee: "Enter Tutee Page",
  enterCrew: "Enter Crew Page",
  enterAdmin: "Enter Admin Area",
  enterOverview: "Enter Program Overview",
  enterTranslations: "Enter Translations",
};

describe("resolveSignedInLandingLinks", () => {
  it("returns no replacements for signed-out, suspended, or merged accounts", () => {
    expect(
      resolveSignedInLandingLinks({
        account: null,
        crewEnabled: true,
        labels,
      }).byPath,
    ).toEqual({});
    expect(
      resolveSignedInLandingLinks({
        account: {
          role: "TUTOR",
          tutor: { status: "ACTIVE" },
          tuteeMember: true,
          suspendedAt: new Date(),
        },
        crewEnabled: true,
        labels,
      }).byPath,
    ).toEqual({});
    expect(
      resolveSignedInLandingLinks({
        account: {
          role: "STUDENT",
          tuteeMember: true,
          mergedIntoId: "survivor",
        },
        crewEnabled: true,
        labels,
      }).byPath,
    ).toEqual({});
  });

  it("replaces tutor links for active tutors while keeping tutee signup available when not yet a tutee", () => {
    const map = resolveSignedInLandingLinks({
      account: {
        role: "TUTOR",
        tutor: { status: "ACTIVE" },
        tuteeMember: false,
        studentId: null,
      },
      crewEnabled: true,
      labels,
    });
    expect(resolveSignedInLink("/tutor", map)).toEqual({
      href: "/dashboard",
      label: "Enter Tutor Page",
    });
    expect(resolveSignedInLink("/tutor-signup?ref=hero#apply", map)).toEqual({
      href: "/dashboard",
      label: "Enter Tutor Page",
    });
    expect(resolveSignedInLink("/tutee", map)).toBeNull();
    expect(resolveSignedInLink("/signin", map)).toEqual({
      href: "/dashboard",
      label: "Enter Tutor Page",
    });
  });

  it("replaces tutee links for tutee members and dual tutor+tutee accounts", () => {
    const pureTutee = resolveSignedInLandingLinks({
      account: { role: "STUDENT", tuteeMember: true, tutor: null },
      crewEnabled: true,
      labels,
    });
    expect(resolveSignedInLink("/tutee", pureTutee)).toEqual({
      href: "/student",
      label: "Enter Tutee Page",
    });
    expect(resolveSignedInLink("/tutee-signup?source=cta", pureTutee)).toEqual({
      href: "/student",
      label: "Enter Tutee Page",
    });
    expect(resolveSignedInLink("/signup", pureTutee)).toEqual({
      href: "/student",
      label: "Enter Tutee Page",
    });
    expect(resolveSignedInLink("/tutor", pureTutee)).toBeNull();

    const dual = resolveSignedInLandingLinks({
      account: {
        role: "TUTOR",
        tutor: { status: "ACTIVE" },
        tuteeMember: true,
      },
      crewEnabled: true,
      labels,
    });
    expect(resolveSignedInLink("/tutee", dual)).toEqual({
      href: "/student",
      label: "Enter Tutee Page",
    });
    expect(resolveSignedInLink("/tutor", dual)).toEqual({
      href: "/dashboard",
      label: "Enter Tutor Page",
    });
  });

  it("gates crew links on CREW feature and active crew membership", () => {
    const enabled = resolveSignedInLandingLinks({
      account: { role: "CREW", crewStatus: "ACTIVE" },
      crewEnabled: true,
      labels,
    });
    expect(resolveSignedInLink("/crew", enabled)).toEqual({
      href: "/patrol",
      label: "Enter Crew Page",
    });
    expect(resolveSignedInLink("/crew-signup", enabled)).toEqual({
      href: "/patrol",
      label: "Enter Crew Page",
    });
    expect(resolveSignedInLink("/signin", enabled)).toEqual({
      href: "/patrol",
      label: "Enter Crew Page",
    });

    const disabled = resolveSignedInLandingLinks({
      account: { role: "CREW", crewStatus: "ACTIVE" },
      crewEnabled: false,
      labels,
    });
    expect(resolveSignedInLink("/crew", disabled)).toBeNull();
  });

  it("maps viewer and management links accurately without leaking restricted areas", () => {
    const viewer = resolveSignedInLandingLinks({
      account: { role: "VIEWER", tutor: null, tuteeMember: false },
      crewEnabled: true,
      labels,
    });
    expect(resolveSignedInLink("/viewer", viewer)).toEqual({
      href: "/admin",
      label: "Enter Program Overview",
    });
    expect(resolveSignedInLink("/viewer-signup", viewer)).toEqual({
      href: "/admin",
      label: "Enter Program Overview",
    });
    expect(resolveSignedInLink("/signin", viewer)).toEqual({
      href: "/admin",
      label: "Enter Program Overview",
    });
    expect(resolveSignedInLink("/tutee", viewer)).toBeNull();
    expect(resolveSignedInLink("/tutor", viewer)).toBeNull();

    const adminWithArchivedTutor = resolveSignedInLandingLinks({
      account: {
        role: "ADMIN",
        tutor: { status: "ARCHIVED" },
        tuteeMember: false,
      },
      crewEnabled: true,
      labels,
    });
    expect(resolveSignedInLink("/viewer", adminWithArchivedTutor)).toEqual({
      href: "/admin",
      label: "Enter Admin Area",
    });
    expect(resolveSignedInLink("/signin", adminWithArchivedTutor)).toEqual({
      href: "/admin",
      label: "Enter Admin Area",
    });
    expect(resolveSignedInLink("/tutor", adminWithArchivedTutor)).toBeNull();
  });

  it("never rewrites revoked tutors, invitation redemption, or external URLs", () => {
    const revoked = resolveSignedInLandingLinks({
      account: {
        role: "TUTOR",
        tutor: { status: "ACTIVE" },
        tutorAccessRevoked: true,
      },
      crewEnabled: true,
      labels,
    });
    expect(resolveSignedInLink("/tutor", revoked)).toBeNull();
    expect(resolveSignedInLink("/register", revoked)).toBeNull();
    expect(resolveSignedInLink("/register-account", revoked)).toBeNull();
    expect(resolveSignedInLink("https://pt.shbs.org.cn/tutor", revoked)).toBeNull();
    expect(resolveSignedInLink("//evil.example/tutor", revoked)).toBeNull();
  });
});

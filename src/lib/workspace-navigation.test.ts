import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceNavigation,
  type WorkspaceNavLabels,
} from "./workspace-navigation";

const labels: WorkspaceNavLabels = {
  management: "Management",
  viewer: "Program Overview",
  tutor: "Tutor",
  tutee: "Tutee",
  crew: "Crew",
  translations: "Translations",
  programHome: "Program Home",
  helpCenter: "Help Center",
};

describe("resolveWorkspaceNavigation", () => {
  it("uses Management for staff and omits the active area from the menu", () => {
    const res = resolveWorkspaceNavigation({
      account: {
        role: "ADMIN",
        crewStatus: "ACTIVE",
        canTranslate: true,
        tutor: { status: "ACTIVE" },
      },
      crewEnabled: true,
      currentArea: "management",
      labels,
    });
    expect(res.managementLabel).toBe("Management");
    expect(res.items.map((i) => `${i.id}:${i.label}`)).toEqual([
      "tutor:Tutor",
      "tutee:Tutee",
      "crew:Crew",
      "translations:Translations",
      "home:Program Home",
      "help:Help Center",
    ]);
  });

  it("uses Program Overview for Viewers and never leaks Management, Tutor, Tutee, Crew, or Translations", () => {
    const onOverview = resolveWorkspaceNavigation({
      account: { role: "VIEWER", tutor: null, canTranslate: false },
      crewEnabled: true,
      currentArea: "management",
      labels,
    });
    expect(onOverview.managementLabel).toBe("Program Overview");
    expect(onOverview.items.map((i) => `${i.id}:${i.label}`)).toEqual([
      "home:Program Home",
      "help:Help Center",
    ]);

    const onHelp = resolveWorkspaceNavigation({
      account: { role: "VIEWER", tutor: null, canTranslate: false },
      crewEnabled: true,
      currentArea: "help",
      labels,
    });
    expect(onHelp.items.map((i) => `${i.id}:${i.label}`)).toEqual([
      "management:Program Overview",
      "home:Program Home",
    ]);
  });

  it("uses Program Overview for departed alumni observers while preserving tutee history access", () => {
    const res = resolveWorkspaceNavigation({
      account: {
        role: "STUDENT",
        tutor: null,
        schoolDeparture: {
          reason: "GRADUATED",
          observerRevoked: false,
          tutorDerived: false,
        },
      },
      crewEnabled: true,
      currentArea: "tutee",
      labels,
    });
    expect(res.managementLabel).toBe("Program Overview");
    expect(res.items.map((i) => `${i.id}:${i.label}`)).toEqual([
      "management:Program Overview",
      "home:Program Home",
      "help:Help Center",
    ]);
  });

  it("never leaks unauthorized workspaces to pure student/tutee accounts", () => {
    const res = resolveWorkspaceNavigation({
      account: { role: "STUDENT", tutor: null, crewStatus: null, canTranslate: false },
      crewEnabled: true,
      currentArea: "tutee",
      labels,
    });
    expect(res.items.map((i) => i.id)).toEqual(["home", "help"]);
  });

  it("hides Help Center when already on Help Center and Program Home when already on Program Home", () => {
    const onHelp = resolveWorkspaceNavigation({
      account: { role: "TUTOR", tutor: { status: "ACTIVE" } },
      crewEnabled: false,
      currentArea: "help",
      labels,
    });
    expect(onHelp.items.map((i) => i.id)).toEqual(["tutor", "tutee", "home"]);

    const onHome = resolveWorkspaceNavigation({
      account: { role: "TUTOR", tutor: { status: "ACTIVE" } },
      crewEnabled: false,
      currentArea: "home",
      labels,
    });
    expect(onHome.items.map((i) => i.id)).toEqual(["tutor", "tutee", "help"]);
    expect(onHelp.items.find((i) => i.id === "home")?.href).toBe("/");
  });

  it("keeps signup forms out of the workspace switcher selection even when currentArea is null", () => {
    const res = resolveWorkspaceNavigation({
      account: {
        role: "HEAD",
        crewStatus: "ACTIVE",
        canTranslate: true,
        tutor: { status: "ACTIVE" },
      },
      crewEnabled: true,
      currentArea: null,
      labels,
    });
    expect(res.items.map((i) => i.id)).toEqual([
      "management",
      "tutor",
      "tutee",
      "crew",
      "translations",
      "home",
      "help",
    ]);
    expect(res.items.some((i) => i.href.includes("signup"))).toBe(false);
  });

  it("gates Crew on the CREW feature flag and hides archived/revoked tutor links", () => {
    const crewDisabled = resolveWorkspaceNavigation({
      account: { role: "CREW", crewStatus: "ACTIVE" },
      crewEnabled: false,
      currentArea: "tutee",
      labels,
    });
    expect(crewDisabled.items.some((i) => i.id === "crew")).toBe(false);

    const archivedAdminTutor = resolveWorkspaceNavigation({
      account: { role: "HEAD", tutor: { status: "ARCHIVED" } },
      crewEnabled: true,
      currentArea: "management",
      labels,
    });
    expect(archivedAdminTutor.items.some((i) => i.id === "tutor")).toBe(false);

    const revokedTutor = resolveWorkspaceNavigation({
      account: { role: "TUTOR", tutor: { status: "ACTIVE" }, tutorAccessRevoked: true },
      crewEnabled: true,
      currentArea: "tutee",
      labels,
    });
    expect(revokedTutor.items.some((i) => i.id === "tutor")).toBe(false);
  });

  it("returns no switcher destinations for suspended or merged accounts", () => {
    const suspended = resolveWorkspaceNavigation({
      account: { role: "HEAD", suspendedAt: new Date() },
      crewEnabled: true,
      currentArea: "help",
      labels,
    });
    expect(suspended.items).toEqual([]);
  });

  it("includes Translations in the switcher for management reviewers without canTranslate, and never for Viewers", () => {
    for (const role of ["HEAD", "ADMIN", "COORDINATOR"] as const) {
      const res = resolveWorkspaceNavigation({
        account: { role, canTranslate: false },
        crewEnabled: false,
        currentArea: "management",
        labels,
      });
      expect(res.items.map((i) => i.id)).toContain("translations");
    }

    const onTranslations = resolveWorkspaceNavigation({
      account: { role: "ADMIN", canTranslate: false },
      crewEnabled: false,
      currentArea: "translations",
      labels,
    });
    expect(onTranslations.items.map((i) => i.id)).not.toContain("translations");
    expect(onTranslations.items.map((i) => i.id)).toContain("management");

    const viewer = resolveWorkspaceNavigation({
      account: { role: "VIEWER", canTranslate: true },
      crewEnabled: false,
      currentArea: "management",
      labels,
    });
    expect(viewer.items.map((i) => i.id)).not.toContain("translations");
  });
});

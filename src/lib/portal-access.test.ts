import { expect, it } from "vitest";
import { portalAccess } from "./portal-access";

it.each(["GRADUATED", "TRANSFERRED"])(
  "grants masked observation for confirmed %s",
  (reason) => {
    const result = portalAccess({
      role: "STUDENT",
      schoolDeparture: { reason, observerRevoked: false, tutorDerived: false },
    });
    expect(result).toMatchObject({
      canReadManagement: true,
      managementReadOnly: true,
      maskManagementData: true,
      canParticipate: false,
    });
  },
);
it.each(["TUTOR", "STUDENT", "CREW"])(
  "does not infer a departure grant from %s",
  (role) => {
    expect(portalAccess({ role }).canReadManagement).toBe(false);
  },
);
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "preserves independent %s authority",
  (role) => {
    expect(
      portalAccess({
        role,
        schoolDeparture: {
          reason: "TRANSFERRED",
          observerRevoked: true,
          tutorDerived: true,
        },
      }),
    ).toMatchObject({
      canReadManagement: true,
      managementReadOnly: false,
      maskManagementData: false,
      canParticipate: false,
    });
  },
);
it("prioritizes suspension and observer/tutor revocation without misusing tutor revocation for tutees", () => {
  const account = {
    role: "TUTOR",
    schoolDeparture: {
      reason: "GRADUATED",
      observerRevoked: false,
      tutorDerived: true,
    },
  };
  expect(
    portalAccess({ ...account, suspendedAt: new Date() }).canReadManagement,
  ).toBe(false);
  expect(
    portalAccess({ ...account, mergedIntoId: "survivor" }).canReadManagement,
  ).toBe(false);
  expect(
    portalAccess({ ...account, tutorAccessRevoked: true }).canReadManagement,
  ).toBe(false);
  expect(
    portalAccess({
      ...account,
      schoolDeparture: { ...account.schoolDeparture, observerRevoked: true },
    }).canReadManagement,
  ).toBe(false);
  expect(
    portalAccess({
      ...account,
      tutorAccessRevoked: true,
      schoolDeparture: { ...account.schoolDeparture, tutorDerived: false },
    }).canReadManagement,
  ).toBe(true);
});

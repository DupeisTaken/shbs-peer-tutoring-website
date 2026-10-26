import { expect, it } from "vitest";
import {
  emptyUserFilters,
  isTutorStatusApplicable,
  matchesUserFilters,
  normalizeUserFilters,
  parseUserFilters,
  type UserFilterMember,
} from "./user-filters";
const admin = { role: "ADMIN", tutorStatus: "ACTIVE", account: "registered" };
const groupedArchive: UserFilterMember = {
  name: "Original archive",
  role: null,
  tutorId: "archive",
  tutorStatus: "ARCHIVED",
  account: "none",
  tuteeMember: false,
  tutorAccessRevoked: false,
};
const groupedCurrent: UserFilterMember = {
  name: "Current student",
  role: "STUDENT",
  tutorStatus: null,
  account: "none",
  currentTutee: true,
  tuteeMember: false,
};

it("keeps a grouped current enrollment visible behind an archived representative", () => {
  const group = {
    ...groupedArchive,
    directoryMembers: [groupedArchive, groupedCurrent],
  };
  expect(matchesUserFilters(group, emptyUserFilters())).toBe(true);
  expect(matchesUserFilters(group, emptyUserFilters(), "Current student")).toBe(
    true,
  );
  expect(
    matchesUserFilters(group, emptyUserFilters(), "Original archive"),
  ).toBe(false);
  expect(
    matchesUserFilters(
      group,
      { ...emptyUserFilters(), showPastTutors: true },
      "Original archive",
    ),
  ).toBe(true);
});

it("matches an independent active tutor without unioning the primary login's filter facts", () => {
  const primary: UserFilterMember = {
    name: "Primary student",
    role: "STUDENT",
    tutorStatus: null,
    account: "registered",
    tuteeMember: true,
  };
  const tutor: UserFilterMember = {
    name: "Active tutor",
    role: null,
    tutorStatus: "ACTIVE",
    tutorId: "active",
    tuteeMember: false,
    account: "none",
  };
  const group = { ...primary, directoryMembers: [primary, tutor] };
  const filters = emptyUserFilters();
  filters.role.include = ["TUTOR"];
  filters.status.include = ["ACTIVE"];
  expect(matchesUserFilters(group, filters)).toBe(true);
  expect(matchesUserFilters(group, filters, "Active tutor")).toBe(true);
  expect(matchesUserFilters(group, filters, "Primary student")).toBe(false);
  filters.account.include = ["registered"];
  expect(matchesUserFilters(group, filters)).toBe(false);
  filters.account.include = ["none"];
  expect(matchesUserFilters(group, filters)).toBe(true);
  filters.status.exclude = ["ACTIVE"];
  expect(matchesUserFilters(group, filters)).toBe(false);
  expect(group.role).toBe("STUDENT");
  expect(group.tutorId).toBeUndefined();
});

it("keeps a verified sibling discoverable while setup and search remain member-specific", () => {
  const pending: UserFilterMember = {
    ...admin,
    name: "Pending owner",
    userId: "pending",
    emailVerifiedAt: null,
    account: "setup",
  };
  const verified: UserFilterMember = {
    ...admin,
    name: "Verified sibling",
    userId: "verified",
    emailVerifiedAt: new Date(),
  };
  const group = { ...pending, directoryMembers: [pending, verified] };
  expect(matchesUserFilters(group, emptyUserFilters())).toBe(true);
  expect(matchesUserFilters(group, emptyUserFilters(), "Pending owner")).toBe(
    false,
  );
  expect(
    matchesUserFilters(group, emptyUserFilters(), "Verified sibling"),
  ).toBe(true);
  expect(
    matchesUserFilters(
      group,
      { ...emptyUserFilters(), showUnverified: true },
      "Pending owner",
    ),
  ).toBe(true);
});
it.each(["ACTIVE", "PENDING", "OPTED_OUT", "ARCHIVED", "GRADUATED", null])(
  "applies default past-tutor visibility to %s",
  (tutorStatus) => {
    const row = { ...admin, role: "TUTOR", tutorStatus };
    const past = tutorStatus === "ARCHIVED" || tutorStatus === "GRADUATED";
    expect(matchesUserFilters(row, emptyUserFilters())).toBe(!past);
    expect(
      matchesUserFilters(row, { ...emptyUserFilters(), showPastTutors: true }),
    ).toBe(true);
  },
);
it.each(["ARCHIVED", "GRADUATED"])(
  "finds explicit %s records despite historical membership",
  (tutorStatus) => {
    const filters = emptyUserFilters();
    filters.role.include = ["TUTOR"];
    filters.status.include = [tutorStatus];
    const row = {
      role: null,
      tutorStatus,
      tutorId: "past",
      tuteeMember: false,
      account: "none",
    };
    expect(matchesUserFilters(row, filters)).toBe(true);
    filters.status.exclude = [tutorStatus];
    expect(matchesUserFilters(row, filters)).toBe(false);
    filters.status.exclude = [];
    filters.account.exclude = ["none"];
    expect(matchesUserFilters(row, filters)).toBe(false);
  },
);
it("restores only boolean visibility preferences and defaults older preferences to hidden", () => {
  expect(parseUserFilters('{"showPastTutors":true}').showPastTutors).toBe(true);
  expect(parseUserFilters('{"showPastTutors":"true"}').showPastTutors).toBe(
    false,
  );
  expect(parseUserFilters("{}").showPastTutors).toBe(false);
});
it("combines OR within includes with AND across filters and exclusion priority", () => {
  const filters = emptyUserFilters();
  filters.role.include = ["ADMIN", "COORDINATOR"];
  expect(matchesUserFilters(admin, filters)).toBe(true);
  expect(matchesUserFilters({ ...admin, role: "COORDINATOR" }, filters)).toBe(
    true,
  );
  expect(matchesUserFilters({ ...admin, role: "TUTOR" }, filters)).toBe(false);
  filters.account.include = ["setup"];
  expect(matchesUserFilters(admin, filters)).toBe(false);
  filters.account.include = [];
  filters.role.exclude = ["ADMIN"];
  expect(matchesUserFilters(admin, filters)).toBe(false);
});
it("ignores hidden status even for null tutor links", () => {
  const filters = emptyUserFilters();
  filters.status.include = ["__none__"];
  expect(matchesUserFilters({ ...admin, tutorStatus: null }, filters)).toBe(
    true,
  );
  expect(matchesUserFilters(admin, filters)).toBe(true);
});

it.each([
  [[], [], false],
  [["ADMIN"], [], false],
  [["TUTOR"], [], true],
  [["TUTOR"], ["ADMIN"], true],
  [["TUTOR"], ["TUTOR"], false],
  [["TUTOR", "ADMIN"], [], false],
  [["TUTOR", "ADMIN"], ["ADMIN"], false],
  [[], ["ADMIN"], false],
  [[], ["TUTOR"], false],
  [["__none__"], [], false],
] as const)(
  "checks applicability for includes %j and excludes %j",
  (include, exclude, applicable) => {
    const filters = emptyUserFilters();
    filters.role = { include: [...include], exclude: [...exclude] };
    filters.status = { include: ["ACTIVE"], exclude: ["PENDING"] };
    expect(isTutorStatusApplicable(filters.role)).toBe(applicable);
    const normalized = normalizeUserFilters(filters);
    expect(normalized.status).toEqual(
      applicable ? filters.status : { include: [], exclude: [] },
    );
    expect(parseUserFilters(JSON.stringify(filters))).toEqual(normalized);
    expect(normalized.role).toEqual(filters.role);
  },
);

it("clears status across mode transitions without losing account or role exclusions", () => {
  const initial = emptyUserFilters();
  initial.role = { include: ["TUTOR"], exclude: ["HEAD"] };
  initial.status = { include: ["ACTIVE"], exclude: ["PENDING"] };
  initial.account.exclude = ["setup"];
  const mixed = normalizeUserFilters({
    ...initial,
    role: { ...initial.role, include: ["TUTOR", "ADMIN"] },
  });
  const tutorAgain = normalizeUserFilters({ ...mixed, role: initial.role });
  expect(tutorAgain.status).toEqual({ include: [], exclude: [] });
  expect(tutorAgain.account).toEqual(initial.account);
  expect(tutorAgain.role.exclude).toEqual(["HEAD"]);
  expect(initial.status.include).toEqual(["ACTIVE"]);
});

it("matches composable Tutor membership but never a revoked or archived historical link", () => {
  const combined = {
    ...admin,
    tutorId: "synthetic-tutor",
    tuteeMember: true,
    tutorAccessRevoked: false,
    canTranslate: true,
    crewStatus: "ACTIVE",
  };
  const filters = emptyUserFilters();
  filters.role.include = ["TUTOR"];
  filters.status.include = ["ACTIVE"];
  expect(matchesUserFilters(combined, filters)).toBe(true);
  expect(
    matchesUserFilters({ ...combined, tutorAccessRevoked: true }, filters),
  ).toBe(false);
  expect(
    matchesUserFilters({ ...combined, tutorStatus: "ARCHIVED" }, filters),
  ).toBe(false);
  expect(matchesUserFilters({ ...combined, tutorId: null }, filters)).toBe(
    false,
  );
  expect(
    matchesUserFilters({ ...combined, tutorStatus: "PENDING" }, filters),
  ).toBe(false);
  filters.status.exclude = ["ACTIVE"];
  expect(matchesUserFilters(combined, filters)).toBe(false);
  filters.role.include.push("ADMIN");
  expect(matchesUserFilters(combined, filters)).toBe(true);
  filters.role.exclude.push("ADMIN");
  expect(matchesUserFilters(combined, filters)).toBe(false);
});
it("restores selections and survives missing or corrupted preferences", () => {
  const filters = emptyUserFilters();
  filters.role.exclude = ["HEAD"];
  expect(parseUserFilters(JSON.stringify(filters))).toEqual(filters);
  expect(parseUserFilters("{broken")).toEqual(emptyUserFilters());
  expect(parseUserFilters(null)).toEqual(emptyUserFilters());
});

it.each(["ADMIN", "HEAD", "COORDINATOR", "VIEWER"])(
  "keeps %s visible with an archived tutor identity",
  (role) => {
    expect(
      matchesUserFilters(
        { role, tutorStatus: "ARCHIVED", account: "registered" },
        emptyUserFilters(),
      ),
    ).toBe(true);
  },
);
it("keeps independently current tutee, crew and translator participation visible", () => {
  const row = {
    role: "STUDENT",
    tutorStatus: "GRADUATED",
    account: "registered",
  };
  for (const extra of [
    { currentTutee: true },
    { crewStatus: "ACTIVE" },
    { canTranslate: true },
  ])
    expect(matchesUserFilters({ ...row, ...extra }, emptyUserFilters())).toBe(
      true,
    );
  expect(
    matchesUserFilters({ ...row, currentTutee: false }, emptyUserFilters()),
  ).toBe(false);
});
it("hides unverified logins by default but supports explicit recovery without deleting records", () => {
  const row = {
    ...admin,
    userId: "pending",
    emailVerifiedAt: null,
    account: "setup",
  };
  expect(matchesUserFilters(row, emptyUserFilters())).toBe(false);
  expect(
    matchesUserFilters(row, { ...emptyUserFilters(), showUnverified: true }),
  ).toBe(true);
  const filters = emptyUserFilters();
  filters.account.include = ["setup"];
  expect(matchesUserFilters(row, filters)).toBe(true);
  expect(parseUserFilters('{"showUnverified":true}').showUnverified).toBe(true);
});

it.each(["hasTuteeHistory", "hasTutorHistory"] as const)(
  "hides historical-only accounts with %s while preserving another current membership",
  (historyField) => {
    const row = {
      role: "STUDENT",
      tutorStatus: null,
      account: "registered",
      [historyField]: true,
      currentTutee: false,
    };
    expect(matchesUserFilters(row, emptyUserFilters())).toBe(false);
    expect(
      matchesUserFilters(row, { ...emptyUserFilters(), showPastTutors: true }),
    ).toBe(true);
    expect(
      matchesUserFilters({ ...row, currentTutee: true }, emptyUserFilters()),
    ).toBe(true);
    expect(
      matchesUserFilters({ ...row, tutorStatus: "ACTIVE" }, emptyUserFilters()),
    ).toBe(true);
  },
);

it.each(["ACTIVE", "PENDING", "OPTED_OUT"])(
  "keeps a current %s tutor visible beside retained history unless access is revoked",
  (tutorStatus) => {
    const row = {
      role: "TUTOR",
      tutorId: "current-tutor",
      tutorStatus,
      account: "registered",
      hasTutorHistory: true,
      tuteeMember: false,
      tutorAccessRevoked: false,
    };
    expect(matchesUserFilters(row, emptyUserFilters())).toBe(true);
    const revoked = { ...row, tutorAccessRevoked: true };
    expect(matchesUserFilters(revoked, emptyUserFilters())).toBe(false);
    expect(
      matchesUserFilters(revoked, {
        ...emptyUserFilters(),
        showPastTutors: true,
      }),
    ).toBe(true);
  },
);

it.each(["ARCHIVED", "GRADUATED", "TRANSFERRED"])(
  "keeps a %s tutor with retained history behind historical visibility",
  (tutorStatus) => {
    const row = {
      role: "TUTOR",
      tutorId: "historical-tutor",
      tutorStatus,
      account: "registered",
      hasTutorHistory: true,
      tuteeMember: false,
      tutorAccessRevoked: false,
    };
    expect(matchesUserFilters(row, emptyUserFilters())).toBe(false);
    expect(
      matchesUserFilters(row, {
        ...emptyUserFilters(),
        showPastTutors: true,
      }),
    ).toBe(true);
    expect(
      matchesUserFilters({ ...row, role: "ADMIN" }, emptyUserFilters()),
    ).toBe(true);
  },
);

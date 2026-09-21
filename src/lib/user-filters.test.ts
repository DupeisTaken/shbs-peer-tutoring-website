import { expect, it } from "vitest";
import {
  emptyUserFilters,
  isTutorStatusApplicable,
  matchesUserFilters,
  normalizeUserFilters,
  parseUserFilters,
} from "./user-filters";
const admin = { role: "ADMIN", tutorStatus: "ACTIVE", account: "registered" };
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
] as const)("checks applicability for includes %j and excludes %j", (include, exclude, applicable) => {
  const filters = emptyUserFilters();
  filters.role = { include: [...include], exclude: [...exclude] };
  filters.status = { include: ["ACTIVE"], exclude: ["PENDING"] };
  expect(isTutorStatusApplicable(filters.role)).toBe(applicable);
  const normalized = normalizeUserFilters(filters);
  expect(normalized.status).toEqual(applicable ? filters.status : { include: [], exclude: [] });
  expect(parseUserFilters(JSON.stringify(filters))).toEqual(normalized);
  expect(normalized.role).toEqual(filters.role);
});

it("clears status across mode transitions without losing account or role exclusions", () => {
  const initial = emptyUserFilters();
  initial.role = { include: ["TUTOR"], exclude: ["HEAD"] };
  initial.status = { include: ["ACTIVE"], exclude: ["PENDING"] };
  initial.account.exclude = ["setup"];
  const mixed = normalizeUserFilters({ ...initial, role: { ...initial.role, include: ["TUTOR", "ADMIN"] } });
  const tutorAgain = normalizeUserFilters({ ...mixed, role: initial.role });
  expect(tutorAgain.status).toEqual({ include: [], exclude: [] });
  expect(tutorAgain.account).toEqual(initial.account);
  expect(tutorAgain.role.exclude).toEqual(["HEAD"]);
  expect(initial.status.include).toEqual(["ACTIVE"]);
});

it("matches composable Tutor membership but never a revoked or archived historical link", () => {
  const combined = { ...admin, tutorId: "synthetic-tutor", tuteeMember: true, tutorAccessRevoked: false, canTranslate: true, crewStatus: "ACTIVE" };
  const filters = emptyUserFilters();
  filters.role.include = ["TUTOR"];
  filters.status.include = ["ACTIVE"];
  expect(matchesUserFilters(combined, filters)).toBe(true);
  expect(matchesUserFilters({ ...combined, tutorAccessRevoked: true }, filters)).toBe(false);
  expect(matchesUserFilters({ ...combined, tutorStatus: "ARCHIVED" }, filters)).toBe(false);
  expect(matchesUserFilters({ ...combined, tutorId: null }, filters)).toBe(false);
  expect(matchesUserFilters({ ...combined, tutorStatus: "PENDING" }, filters)).toBe(false);
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

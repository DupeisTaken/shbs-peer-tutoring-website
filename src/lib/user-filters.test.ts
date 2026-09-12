import { expect, it } from "vitest";
import {
  emptyUserFilters,
  matchesUserFilters,
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
it("handles null roles and tutor links explicitly", () => {
  const filters = emptyUserFilters();
  filters.status.include = ["__none__"];
  expect(matchesUserFilters({ ...admin, tutorStatus: null }, filters)).toBe(
    true,
  );
  expect(matchesUserFilters(admin, filters)).toBe(false);
});
it("restores selections and survives missing or corrupted preferences", () => {
  const filters = emptyUserFilters();
  filters.role.exclude = ["HEAD"];
  expect(parseUserFilters(JSON.stringify(filters))).toEqual(filters);
  expect(parseUserFilters("{broken")).toEqual(emptyUserFilters());
  expect(parseUserFilters(null)).toEqual(emptyUserFilters());
});

import { expect, it, vi } from "vitest";
import { groupDirectoryRows, type TutorDirectorySource } from "./account-directory";
import type { DomainDb } from "./transactions";
import { emptyUserFilters, matchesUserFilters } from "~/lib/user-filters";

function fixture() {
  const accounts = [
    { id: "D", mergedIntoId: null, name: "Current D", email: "d@example.test", username: "reader-d", recoveryVoidedAt: null },
    { id: "C", mergedIntoId: null, name: "Current C", email: "c@example.test", username: "reader-c", recoveryVoidedAt: null },
    { id: "A", mergedIntoId: "D", name: "Original A", email: "a@example.test", username: "original-a", recoveryVoidedAt: null },
    { id: "B", mergedIntoId: "A", name: "Original B", email: "b@example.test", username: "original-b", recoveryVoidedAt: null },
  ];
  const mappings: { sourceUserId: string; readerUserId: string | null; state: string }[] = [
    { sourceUserId: "A", readerUserId: "D", state: "ASSIGNED" },
    { sourceUserId: "B", readerUserId: "C", state: "ASSIGNED" },
  ];
  // Deliberately stale display grouping: source aliases must use explicit access
  // even before staff correct this independent presentation projection.
  const people = [
    { id: "pD", primaryUserId: "D", resolutionState: "GROUPED", users: accounts.filter((row) => row.id !== "C"), tutors: [], tutees: [], _count: { users: 3, tutors: 0, tutees: 0 } },
    { id: "pC", primaryUserId: "C", resolutionState: "GROUPED", users: accounts.filter((row) => row.id === "C"), tutors: [], tutees: [], _count: { users: 1, tutors: 0, tutees: 0 } },
  ];
  const rows = accounts.filter((row) => !row.mergedIntoId).map((account) => ({
    personId: `p${account.id}`, userId: account.id, tutorId: null, tuteeId: null,
    name: account.name, email: account.email, username: account.username,
    role: "ADMIN", tutorStatus: null, account: "registered", emailVerifiedAt: new Date("2026-11-03T00:00:00Z"),
  }));
  const sources: TutorDirectorySource[] = ["A", "B"].map((id) => ({
    personId: null, userId: null, retainedOwnerId: id,
    destination: { tutorId: `t${id}`, name: `Original tutor ${id}`, username: null, status: "ARCHIVED", account: null, hasEmail: false, suspended: false, retainedOwnerName: `Original ${id}` },
  }));
  const mappingRead = vi.fn(async ({ where }: { where: { readerUserId: { in: string[] }; state: string } }) => mappings.filter((row) => row.readerUserId && where.readerUserId.in.includes(row.readerUserId) && row.state === where.state));
  const accountRead = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => accounts.filter((row) => where.id.in.includes(row.id)));
  const db = {
    person: { findMany: vi.fn().mockResolvedValue(people) },
    studentProfileOwnership: { findMany: vi.fn().mockResolvedValue([]) },
    retiredHistoryOwnership: { findMany: mappingRead }, user: { findMany: accountRead },
  } as unknown as DomainDb;
  return { db, accounts, mappings, people, rows, sources, mappingRead, accountRead };
}

it("uses exact corrected aliases and archive destinations independently of the old retirement family", async () => {
  const { db, rows, sources, mappingRead, accountRead } = fixture();
  const result = await groupDirectoryRows(db, rows, sources);
  const oldReader = result.find((row) => row.userId === "D")!;
  const newReader = result.find((row) => row.userId === "C")!;
  expect(oldReader.directoryMembers[0]!.searchTerms).toContain("Original A");
  expect(oldReader.directoryMembers[0]!.searchTerms).not.toContain("Original B");
  expect(newReader.directoryMembers[0]!.searchTerms).toContain("Original B");
  expect(newReader.directoryMembers[0]!.searchTerms).not.toContain("Original A");
  expect(oldReader.tutorDestinations.map((row) => row.tutorId)).toEqual(["tA"]);
  expect(newReader.tutorDestinations.map((row) => row.tutorId)).toEqual(["tB"]);
  expect(matchesUserFilters(oldReader, emptyUserFilters(), "Original B")).toBe(false);
  expect(matchesUserFilters(newReader, emptyUserFilters(), "Original B")).toBe(true);
  expect(newReader).toMatchObject({ role: "ADMIN", tutorId: null, account: "registered" });
  // Both users are resolved in one bounded batch, without per-account graph walks.
  expect(mappingRead).toHaveBeenCalledOnce();
  expect(accountRead).toHaveBeenCalledOnce();
});

it.each(["missing", "quarantined", "invalid"] as const)("does not restore historical aliases for a %s mapping", async (state) => {
  const { db, rows, sources, mappings } = fixture();
  if (state === "missing") mappings.splice(1, 1);
  else { mappings[1]!.state = state === "quarantined" ? "QUARANTINED" : "UNKNOWN"; mappings[1]!.readerUserId = null; }
  const result = await groupDirectoryRows(db, rows, sources);
  for (const row of result) {
    expect(row.directoryMembers[0]!.searchTerms).not.toContain("Original B");
    expect(row.tutorDestinations.map((source) => source.tutorId)).not.toContain("tB");
  }
});

it("does not cascade an independent correction of A into B's source aliases", async () => {
  const { db, rows, sources, mappings } = fixture();
  mappings[0]!.readerUserId = "C";
  mappings[1]!.readerUserId = "D";
  const result = await groupDirectoryRows(db, rows, sources);
  expect(result.find((row) => row.userId === "C")!.directoryMembers[0]!.searchTerms).toContain("Original A");
  const oldReader = result.find((row) => row.userId === "D")!;
  expect(oldReader.directoryMembers[0]!.searchTerms).toContain("Original B");
  expect(oldReader.directoryMembers[0]!.searchTerms).not.toContain("Original A");
});

it("keeps corrected aliases available before directory Person metadata exists", async () => {
  const { db, rows, sources, people } = fixture();
  people.splice(0);
  const result = await groupDirectoryRows(db, rows.map((row) => ({ ...row, personId: null })), sources);
  expect(result.find((row) => row.userId === "C")!.directoryMembers[0]!.searchTerms).toContain("Original B");
  expect(result.find((row) => row.userId === "D")!.directoryMembers[0]!.searchTerms).not.toContain("Original B");
});

it("rejects malformed mapping authority over a still-live source", async () => {
  const { db, rows, sources, mappings } = fixture();
  mappings.push({ sourceUserId: "D", readerUserId: "C", state: "ASSIGNED" });
  const result = await groupDirectoryRows(db, rows, sources);
  expect(result.find((row) => row.userId === "C")!.directoryMembers[0]!.searchTerms).not.toContain("Current D");
});

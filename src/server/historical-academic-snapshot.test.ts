import { expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import { historicalAcademicSnapshot, preserveHistoricalAcademics } from "./historical-academic-snapshot";

// Importing the operator evidence core must not initialize the application or
// require signing credentials. The signed web correction module stays separate.
vi.mock("~/env", () => { throw new Error("Historical evidence must not read application environment"); });
vi.mock("~/server/db", () => { throw new Error("Historical evidence requires an injected database"); });
vi.mock("~/server/auth/username", () => { throw new Error("Historical evidence must not initialize username web defaults"); });

function fixture() {
  const events: string[] = [];
  const participant = { id: "synthetic-learner", englishName: "Synthetic archive", status: "INACTIVE",
    intakeTermId: "old-term", gradeLevel: null, academicallyGraduated: false,
    user: { id: "synthetic-current-owner" } };
  const retained = { userId: "synthetic-current-owner" };
  const owners = [{ id: "synthetic-current-owner", name: "Synthetic owner", profileVersion: 1,
    academicProfile: null, mergedIntoId: null },
  { id: "synthetic-other-owner", name: "Synthetic retained owner", profileVersion: 1,
    academicProfile: null, mergedIntoId: null }];
  const upsert = vi.fn(async () => undefined);
  const tx = {
    $executeRaw: vi.fn(async (_sql: TemplateStringsArray, key: string) => { events.push(`advisory:${key}`); return 1; }),
    $queryRaw: vi.fn(async (sql: { text: string }) => { events.push(`row:${sql.text}`); return [{ id: participant.id }]; }),
    tutee: {
      findUniqueOrThrow: vi.fn(async () => { events.push("participant-read"); return participant; }),
      findUnique: vi.fn(async () => participant),
    },
    tutor: { findUnique: vi.fn(async () => null) },
    term: { findFirst: vi.fn(async () => ({ id: "current-term" })),
      findUnique: vi.fn(async () => ({ id: "old-term", schoolYear: "24-25" })) },
    studentProfileOwnership: { findUnique: vi.fn(async () => retained) },
    user: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      owners.filter((owner) => where.id.in.includes(owner.id))) },
    historicalAcademicRecord: { findUnique: vi.fn(async () => null), upsert },
  } as unknown as TransactionDb;
  return { tx, participant, retained, events, upsert };
}

it("reads virtual original evidence without signing or writes and binds exact direct/retained ownership", async () => {
  const f = fixture();
  const before = await historicalAcademicSnapshot(f.tx, "legacy-tutee:synthetic-learner");
  expect(before.original).toMatchObject({ rawGrade: null, schoolYear: "24-25", source: "LEGACY_TUTEE" });
  expect(before.ownershipConflict).toBe(false);
  expect(before.owners.map((owner) => owner.id)).toEqual(["synthetic-current-owner"]);
  expect(f.upsert).not.toHaveBeenCalled();
  expect(f.events).toEqual([]);
  f.retained.userId = "synthetic-other-owner";
  const after = await historicalAcademicSnapshot(f.tx, "legacy-tutee:synthetic-learner");
  expect(after.ownershipConflict).toBe(true);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(f.upsert).not.toHaveBeenCalled();
});

it("preserves under participant then evidence locks without taking account locks or overwriting originals", async () => {
  const f = fixture();
  await preserveHistoricalAcademics(f.tx, "TUTEE", f.participant.id);
  expect(f.events[0]).toBe("advisory:tutee:synthetic-learner");
  expect(f.events[1]).toContain('SELECT id FROM "Tutee"');
  expect(f.events[1]).toContain("FOR NO KEY UPDATE");
  expect(f.events[2]).toBe("participant-read");
  expect(f.events[3]).toBe("advisory:historical-academic:legacy-tutee:synthetic-learner");
  expect(f.events.some((event) => /account-profile|username/.test(event))).toBe(false);
  expect(f.upsert).toHaveBeenCalledWith({
    where: { id: "legacy-tutee:synthetic-learner" }, update: {},
    create: { id: "legacy-tutee:synthetic-learner", tuteeId: "synthetic-learner", tutorId: null,
      rawGrade: null, schoolYear: "24-25", academicallyGraduated: false,
      source: "LEGACY_TUTEE", originalConfirmedAt: null },
  });
});

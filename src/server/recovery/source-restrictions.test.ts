import { beforeEach, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
import { participantSourceRestrictions } from "~/server/participant-source-restrictions";
import { recoveryHash } from "./capture";
import { inspectRecoveryParticipantEligibility } from "./adapters/assignment-eligibility";
import {
  participantIdentity,
  recoverySourceRestrictionBlockers,
} from "./adapters/shared";

vi.mock("~/server/participant-source-restrictions", () => ({
  participantSourceRestrictions: vi.fn(),
}));
vi.mock("~/server/academics", () => ({ requireAcademicConfirmation: vi.fn() }));
vi.mock("~/server/school-departure", () => ({
  requireSchoolParticipation: vi.fn(),
}));
vi.mock("~/server/policy-acceptance", () => ({
  requirePolicy: vi.fn(),
  publishedPolicy: vi.fn(async () => null),
  findAccountPolicy: vi.fn(),
}));
vi.mock("~/server/room-bookings", () => ({
  assertPlannedRoomAvailable: vi.fn(),
}));
vi.mock("~/server/tutor-scheduling", () => ({
  assertTutorScheduleAvailable: vi.fn(),
}));

type Restrictions = Awaited<ReturnType<typeof participantSourceRestrictions>>;
function provenance(kind: "TUTOR" | "TUTEE" = "TUTEE"): Restrictions {
  return {
    kind,
    sourceId: "exact-source",
    sourceUserIds: ["current-owner", "retired-original"],
    ownershipRevision: 3,
    retained: { userId: "current-owner", revision: 2 },
    direct: { id: "current-owner" },
    receiptIds: ["exact-source-combine-receipt"],
    accounts: [
      {
        id: "current-owner",
        suspendedAt: null,
        recoveryVoidedAt: null,
        schoolDeparture: null,
      },
      {
        id: "retired-original",
        suspendedAt: null,
        recoveryVoidedAt: null,
        schoolDeparture: null,
      },
    ],
    blockers: [],
  };
}
function transaction(kind: "TUTOR" | "TUTEE" = "TUTEE") {
  const currentOwner = {
    id: "current-owner",
    role: kind === "TUTOR" ? "TUTOR" : "STUDENT",
    tutorId: kind === "TUTOR" ? "exact-source" : null,
    studentId: kind === "TUTEE" ? "exact-source" : null,
    tuteeMember: true,
    mergedIntoId: null,
    suspendedAt: null,
    tutorAccessRevoked: false,
    recoveryVoidedAt: null,
    sessionVersion: 1,
    academicProfile: null,
    schoolDeparture: null,
  };
  return {
    tutor: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: "exact-source",
        personId: null,
        historyIdentityRevision: 0,
      })),
    },
    tutee: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: "exact-source",
        personId: null,
        historyIdentityRevision: 0,
      })),
    },
    tutorProfileOwnership: {
      findUnique: vi.fn(async () => ({ userId: "current-owner" })),
    },
    studentProfileOwnership: {
      findUnique: vi.fn(async () => ({ userId: "current-owner" })),
    },
    user: { findMany: vi.fn(async () => [currentOwner]) },
    person: { findUnique: vi.fn() },
    participantConsolidation: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    disciplinaryCard: { groupBy: vi.fn(async () => []) },
    legacySignupDecline: { findUnique: vi.fn(async () => null) },
  } as unknown as TransactionDb;
}
beforeEach(() => vi.clearAllMocks());

it.each(["TUTOR", "TUTEE"] as const)(
  "keeps retired %s restriction accounts separate from current owners and consent binding",
  async (kind) => {
    const source = provenance(kind);
    vi.mocked(participantSourceRestrictions).mockResolvedValue(source);
    const tx = transaction(kind);
    const identity = await participantIdentity(tx, kind, "exact-source");
    expect(participantSourceRestrictions).toHaveBeenCalledWith(
      tx,
      kind,
      "exact-source",
    );
    expect(identity.ownerIds).toEqual(["current-owner"]);
    expect(identity.owners.map((owner) => owner.id)).toEqual(["current-owner"]);
    expect(identity.sourceRestrictions.sourceUserIds).toContain(
      "retired-original",
    );
    expect(JSON.stringify(identity.binding)).not.toContain("retired-original");
  },
);

it.each(["TUTOR", "TUTEE"] as const)(
  "blocks %s activation from exact retired-source suspension and school-departure evidence",
  async (kind) => {
    for (const reason of [
      "SUSPENDED",
      "VOIDED",
      "MISSING_SOURCE",
      "SCHOOL_DEPARTURE",
    ] as const) {
      const source = provenance(kind);
      source.blockers = [{ userId: "retired-original", reason }];
      if (reason === "SUSPENDED")
        source.accounts[1]!.suspendedAt = new Date("2026-11-01T00:00:00Z");
      if (reason === "VOIDED")
        source.accounts[1]!.recoveryVoidedAt = new Date("2026-11-01T00:00:00Z");
      if (reason === "MISSING_SOURCE") source.accounts.pop();
      if (reason === "SCHOOL_DEPARTURE")
        source.accounts[1]!.schoolDeparture = {
          reason: "LEFT_SCHOOL",
          revision: 2,
          observerRevoked: false,
        };
      vi.mocked(participantSourceRestrictions).mockResolvedValue(source);
      const inspected = await inspectRecoveryParticipantEligibility(
        transaction(kind),
        { kind, sourceId: "exact-source" },
      );
      expect(inspected.blockers, reason).toEqual([
        expect.stringContaining("original account"),
      ]);
      expect(inspected.blockers.join(" ")).not.toContain("retired-original");
    }
  },
);

it("binds current preview evidence to retired restrictions without changing the captured consent binding", async () => {
  const source = provenance();
  vi.mocked(participantSourceRestrictions).mockResolvedValue(source);
  const tx = transaction();
  const beforeIdentity = await participantIdentity(tx, "TUTEE", "exact-source");
  const before = await inspectRecoveryParticipantEligibility(tx, {
    kind: "TUTEE",
    sourceId: "exact-source",
  });
  const changed = provenance();
  changed.accounts[1]!.suspendedAt = new Date("2026-11-01T00:00:00Z");
  changed.blockers = [{ userId: "retired-original", reason: "SUSPENDED" }];
  vi.mocked(participantSourceRestrictions).mockResolvedValue(changed);
  const afterIdentity = await participantIdentity(tx, "TUTEE", "exact-source");
  const after = await inspectRecoveryParticipantEligibility(tx, {
    kind: "TUTEE",
    sourceId: "exact-source",
  });
  expect(recoveryHash(after.evidence)).not.toBe(recoveryHash(before.evidence));
  expect(recoveryHash(afterIdentity.binding)).toBe(
    recoveryHash(beforeIdentity.binding),
  );
  expect(before.blockers).toEqual([]);
  expect(after.blockers).not.toEqual([]);
});

it("allows only an exact trusted refresh graduation reversal, preserving every other source restriction", () => {
  const source = provenance();
  source.accounts[1]!.schoolDeparture = {
    reason: "GRADUATED",
    revision: 2,
    observerRevoked: false,
  };
  source.blockers = [
    { userId: "retired-original", reason: "SCHOOL_DEPARTURE" },
  ];
  expect(recoverySourceRestrictionBlockers(source)).not.toEqual([]);
  expect(
    recoverySourceRestrictionBlockers(source, ["different-account"]),
  ).not.toEqual([]);
  expect(
    recoverySourceRestrictionBlockers(source, ["retired-original"]),
  ).toEqual([]);
  source.accounts[1]!.schoolDeparture.reason = "LEFT_SCHOOL";
  expect(
    recoverySourceRestrictionBlockers(source, ["retired-original"]),
  ).not.toEqual([]);
  source.accounts[1]!.schoolDeparture.reason = "GRADUATED";
  source.blockers.push({ userId: "retired-original", reason: "SUSPENDED" });
  expect(
    recoverySourceRestrictionBlockers(source, ["retired-original"]),
  ).not.toEqual([]);
});

it("fingerprints exact provenance revisions even when current restriction values are unchanged", async () => {
  const source = provenance();
  vi.mocked(participantSourceRestrictions).mockResolvedValue(source);
  const before = await inspectRecoveryParticipantEligibility(transaction(), {
    kind: "TUTEE",
    sourceId: "exact-source",
  });
  const changed = provenance();
  changed.ownershipRevision = 4;
  vi.mocked(participantSourceRestrictions).mockResolvedValue(changed);
  const after = await inspectRecoveryParticipantEligibility(transaction(), {
    kind: "TUTEE",
    sourceId: "exact-source",
  });
  expect(recoveryHash(after.evidence)).not.toBe(recoveryHash(before.evidence));
  expect(after.blockers).toEqual([]);
});

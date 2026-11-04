import { beforeEach, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
import {
  executionParticipantId,
  executionSourceIds,
} from "~/server/participant-execution";
import { inspectRecoveryParticipantEligibility } from "./adapters/assignment-eligibility";
import {
  correctionParticipantState,
  inspectCorrectionRestoration,
} from "./adapters/correction-state";
import { recoveryHash } from "./capture";

vi.mock("~/server/participant-execution", () => ({
  executionParticipantId: vi.fn(),
  executionSourceIds: vi.fn(),
}));
vi.mock("./adapters/shared", () => ({
  participantIdentity: vi.fn(async () => ({
    binding: { source: { id: "target" } },
    owners: [],
    ownerIds: [],
    sourceRestrictions: { blockers: [] },
  })),
  recoverySourceRestrictionBlockers: vi.fn(() => []),
}));
vi.mock("~/server/academics", () => ({ requireAcademicConfirmation: vi.fn() }));
vi.mock("~/server/policy-acceptance", () => ({
  requirePolicy: vi.fn(),
  publishedPolicy: vi.fn(),
  findAccountPolicy: vi.fn(),
}));
vi.mock("~/server/school-departure", () => ({
  requireSchoolParticipation: vi.fn(),
}));
vi.mock("~/server/room-bookings", () => ({
  assertPlannedRoomAvailable: vi.fn(),
  lockPlannedRoomSchedule: vi.fn(),
}));
vi.mock("~/server/tutor-scheduling", () => ({
  assertTutorScheduleAvailable: vi.fn(),
}));
vi.mock("~/server/qualifications", () => ({ lockCatalogue: vi.fn() }));
vi.mock("~/server/session-planning", () => ({ lockSessionPlanning: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(executionParticipantId).mockResolvedValue("target");
  vi.mocked(executionSourceIds).mockResolvedValue(["target", "retired-source"]);
});

function fixture() {
  const cards = [
    {
      id: "selected",
      tuteeId: "retired-source",
      color: "RED",
      reviewStatus: "VALID",
    },
    {
      id: "independent",
      tuteeId: "target",
      color: "RED",
      reviewStatus: "VALID",
    },
  ];
  const cardQuery = vi.fn(
    async ({ where }: { where: { tuteeId: { in: string[] } } }) =>
      cards.filter((card) => where.tuteeId.in.includes(card.tuteeId)),
  );
  const countQuery = vi.fn(async () => [{ color: "RED", _count: { _all: 2 } }]);
  const tx = {
    tutee: {
      findUniqueOrThrow: vi.fn(
        async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          status: "INACTIVE",
          updatedAt: new Date(0),
        }),
      ),
    },
    pairingTutee: { findMany: vi.fn(async () => []) },
    tuteeRemovalRequest: { findMany: vi.fn(async () => []) },
    disciplinaryCard: { findMany: cardQuery, groupBy: countQuery },
    studentSurvey: { findUnique: vi.fn(async () => null) },
    pairing: { findMany: vi.fn(async () => []) },
  } as unknown as TransactionDb;
  return { tx, cards, cardQuery, countQuery };
}

it("blocks canonical participant activation using all effective VALID cards, including retained sources", async () => {
  const f = fixture();
  const inspected = await inspectRecoveryParticipantEligibility(f.tx, {
    kind: "TUTEE",
    sourceId: "target",
  });
  expect(f.countQuery).toHaveBeenCalledWith({
    by: ["color"],
    where: {
      tuteeId: { in: ["retired-source", "target"] },
      reviewStatus: "VALID",
    },
    _count: { _all: true },
  });
  expect(inspected.blockers).toContain(
    "Current disciplinary standing prevents restoring participation.",
  );
});

it("refuses resurrection of a superseded source and partial projected consolidated standing", async () => {
  const f = fixture();
  const inspected = await inspectRecoveryParticipantEligibility(f.tx, {
    kind: "TUTEE",
    sourceId: "retired-source",
    disciplineAfterCorrection: { validYellow: 0, validRed: 0 },
  });
  expect(inspected.blockers.join(" ")).toContain("current execution source");
  expect(inspected.blockers.join(" ")).toContain(
    "Consolidated disciplinary consequences",
  );
});

it("fingerprints the complete consequence scope and refuses card/attendance replay of only the original learner", async () => {
  const f = fixture();
  const current = await correctionParticipantState(f.tx, "retired-source");
  expect(f.cardQuery).toHaveBeenCalledWith({
    where: { tuteeId: { in: ["retired-source", "target"] } },
    orderBy: { id: "asc" },
  });
  expect(current.cards).toEqual(f.cards);
  expect(current.identity.ownerIds).toEqual([]);
  const inspected = await inspectCorrectionRestoration(
    f.tx,
    current.snapshot,
    current,
    {
      reviews: [{ id: "selected", reviewStatus: "INVALID" }],
    },
  );
  expect(inspected.disciplineAfterCorrection).toEqual({
    validYellow: 0,
    validRed: 1,
  });
  expect(inspected.blockers.join(" ")).toContain(
    "Consolidated disciplinary consequences",
  );
  vi.mocked(executionSourceIds).mockResolvedValue(["target"]);
  const changed = await correctionParticipantState(f.tx, "retired-source");
  expect(recoveryHash(changed.fingerprint)).not.toBe(
    recoveryHash(current.fingerprint),
  );
});

it("retains ordinary untransferred correction support", async () => {
  vi.mocked(executionParticipantId).mockResolvedValue("target");
  vi.mocked(executionSourceIds).mockResolvedValue(["target"]);
  const f = fixture();
  const current = await correctionParticipantState(f.tx, "target");
  const inspected = await inspectCorrectionRestoration(
    f.tx,
    current.snapshot,
    current,
    {
      reviews: [{ id: "selected", reviewStatus: "INVALID" }],
    },
  );
  expect(inspected.blockers).toEqual([]);
});

import assert from "node:assert/strict";
import type { PrismaClient } from "../../generated/prisma";
import type { createCaller } from "../../src/server/api/root";
import {
  plannedWindow,
  planningWeeks,
  RESPONSE_WINDOW_MS,
} from "../../src/lib/session-planning";
import {
  addDays,
  fixtureKey,
  type Fixture,
} from "../scheduling-profile/fixtures";
import {
  proposalSourceAfter,
  type ReceiptInput,
} from "../scheduling-profile/scenarios";
import type { RunWave } from "./wave";

export const CONCURRENT_CASES = {
  cold: {
    policy: "first-period",
    calls: [
      { operation: "cold:first", role: "tutor", transport: "http" },
      { operation: "cold:second", role: "tutee", transport: "http" },
    ],
  },
  sunday: {
    policy: "first-period",
    calls: [
      { operation: "sunday:first", role: "tutor", transport: "domain" },
      { operation: "sunday:second", role: "tutee", transport: "domain" },
    ],
  },
  "proposal-split": {
    policy: "first-period",
    calls: [
      {
        operation: "proposal-split:proposal",
        role: "tutor",
        transport: "http",
      },
      { operation: "proposal-split:split", role: "tutor", transport: "http" },
    ],
  },
  acceptance: {
    policy: "first-period",
    calls: [
      { operation: "acceptance:accept", role: "tutee", transport: "http" },
      { operation: "acceptance:read", role: "tutor", transport: "http" },
    ],
  },
  deadline: {
    policy: "due-candidates",
    calls: [
      { operation: "deadline:first", role: "maintenance", transport: "domain" },
      {
        operation: "deadline:second",
        role: "maintenance",
        transport: "domain",
      },
    ],
  },
  "two-readers": {
    policy: "simultaneous",
    calls: [
      { operation: "two-readers:first", role: "tutor", transport: "http" },
      { operation: "two-readers:second", role: "tutor", transport: "http" },
    ],
  },
} as const;
export type ConcurrentCase = keyof typeof CONCURRENT_CASES;
export type ConcurrentContext = {
  db: PrismaClient;
  fixture: Fixture;
  caller: (userId: string) => ReturnType<typeof createCaller>;
  receiptInputs: ReceiptInput[];
  runWave: RunWave;
};

/** Verify all captured learners receive exactly one real child; the database's
 * ordered audit/recovery graph is retained separately, never sorted here. */
export function assertSplitOutcome(
  parentStatus: string,
  children: readonly {
    scope: string;
    status: string;
    participantIds: unknown;
  }[],
  people: readonly string[],
) {
  assert.equal(parentStatus, "SPLIT");
  assert.equal(children.length, people.length);
  const seen = new Set<string>();
  for (const child of children) {
    assert.equal(child.scope, "ONE");
    assert.equal(child.status, "PENDING");
    assert.ok(
      Array.isArray(child.participantIds) && child.participantIds.length === 1,
    );
    const person: unknown = child.participantIds[0];
    assert.ok(
      typeof person === "string" &&
        people.includes(person) &&
        !seen.has(person),
    );
    seen.add(person);
  }
  assert.equal(seen.size, people.length);
}

export function assertAgendaResult(result: unknown) {
  assert.ok(result && typeof result === "object" && "cohorts" in result);
  assert.ok(
    Array.isArray(result.cohorts) && result.cohorts.length > 0,
    "Concurrent agenda must return real published commitments.",
  );
}

export function assertDeadlineReturns(results: readonly unknown[]) {
  assert.deepEqual(
    results,
    [1, 1],
    "Both real sweeps must select and visit the same original due request.",
  );
}

export async function runConcurrentScenario(
  name: ConcurrentCase,
  ctx: ConcurrentContext,
) {
  const { db, fixture: f, caller, runWave } = ctx;
  const planning = await import("../../src/server/session-planning");
  const spec = CONCURRENT_CASES[name];
  const tutor = (index: number) => caller(f.pairs[index]!.tutorUserId);
  const student = (index: number) => caller(f.pairs[index]!.studentUserIds[0]!);
  const prelude: { operation: string; result: unknown }[] = [];
  const remember = <T extends { clientKey: string }>(
    actorId: string,
    tag: string,
    input: T,
  ) => {
    const raw = input as Record<string, unknown>;
    const order =
      tag === "propose"
        ? [
            "date",
            "startMin",
            "roomId",
            "online",
            "cohortId",
            "expectedVersion",
            "clientKey",
            "scope",
            "tuteeId",
            "kind",
            "suggestionId",
          ]
        : tag === "respond"
          ? [
              "expectedVersion",
              "clientKey",
              "requestId",
              "offerId",
              "decision",
              "alternative",
            ]
          : ["expectedVersion", "clientKey", "requestId"];
    ctx.receiptInputs.push({
      actorId,
      clientKey: input.clientKey,
      input: [
        tag,
        Object.fromEntries(
          order
            .filter((key) => raw[key] !== undefined)
            .map((key) => [key, raw[key]]),
        ),
      ],
    });
    return input;
  };
  const current = async (id: string) => {
    const request = await db.sessionPlanningRequest.findUniqueOrThrow({
      where: { id },
      include: { offers: { include: { responses: true } } },
    });
    const offer = request.offers.find(
      (row) => row.id === request.currentOfferId,
    );
    assert.ok(
      offer,
      "Concurrent lifecycle needs the request's exact current offer.",
    );
    return { request, offer };
  };
  const prepareProposal = async (
    index: number,
    scope: "ONE" | "ALL",
    label: string,
  ) => {
    const target = { date: addDays(f.monday, 1), startMin: 1080, online: true };
    const after = proposalSourceAfter(
      label === "deadline" ? "propose-deadline" : label,
      f.anchor,
      target,
    );
    const source = await db.sessionPlanCohort.findFirstOrThrow({
      where: {
        status: "SCHEDULED",
        rescheduled: false,
        startsAt: { gt: after },
        plan: { tutorId: f.pairs[index]!.tutorId },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    const input = remember(f.pairs[index]!.tutorUserId, "propose", {
      ...target,
      cohortId: source.id,
      expectedVersion: source.version,
      clientKey: fixtureKey(`concurrent:${name}:${label}`),
      scope,
      ...(scope === "ONE" ? { tuteeId: f.pairs[index]!.tuteeIds[0]! } : {}),
      kind: "RESCHEDULE" as const,
    });
    return {
      source,
      target,
      run: () => tutor(index).sessionPlanning.propose(input),
    };
  };
  const savedProposal = async (
    index: number,
    scope: "ONE" | "ALL",
    label: string,
  ) => {
    const prepared = await prepareProposal(index, scope, label);
    const result = await prepared.run();
    prelude.push({ operation: `prepare:${label}`, result });
    return { ...prepared, result };
  };

  if (name === "cold" || name === "sunday") {
    assert.equal(
      await db.sessionPlan.count(),
      0,
      "Cold concurrency must begin without materialized plans.",
    );
    const sunday = new Date(`${addDays(f.monday, -1)}T04:00:00Z`);
    const results =
      name === "cold"
        ? await runWave(
            [
              {
                ...spec.calls[0],
                run: () => tutor(0).sessionPlanning.agenda({ role: "tutor" }),
              },
              {
                ...spec.calls[1],
                run: () => student(0).sessionPlanning.agenda({ role: "tutee" }),
              },
            ],
            "first-period",
          )
        : await runWave(
            [
              {
                ...spec.calls[0],
                run: () =>
                  planning.readSessionAgenda(
                    db,
                    {
                      id: f.pairs[0]!.tutorUserId,
                      tutorId: f.pairs[0]!.tutorId,
                    },
                    "tutor",
                    sunday,
                  ),
              },
              {
                ...spec.calls[1],
                run: () =>
                  planning.readSessionAgenda(
                    db,
                    { id: f.pairs[0]!.studentUserIds[0]! },
                    "tutee",
                    sunday,
                  ),
              },
            ],
            "first-period",
          );
    results.forEach(assertAgendaResult);
    const [plans, cohorts, participants, notices] = await Promise.all([
      db.sessionPlan.count(),
      db.sessionPlanCohort.count(),
      db.sessionPlanParticipant.count(),
      db.sessionNotice.count(),
    ]);
    assert.ok(plans > 0 && cohorts > 0 && participants > 0 && notices > 0);
    const expected = {
      plans,
      cohorts,
      participants,
      notices,
      window: planningWeeks(
        name === "sunday" ? sunday : f.anchor,
        "Asia/Shanghai",
      ),
    };
    return { scenario: name, prelude, results, expected };
  }

  prelude.push({
    operation: "prepare:publication",
    result: await planning.ensureSessionPlanningWindow(db, f.anchor),
  });
  if (name === "two-readers") {
    // Preserve the original contention prelude's actors, order and setup; only
    // isolate its first two-reader wave for the separately pinned repair pair.
    const results = await runWave(
      [
        {
          ...spec.calls[0],
          run: () => tutor(10).sessionPlanning.agenda({ role: "tutor" }),
        },
        {
          ...spec.calls[1],
          run: () => tutor(11).sessionPlanning.agenda({ role: "tutor" }),
        },
      ],
      "simultaneous",
    );
    results.forEach(assertAgendaResult);
    return {
      scenario: name,
      prelude,
      results,
      expected: { tutorIndices: [10, 11], agendas: 2 },
    };
  }
  if (name === "proposal-split") {
    const parent = await savedProposal(2, "ALL", "split-parent");
    const initial = await current(parent.result.id);
    const reject = remember(f.pairs[2]!.studentUserIds[0]!, "respond", {
      requestId: initial.request.id,
      offerId: initial.offer.id,
      expectedVersion: initial.request.version,
      clientKey: fixtureKey("concurrent:split-reject"),
      decision: "REJECT" as const,
      alternative: { date: addDays(f.monday, 2), startMin: 1080, online: true },
    });
    prelude.push({
      operation: "prepare:split-reject",
      result: await student(2).sessionPlanning.respond(reject),
    });
    const rejected = await current(parent.result.id);
    const split = remember(f.pairs[2]!.studentUserIds[0]!, "split", {
      requestId: parent.result.id,
      expectedVersion: rejected.request.version,
      clientKey: fixtureKey("concurrent:request-split"),
    });
    prelude.push({
      operation: "prepare:request-split",
      result: await student(2).sessionPlanning.requestSplit(split),
    });
    const pendingSplit = await current(parent.result.id);
    assert.equal(pendingSplit.request.status, "SPLIT_REQUESTED");
    const formalize = remember(f.pairs[2]!.tutorUserId, "formalizeSplit", {
      requestId: parent.result.id,
      expectedVersion: pendingSplit.request.version,
      clientKey: fixtureKey("concurrent:formalize-split"),
    });
    const proposal = await prepareProposal(4, "ALL", "competing-proposal");
    const results = await runWave(
      [
        { ...spec.calls[0], run: proposal.run },
        {
          ...spec.calls[1],
          run: () => tutor(2).sessionPlanning.formalizeSplit(formalize),
        },
      ],
      "first-period",
    );
    const [finished, children, newRequest] = await Promise.all([
      current(parent.result.id),
      db.sessionPlanningRequest.findMany({
        where: { parentRequestId: parent.result.id },
      }),
      current(results[0].id),
    ]);
    assertSplitOutcome(finished.request.status, children, f.pairs[2]!.tuteeIds);
    assert.equal(results[1].id, parent.result.id);
    assert.equal(newRequest.request.status, "PENDING");
    assert.equal(newRequest.request.scope, "ALL");
    assert.equal(await db.sessionPlanningRequest.count(), 4);
    return {
      scenario: name,
      prelude,
      results,
      expected: {
        parentStatus: finished.request.status,
        children: children.length,
        proposalStatus: newRequest.request.status,
      },
    };
  }

  const index = name === "deadline" ? 7 : 5;
  const proposed = await savedProposal(index, "ONE", name);
  const pending = await current(proposed.result.id);
  const response = pending.offer.responses.find(
    (row) => row.actorKey === `tutee:${f.pairs[index]!.tuteeIds[0]!}`,
  );
  assert.ok(response?.state === "PENDING");
  let results: readonly [unknown, unknown];
  let acceptedBy: "EXPLICIT" | "TIMEOUT";
  if (name === "acceptance") {
    const input = remember(f.pairs[index]!.studentUserIds[0]!, "respond", {
      requestId: pending.request.id,
      offerId: pending.offer.id,
      expectedVersion: pending.request.version,
      clientKey: fixtureKey("concurrent:accept"),
      decision: "ACCEPT" as const,
    });
    results = await runWave(
      [
        {
          ...spec.calls[0],
          run: () => student(index).sessionPlanning.respond(input),
        },
        {
          ...spec.calls[1],
          run: () => tutor(10).sessionPlanning.agenda({ role: "tutor" }),
        },
      ],
      "first-period",
    );
    assertAgendaResult(results[1]);
    acceptedBy = "EXPLICIT";
  } else {
    assert.equal(name, "deadline");
    assert.equal(
      await db.$transaction((tx) =>
        planning.markSessionResponseDelivered(tx, response.id, f.anchor),
      ),
      true,
    );
    const delivered = await db.sessionPlanningResponse.findUniqueOrThrow({
      where: { id: response.id },
    });
    assert.ok(delivered.deadline);
    assert.equal(
      delivered.deadline.getTime(),
      f.anchor.getTime() + RESPONSE_WINDOW_MS,
    );
    assert.ok(delivered.deadline < pending.offer.cutoffAt);
    assert.equal(
      await db.sessionPlanningRequest.count({
        where: { status: { in: ["PENDING", "SPLIT_REQUESTED"] } },
      }),
      1,
    );
    const deadline = delivered.deadline;
    results = await runWave(
      [
        {
          ...spec.calls[0],
          run: () => planning.sweepSessionPlanning(db, deadline),
        },
        {
          ...spec.calls[1],
          run: () => planning.sweepSessionPlanning(db, deadline),
        },
      ],
      "due-candidates",
    );
    assertDeadlineReturns(results);
    assert.equal(
      await db.auditLog.count({
        where: {
          operation: "sessionPlanning.autoaccepted",
          entityId: pending.request.id,
        },
      }),
      1,
    );
    acceptedBy = "TIMEOUT";
  }
  const [settled, decided, moved, peer] = await Promise.all([
    current(pending.request.id),
    db.sessionPlanningResponse.findUniqueOrThrow({
      where: { id: response.id },
    }),
    db.sessionPlanParticipant.findUniqueOrThrow({
      where: {
        planId_tuteeId: {
          planId: proposed.source.planId,
          tuteeId: f.pairs[index]!.tuteeIds[0]!,
        },
      },
    }),
    db.sessionPlanParticipant.findUniqueOrThrow({
      where: {
        planId_tuteeId: {
          planId: proposed.source.planId,
          tuteeId: f.pairs[index]!.tuteeIds[1]!,
        },
      },
    }),
  ]);
  assert.equal(settled.request.status, "ACCEPTED");
  assert.equal(decided.state, "ACCEPTED");
  assert.equal(decided.acceptedBy, acceptedBy);
  assert.equal(moved.status, "SCHEDULED");
  assert.equal(moved.scheduleOverride, true);
  assert.ok(moved.cohortId && moved.cohortId !== proposed.source.id);
  assert.equal(peer.cohortId, proposed.source.id);
  assert.equal(peer.status, "SCHEDULED");
  const target = await db.sessionPlanCohort.findUniqueOrThrow({
    where: { id: moved.cohortId },
  });
  assert.equal(
    target.startsAt.getTime(),
    plannedWindow(proposed.target, "Asia/Shanghai").startsAt.getTime(),
  );
  return {
    scenario: name,
    prelude,
    results,
    expected: {
      requestStatus: settled.request.status,
      responseState: decided.state,
      acceptedBy,
      movedParticipant: moved.tuteeId,
      peerParticipant: peer.tuteeId,
      targetDate: target.date,
      targetStartMin: target.startMin,
    },
  };
}

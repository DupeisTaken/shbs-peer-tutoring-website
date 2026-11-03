import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import type { PrismaClient } from "../../generated/prisma";
import type { createCaller } from "../../src/server/api/root";
import { addDays, fixtureId, fixtureKey, inspectPublicationAcknowledgements, installBacklogWitness, readMaintenanceReadiness, readPendingPublicationEventIds, seedRequestBacklog, type Fixture } from "./fixtures";
import type { ParityOptions } from "./parity";

export const scenarioNames = ["cold", "warm", "sunday", "negotiation", "allocation", "catalog", "contention", "backlog"] as const;
export type ScenarioName = (typeof scenarioNames)[number];
export type ReceiptInput = { actorId: string; clientKey: string; input: unknown };
export type ScenarioContext = {
  db: PrismaClient;
  fixture: Fixture;
  caller: (userId: string) => ReturnType<typeof createCaller>;
  measure: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  receiptInputs: ReceiptInput[];
  pairingCreations: NonNullable<ParityOptions["pairingCreations"]>[number][];
  transport: "http" | "procedure" | "domain";
  maintenance: { metadataAware: boolean; version: number | null };
  captureDomain: () => Promise<unknown>;
  recordPreparationEvidence: (stage: string, evidence: unknown) => void;
};

export async function runScenario(name: ScenarioName, ctx: ScenarioContext) {
  const { db, fixture: f, caller, measure } = ctx;
  const planning = await import("../../src/server/session-planning");
  const { planningWeeks } = await import("../../src/lib/session-planning");
  const tutor = (index: number) => caller(f.pairs[index]!.tutorUserId);
  const student = (index: number, person = 0) => caller(f.pairs[index]!.studentUserIds[person]!);
  const admin = caller(f.adminId);
  const results: unknown[] = [];
  const errorCode = (error: unknown) => {
    const value = error as { code?: string; data?: { code?: string } };
    return value.code ?? value.data?.code;
  };
  const drain = async (operations: (() => Promise<unknown>)[]) => {
    const settled = await Promise.allSettled(operations.map((operation) => operation()));
    const failed = settled.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    return settled.map((result) => {
      assert.ok(result.status === "fulfilled");
      return result.value;
    });
  };
  const remember = (actorId: string, tag: string, input: { clientKey: string }) => {
    // Zod emits keys in schema order, which matters to the existing receipt
    // JSON fingerprint. Retain the exact parsed input, not the caller's order.
    const raw = input as Record<string, unknown>;
    const order = tag === "propose"
      ? ["date", "startMin", "roomId", "online", "cohortId", "expectedVersion", "clientKey", "scope", "tuteeId", "kind", "suggestionId"]
      : tag === "respond"
        ? ["expectedVersion", "clientKey", "requestId", "offerId", "decision", "alternative"]
        : ["expectedVersion", "clientKey", "requestId"];
    const parsed = Object.fromEntries(order.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
    ctx.receiptInputs.push({ actorId, clientKey: input.clientKey, input: [tag, parsed] });
    return input;
  };
  const cohort = (index: number) => db.sessionPlanCohort.findFirstOrThrow({
    where: { status: "SCHEDULED", startsAt: { gt: new Date() }, plan: { tutorId: f.pairs[index]!.tutorId }, rescheduled: false },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  const current = async (requestId: string) => {
    const request = await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: requestId }, include: { offers: { include: { responses: true } } } });
    const offer = request.offers.find((offer) => offer.id === request.currentOfferId);
    assert.ok(offer, "Request has no exact current offer.");
    return { request, offer };
  };
  const propose = async (index: number, scope: "ONE" | "ALL", label: string, kind: "RESCHEDULE" | "EXTRA" = "RESCHEDULE", roomId?: string) => {
    const source = await cohort(index);
    const input = {
      cohortId: source.id, expectedVersion: source.version, clientKey: fixtureKey(label),
      scope, kind, ...(scope === "ONE" ? { tuteeId: f.pairs[index]!.tuteeIds[0]! } : {}),
      date: addDays(f.monday, 1), startMin: 1080, online: !roomId, ...(roomId ? { roomId } : {}),
    };
    remember(f.pairs[index]!.tutorUserId, "propose", input);
    const result = await measure(`procedure:${label}`, () => tutor(index).sessionPlanning.propose(input));
    results.push(result);
    return result;
  };
  const response = async (index: number, requestId: string, label: string, decision: "ACCEPT" | "REJECT" = "ACCEPT", person = 0) => {
    const { request, offer } = await current(requestId);
    const input = { requestId, offerId: offer.id, expectedVersion: request.version, clientKey: fixtureKey(label), decision,
      ...(decision === "REJECT" ? { alternative: { date: addDays(f.monday, 2), startMin: 1080, online: true } } : {}) };
    remember(f.pairs[index]!.studentUserIds[person]!, "respond", input);
    const result = await measure(`procedure:${label}`, () => student(index, person).sessionPlanning.respond(input));
    results.push(result);
    return { input, result };
  };
  const expectCode = async (label: string, code: string, operation: () => Promise<unknown>) => {
    try { await measure(`procedure:${label}`, operation); }
    catch (error) {
      assert.equal(errorCode(error), code);
      results.push({ rejected: code });
      return;
    }
    assert.fail(`Expected ${code}`);
  };
  const publish = () => planning.ensureSessionPlanningWindow(db, f.anchor);
  const certify = async (stage: string, clock: Date) => {
    const readiness = await readMaintenanceReadiness(db);
    ctx.recordPreparationEvidence(stage, readiness);
    assert.equal(readiness.openRequests, 0, "Clean warm preparation must not visit a pending negotiation.");
    if (readiness.state) assert.equal(readiness.state.triggersValid, true, "Maintenance trigger inventory is not verified.");
    if (ctx.maintenance.metadataAware) {
      const state = readiness.state;
      assert.ok(state, "Steady state not established: maintenance metadata missing.");
      const expected = planningWeeks(clock, "Asia/Shanghai");
      assert.equal(state.publicationVersion, ctx.maintenance.version, "Steady state not established: publication version.");
      assert.equal(state.settlementVersion, ctx.maintenance.version, "Steady state not established: settlement version.");
      assert.equal(state.windowStart, expected.start, "Steady state not established: publication window.");
      assert.equal(state.prepareEnd, expected.prepareEnd, "Steady state not established: preparation window.");
      assert.equal(state.timeZone, "Asia/Shanghai");
      assert.equal(state.publicationPending, 0, "Steady state not established: publication backlog remains.");
      assert.equal(state.settlementGlobalPending, 0, "Steady state not established: settlement backlog remains.");
      assert.equal(state.settlementRetryPending, 0, "Steady state not established: retry backlog remains.");
      assert.equal(state.settlementBatchActive, false, "Steady state not established: settlement batch active.");
      assert.equal(state.queuedRequests, 0);
      assert.equal(state.capturedSettlementEvents, 0);
    }
  };
  const prepareClean = async (phase: string, index: number, clock: Date) => {
    const beforeReadiness = await readMaintenanceReadiness(db);
    ctx.recordPreparationEvidence(`${phase}:before`, beforeReadiness);
    assert.equal(beforeReadiness.openRequests, 0, "Empty-request preparation cannot add baseline request visits.");
    // Capture only after initial materialization. Accelerator metadata is outside
    // this oracle; complete scheduling/audit/recovery evidence remains compared.
    const domain = await ctx.captureDomain();
    for (let pass = 1; pass <= 4; pass++) {
      const output = await measure(`setup:${phase}:fixed-pass-${pass}`, () => planning.readSessionAgenda(
        db, { id: f.pairs[index]!.tutorUserId, tutorId: f.pairs[index]!.tutorId }, "tutor", clock,
      ));
      results.push({ phase: `${phase}:fixed-pass-${pass}`, output });
      const readiness = await readMaintenanceReadiness(db);
      ctx.recordPreparationEvidence(`${phase}:after-pass-${pass}`, readiness);
      assert.equal(readiness.openRequests, 0);
    }
    const after = await ctx.captureDomain();
    assert.ok(isDeepStrictEqual(after, domain), "Clean warm preparation changed domain/audit/recovery evidence.");
    ctx.recordPreparationEvidence(`${phase}:domain-unchanged`, { identical: true });
    await certify(`${phase}:certified`, clock);
    return domain;
  };

  if (name === "cold") {
    results.push(await measure(`${ctx.transport === "domain" ? "domain" : "procedure"}:cold-tutor-agenda`, () => ctx.transport === "domain"
      ? planning.readSessionAgenda(db, { id: f.pairs[0]!.tutorUserId, tutorId: f.pairs[0]!.tutorId }, "tutor", f.anchor)
      : tutor(0).sessionPlanning.agenda({ role: "tutor" })));
    results.push(await measure(`${ctx.transport === "domain" ? "domain" : "procedure"}:after-cold-tutee-agenda`, () => ctx.transport === "domain"
      ? planning.readSessionAgenda(db, { id: f.pairs[0]!.studentUserIds[0]! }, "tutee", f.anchor)
      : student(0).sessionPlanning.agenda({ role: "tutee" })));
  } else if (name === "sunday") {
    // Real procedure callers use the wall clock. An explicit domain clock is
    // labelled separately; no Date replacement or transport/auth mock is used.
    const sunday = new Date(`${addDays(f.monday, -1)}T04:00:00Z`);
    results.push(await measure("domain:sunday-cold-agenda", () => planning.readSessionAgenda(db, { id: f.pairs[0]!.tutorUserId, tutorId: f.pairs[0]!.tutorId }, "tutor", sunday)));
    const identities = await db.sessionPlanCohort.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    results.push(await measure("domain:sunday-second-agenda", () => planning.readSessionAgenda(db, { id: f.pairs[0]!.studentUserIds[0]! }, "tutee", sunday)));
    assert.deepEqual(await db.sessionPlanCohort.findMany({ select: { id: true }, orderBy: { id: "asc" } }), identities);
    const domain = await prepareClean("sunday-clean", 0, sunday);
    results.push(await measure("domain:sunday-steady-clean-agenda", () => planning.readSessionAgenda(db, { id: f.pairs[0]!.tutorUserId, tutorId: f.pairs[0]!.tutorId }, "tutor", sunday)));
    await certify("sunday-clean:after-measurement", sunday);
    assert.ok(isDeepStrictEqual(await ctx.captureDomain(), domain), "Steady Sunday agenda changed domain/audit/recovery evidence.");
  } else if (name === "backlog") {
    const sunday = new Date(`${addDays(f.monday, -1)}T04:00:00Z`);
    results.push(await measure("setup:backlog-materialization", () => planning.ensureSessionPlanningWindow(db, sunday)));
    // Sunday publication prepares two future weeks; the next fixed Sunday adds
    // a third real generation, providing 205 distinct weekday source cohorts.
    const nextSunday = new Date(sunday.getTime() + 7 * 86_400_000);
    results.push(await measure("setup:backlog-next-window", () => planning.ensureSessionPlanningWindow(db, nextSunday)));
    const seeded = await seedRequestBacklog(db, f);
    const observer = await installBacklogWitness(db, seeded.requestIds);
    const ids = seeded.requestIds;
    // cohortId is intentionally an opaque scalar in Prisma's request model.
    // Join the real cohort as the production selection statement does.
    const snapshot = () => db.$queryRaw<{ id: string; status: string; updatedAt: Date; cohortId: string; startsAt: Date }[]>`
      SELECT request.id,request.status,request."updatedAt",request."cohortId",cohort."startsAt"
      FROM public."SessionPlanningRequest" request
      JOIN public."SessionPlanCohort" cohort ON cohort.id=request."cohortId"
      WHERE request.id=ANY(${ids}::text[]) ORDER BY request.id
    `;
    const select = (rows: Awaited<ReturnType<typeof snapshot>>, clock: Date) => rows
      .filter((row) => row.status === "PENDING" || row.status === "SPLIT_REQUESTED")
      .sort((a, b) => Number(b.startsAt <= clock) - Number(a.startsAt <= clock)
        || a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id)).slice(0, 200);
    const sign = (value: number) => value < 0 ? -1 : value > 0 ? 1 : 0;
    const witnessedSweep = async (label: string, clock: Date) => {
      const before = await snapshot();
      const expected = select([...before], clock);
      await observer.clearVisits();
      const wallBefore = Date.now();
      const count = await measure(`domain:${label}`, () => planning.sweepSessionPlanning(db, clock));
      const wallAfter = Date.now();
      const visits = await observer.readVisits();
      const after = await snapshot();
      ctx.recordPreparationEvidence(`${label}:raw-visitation`, {
        sweepClock: clock.toISOString(), count, expected: expected.map((row) => row.id),
        operationWindow: { before: new Date(wallBefore).toISOString(), after: new Date(wallAfter).toISOString() }, before, visits, after,
      });
      assert.equal(count, expected.length);
      assert.ok(count <= 200);
      assert.deepEqual(visits.map((visit) => visit.requestId), expected.map((row) => row.id), "Ordered actual request visits differ from the original 200-row selection contract.");
      const visited = new Set(visits.map((visit) => visit.requestId));
      for (const previous of before) {
        const next = after.find((row) => row.id === previous.id)!;
        if (!visited.has(previous.id)) assert.deepEqual(next, previous, "Unselected request changed.");
      }
      const clockWitnesses = visits.map((visit, ordinal) => {
        const open = visit.afterStatus === "PENDING" || visit.afterStatus === "SPLIT_REQUESTED";
        const beforeAt = visit.beforeAt.getTime(), afterAt = visit.afterAt.getTime();
        assert.ok(afterAt > beforeAt, "Selected request timestamp did not advance monotonically.");
        if (open) assert.equal(afterAt, Math.max(clock.getTime(), beforeAt + 1), "Open-request rotation lost its exact max(now, previous+1ms) clock contract.");
        else assert.ok(afterAt >= wallBefore && afterAt <= wallAfter, "Terminal request persistence clock escaped the actual operation window.");
        return { ordinal, requestId: visit.requestId, beforeStatus: visit.beforeStatus, afterStatus: visit.afterStatus,
          monotonic: true, beforeVsSweepClock: sign(beforeAt - clock.getTime()), afterVsSweepClock: sign(afterAt - clock.getTime()),
          exactOpenFairness: open ? true : null, terminalPersistenceClockWithinOperation: open ? null : true };
      });
      results.push({ phase: label, count, expectedSelection: expected.map((row) => row.id), clockWitnesses });
      return { visits, after };
    };
    try {
      const first = await witnessedSweep("backlog-future-first-200", seeded.earlierClock);
      assert.equal(first.visits.length, 200);
      assert.ok(first.after.every((row) => row.status === "SPLIT_REQUESTED"));
      const second = await witnessedSweep("backlog-future-rotation", seeded.earlierClock);
      assert.ok(second.after.every((row) => row.status === "SPLIT_REQUESTED"));
      assert.equal(new Set([...first.visits, ...second.visits].map((visit) => visit.requestId)).size, 205, "The five requests beyond the first page never received a turn.");

      const roomIds = Array.from({ length: 100 }, (_, index) => fixtureId("room", index));
      const suffix = " [synthetic-hot]";
      const beforeHot = await readMaintenanceReadiness(db);
      assert.ok(beforeHot.state, "Backlog diagnostics require the explicit shared metadata-schema control.");
      for (let cycle = 0; cycle < 6; cycle++) {
        assert.equal(await measure(`domain:backlog-hot-source-${cycle}-A`, () => db.$executeRaw`
          UPDATE public."Room" SET name=name || ${suffix} WHERE id=ANY(${roomIds}::text[])`), 100);
        assert.equal(await measure(`domain:backlog-hot-source-${cycle}-B`, () => db.$executeRaw`
          UPDATE public."Room" SET name=left(name,char_length(name)-${suffix.length}::int) WHERE id=ANY(${roomIds}::text[])`), 100);
      }
      const afterHot = await readMaintenanceReadiness(db);
      assert.ok(afterHot.state);
      ctx.recordPreparationEvidence("backlog:hot-source-events", { updates: 1200, before: beforeHot, after: afterHot });
      assert.equal(afterHot.state.publicationPending - beforeHot.state.publicationPending, 1200, "Genuine semantic room writes did not append all invalidations.");
      const visibleIds = await readPendingPublicationEventIds(db);
      const firstPage = new Set(visibleIds.slice(0, 1000));
      results.push(await measure("domain:backlog-hot-publication-pass", () => planning.ensureSessionPlanningWindow(db, f.anchor)));
      const acknowledgement = await inspectPublicationAcknowledgements(db, visibleIds);
      const acknowledgedIds = acknowledgement.filter((row) => !row.publicationPending).map((row) => row.id);
      const remainingVisibleIds = acknowledgement.filter((row) => row.publicationPending).map((row) => row.id);
      const afterPendingIds = await readPendingPublicationEventIds(db);
      ctx.recordPreparationEvidence("backlog:exact-visible-acknowledgement", { visibleIds, acknowledgedIds, remainingVisibleIds, afterPendingIds });
      assert.equal(acknowledgement.length, visibleIds.length);
      assert.ok(acknowledgedIds.length <= 1000, "Publication acknowledged more than 1000 pre-pass visible events.");
      assert.ok(acknowledgedIds.every((id) => firstPage.has(id)), "Publication consumed an event beyond its first visible 1000-ID page.");
      const afterPublication = await readMaintenanceReadiness(db);
      ctx.recordPreparationEvidence("backlog:bounded-publication-ack", afterPublication);
      assert.ok(afterPublication.state);
      if (ctx.maintenance.metadataAware) {
        assert.ok(acknowledgedIds.length > 0, "The metadata-aware publication acknowledged no visible dirty events.");
        assert.ok(remainingVisibleIds.length > 0, "One bounded pass improperly erased the entire pre-pass hot backlog.");
      }

      const selected = select(await snapshot(), f.anchor);
      assert.equal(selected.length, 200);
      const failing = selected.slice(0, 60).map((row) => row.id);
      await observer.setFailures(failing);
      const failed = await witnessedSweep("backlog-expiry-with-60-failures", f.anchor);
      assert.equal(failed.after.filter((row) => row.status === "SPLIT_REQUESTED").length, 65);
      const retryState = await readMaintenanceReadiness(db);
      ctx.recordPreparationEvidence("backlog:retry-saturation", retryState);
      if (ctx.maintenance.metadataAware) assert.ok(retryState.state && retryState.state.settlementRetryPending >= 60, "More-than-50 retry evidence was lost.");
      const repeated = await witnessedSweep("backlog-retry-and-unvisited-five", f.anchor);
      assert.equal(repeated.visits.length, 65);
      assert.equal(repeated.after.filter((row) => row.status === "SPLIT_REQUESTED").length, 60);
      await observer.setFailures([]);
      const recovered = await witnessedSweep("backlog-recovered-60", f.anchor);
      assert.equal(recovered.visits.length, 60);
      assert.ok(recovered.after.every((row) => row.status === "EXPIRED"));
      assert.equal(await db.sessionNotice.count({ where: { requestId: { in: ids }, event: "expired" } }), 615, "Failure rollback or retry duplicated/lost expiry notices.");
    } finally {
      await observer.close();
      ctx.recordPreparationEvidence("backlog:instrumentation-cleanup", { removed: true });
    }
  } else {
    // Setup publication is untimed, but its real event clocks still need a
    // bounded parity witness. The harness's setup: prefix suppresses metrics.
    const materialized = await measure("setup:publication", publish);
    if (name === "warm") {
      results.push({ phase: "initial-materialization", output: materialized });
      const domain = await prepareClean("ordinary-clean", 8, f.anchor);
      // Real HTTP/procedure handlers use their real clock. Refuse a rollover
      // instead of labelling a new publication window as a steady read.
      assert.deepEqual(planningWeeks(new Date(), "Asia/Shanghai"), planningWeeks(f.anchor, "Asia/Shanghai"), "Shared anchor crossed a planning-day/window boundary.");
      results.push(await measure("procedure:steady-clean-tutor-agenda", () => tutor(8).sessionPlanning.agenda({ role: "tutor" })));
      results.push(await measure("procedure:steady-clean-tutee-agenda", () => student(8).sessionPlanning.agenda({ role: "tutee" })));
      await certify("ordinary-clean:after-measurement", f.anchor);
      assert.ok(isDeepStrictEqual(await ctx.captureDomain(), domain), "Steady agendas changed domain/audit/recovery evidence.");
      await propose(8, "ALL", "warm-pending-offer");
      results.push(await measure("procedure:post-proposal-first-agenda", () => tutor(8).sessionPlanning.agenda({ role: "tutor" })));
      results.push(await measure("procedure:post-proposal-second-agenda", () => student(8).sessionPlanning.agenda({ role: "tutee" })));
      results.push(await measure("domain:post-proposal-publication-recheck", publish));
    } else if (name === "negotiation") {
      const first = await propose(0, "ONE", "propose-one");
      const accepted = await response(0, first.id, "accept-one");
      results.push(await measure("procedure:accept-receipt-retry", () => student(0).sessionPlanning.respond(accepted.input)));
      await expectCode("stale-response", "CONFLICT", () => student(0).sessionPlanning.respond({ ...accepted.input, clientKey: fixtureKey("stale-response") }));
      const group = await propose(2, "ALL", "propose-all");
      await response(2, group.id, "reject-with-alternative", "REJECT");
      const splitState = await current(group.id);
      const splitInput = { requestId: group.id, expectedVersion: splitState.request.version, clientKey: fixtureKey("request-split") };
      remember(f.pairs[2]!.studentUserIds[0]!, "split", splitInput);
      results.push(await measure("procedure:request-split", () => student(2).sessionPlanning.requestSplit(splitInput)));
      const latest = await current(group.id);
      const formalizeInput = { requestId: group.id, expectedVersion: latest.request.version, clientKey: fixtureKey("formalize-split") };
      remember(f.pairs[2]!.tutorUserId, "formalizeSplit", formalizeInput);
      results.push(await measure("procedure:formalize-split", () => tutor(2).sessionPlanning.formalizeSplit(formalizeInput)));
      assert.equal(await db.sessionPlanningRequest.count({ where: { parentRequestId: group.id, scope: "ONE" } }), 2);
      await propose(5, "ONE", "propose-extra", "EXTRA");
      const due = await propose(7, "ONE", "propose-deadline");
      const dueState = await current(due.id);
      const pending = dueState.offer.responses.find((row) => row.state === "PENDING");
      assert.ok(pending);
      // Transport acceptance is seeded through its real boundary, without SMTP.
      await db.$transaction((tx) => planning.markSessionResponseDelivered(tx, pending.id, f.anchor));
      const saved = await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: pending.id } });
      assert.ok(saved.deadline, "Fixture needs at least a 24-hour response window.");
      results.push(await measure("domain:deadline-before", () => planning.sweepSessionPlanning(db, new Date(saved.deadline!.getTime() - 1))));
      assert.equal((await current(due.id)).request.status, "PENDING");
      results.push(await measure("domain:deadline-at", () => planning.sweepSessionPlanning(db, saved.deadline!)));
      assert.equal((await current(due.id)).request.status, "ACCEPTED");
    } else if (name === "allocation") {
      const pair = f.pairs[9]!;
      await db.pairing.update({ where: { id: pair.id }, data: { dayOfWeek: 7, timeSlotId: null, roomId: null, roomMode: "AUTO", roomNeedsAssignment: true, roomShortageKey: "synthetic-initial-shortage" } });
      await db.roomUnavailability.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ roomId: fixtureId("room", index), dayOfWeek: 7, startMin: 900, endMin: 945 })) });
      let row = await db.pairing.findUniqueOrThrow({ where: { id: pair.id } });
      results.push(await measure("procedure:retry-room-still-short", () => admin.admin.retryRoomAllocation({ id: row.id, expectedRoomVersion: row.roomVersion })));
      row = await db.pairing.findUniqueOrThrow({ where: { id: pair.id } });
      const notifications = await db.notification.count();
      results.push(await measure("procedure:retry-unchanged-shortage", () => admin.admin.retryRoomAllocation({ id: row.id, expectedRoomVersion: row.roomVersion })));
      assert.equal(await db.notification.count(), notifications);
      await db.roomUnavailability.deleteMany({ where: { roomId: fixtureId("room", 99) } });
      row = await db.pairing.findUniqueOrThrow({ where: { id: pair.id } });
      results.push(await measure("procedure:retry-room-available", () => admin.admin.retryRoomAllocation({ id: row.id, expectedRoomVersion: row.roomVersion })));
      const save = f.pairs[10]!;
      const before = await db.pairing.findUniqueOrThrow({ where: { id: save.id } });
      results.push(await measure("procedure:tutor-schedule-save", () => tutor(10).tutor.setPairingSlot({ pairingId: save.id, slotId: f.alternateSlotId, expectedRoomVersion: before.roomVersion })));
      await expectCode("stale-schedule-save", "CONFLICT", () => tutor(10).tutor.setPairingSlot({ pairingId: save.id, slotId: f.slotId, expectedRoomVersion: before.roomVersion }));
      const bulkIds = f.pairs.slice(20, 30).map((pair) => pair.id);
      await db.pairing.updateMany({ where: { id: { in: bulkIds } }, data: { roomId: null, roomMode: "AUTO", roomNeedsAssignment: true, roomShortageKey: "synthetic-bulk-shortage" } });
      const targets = (await db.pairing.findMany({ where: { id: { in: bulkIds } }, orderBy: { id: "asc" } })).map((row) => ({ id: row.id, expectedRoomVersion: row.roomVersion }));
      const untouched = await db.pairing.findMany({ where: { id: { in: bulkIds } }, orderBy: { id: "asc" } });
      await expectCode("bulk-stale-rejection", "CONFLICT", () => admin.admin.autoAssignUnassignedRooms({ targets: targets.map((target, index) => index === targets.length - 1 ? { ...target, expectedRoomVersion: target.expectedRoomVersion + 1 } : target) }));
      assert.deepEqual(await db.pairing.findMany({ where: { id: { in: bulkIds } }, orderBy: { id: "asc" } }), untouched);
      results.push(await measure("procedure:bulk-ten-units", () => admin.admin.autoAssignUnassignedRooms({ targets })));
      const createInput = { clientKey: fixtureKey("creation"), tutorId: f.pairs[99]!.tutorId, subject: "Profile Mathematics", subjectId: f.subjectId, timeSlotId: f.alternateSlotId, tuteeIds: [], roomMode: "AUTO" as const };
      const created = await measure("procedure:pairing-create", () => admin.admin.createPairing(createInput));
      ctx.pairingCreations.push({ actorId: f.adminId, clientKey: createInput.clientKey, input: createInput, resultId: created.id });
      const retried = await measure("procedure:pairing-create-retry", () => admin.admin.createPairing(createInput));
      assert.equal(retried.id, created.id);
      results.push(created, retried);
      // Reuse the already-issued context/client after a live demotion. The
      // production middleware must refresh authority for this exact request.
      const cached = tutor(11);
      await db.user.update({ where: { id: f.pairs[11]!.tutorUserId }, data: { role: "VIEWER" } });
      try {
        await expectCode("permission-refresh-after-demotion", "FORBIDDEN", () => cached.tutor.setPairingSlot({ pairingId: f.pairs[11]!.id, slotId: f.slotId }));
      } finally {
        await db.user.update({ where: { id: f.pairs[11]!.tutorUserId }, data: { role: "TUTOR" } });
      }
    } else if (name === "catalog") {
      const pair = f.pairs[2]!;
      const attendanceDate = addDays(f.monday, -7);
      await db.session.create({ data: { id: fixtureId("historical-session"), date: new Date(`${attendanceDate}T07:00:00Z`), startMin: 900, endMin: 945, month: attendanceDate.slice(0, 7), schoolYear: f.schoolYear, quarter: "Q1", durationMin: 45, shFactor: 1, shCount: 0.75, pairingId: pair.id, tutorId: pair.tutorId, timeSlotId: f.slotId, actualRoomId: pair.roomId } });
      const base = { id: f.slotId, label: "Synthetic catalog", dayOfWeek: 1, startMin: 900, endMin: 945, active: true };
      results.push(await measure("procedure:catalog-label-only", () => admin.admin.updateTimeSlot(base)));
      results.push(await measure("procedure:catalog-weekday", () => admin.admin.updateTimeSlot({ ...base, dayOfWeek: 4 })));
      assert.equal((await db.session.findUniqueOrThrow({ where: { id: fixtureId("historical-session") } })).date.toISOString(), `${attendanceDate}T07:00:00.000Z`);
      results.push(await measure("procedure:catalog-clock-and-attendance", () => admin.admin.updateTimeSlot({ ...base, dayOfWeek: 4, startMin: 930, endMin: 975 })));
      assert.equal((await db.session.findUniqueOrThrow({ where: { id: fixtureId("historical-session") } })).startMin, 930);
    } else if (name === "contention") {
      for (const concurrency of [2, 4]) {
        const agendas = await drain(Array.from({ length: concurrency }, (_, index) => () => measure(`procedure:concurrent-${concurrency}-agenda`, () => tutor(index + 10).sessionPlanning.agenda({ role: "tutor" }))));
        results.push({ concurrency, agendas });
      }
      const pair = f.pairs[12]!;
      const row = await db.pairing.findUniqueOrThrow({ where: { id: pair.id } });
      const competing = await Promise.allSettled([
        measure("procedure:competing-schedule-a", () => tutor(12).tutor.setPairingSlot({ pairingId: pair.id, slotId: f.slotId, expectedRoomVersion: row.roomVersion })),
        measure("procedure:competing-schedule-b", () => tutor(12).tutor.setPairingSlot({ pairingId: pair.id, slotId: f.slotId, expectedRoomVersion: row.roomVersion })),
      ]);
      assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = competing.find((result) => result.status === "rejected");
      assert.ok(rejected?.status === "rejected");
      assert.equal(errorCode(rejected.reason), "CONFLICT");
      // Both competing intents are identical. Which request acquires the fence
      // first may vary; the durable tuple and one-success/one-conflict contract do not.
      results.push({ competing: competing.map((result) => result.status === "fulfilled" ? { status: result.status, value: result.value } : { status: result.status, code: errorCode(result.reason) }).sort((a, b) => a.status.localeCompare(b.status)) });
      const target = f.pairs[40]!;
      await db.pairing.update({ where: { id: target.id }, data: { roomId: null, roomNeedsAssignment: true, roomShortageKey: "synthetic-contended-shortage", timeSlotId: null, dayOfWeek: 2, startMin: 1080, endMin: 1125 } });
      const shortage = await db.pairing.findUniqueOrThrow({ where: { id: target.id } });
      const heldRoom = fixtureId("room", 0);
      const offers = await propose(41, "ONE", "contention-pending-room", "RESCHEDULE", heldRoom);
      const offerState = await current(offers.id);
      const offersInput = { requestId: offers.id, offerId: offerState.offer.id, expectedVersion: offerState.request.version, clientKey: fixtureKey("contention-accept"), decision: "ACCEPT" as const };
      remember(f.pairs[41]!.studentUserIds[0]!, "respond", offersInput);
      results.push(await drain([
        () => measure("procedure:contended-bulk", () => admin.admin.autoAssignUnassignedRooms({ targets: [{ id: shortage.id, expectedRoomVersion: shortage.roomVersion }] })),
        () => measure("procedure:contended-acceptance", () => student(41).sessionPlanning.respond(offersInput)),
      ]));
      assert.notEqual((await db.pairing.findUniqueOrThrow({ where: { id: target.id } })).roomId, heldRoom);
    }
  }
  // Persist populated supplemental enrollment evidence using existing Prisma
  // delegates. This is fixture provenance, excluded from latency measurements.
  const continuationPlans = await db.sessionPlan.findMany({ where: { assignments: { some: { pairingId: f.pairs[98]!.id } } }, select: { id: true } });
  await db.sessionPlanContinuationMember.createMany({ data: continuationPlans.flatMap((plan) => f.pairs[98]!.tuteeIds.map((tuteeId, person) => ({ planId: plan.id, pairingId: f.pairs[98]!.id, tuteeId, assignmentId: fixtureId("continuation", person), joinedAt: f.anchor }))), skipDuplicates: true });
  return { scenario: name, results };
}

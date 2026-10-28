// Synthetic, in-process CPU comparison of actual Git-baseline and working-tree
// allocators. No database, server, installs, network, or algorithm substitutions.
// Node 24: node scripts/benchmark-room-allocation.mjs --baseline <gitref> --output <path>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  assert.ok(["--baseline", "--output"].includes(args[index]), `Unknown option: ${args[index]}`);
  assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `Missing value for ${args[index]}`);
  assert.ok(!options.has(args[index]), `Repeated option: ${args[index]}`);
  options.set(args[index], args[index + 1]);
}
assert.ok(options.has("--baseline") && options.has("--output"), "Required: --baseline <gitref> --output <path>");
const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const baselineRevision = git("rev-parse", "--verify", "--end-of-options", `${options.get("--baseline")}^{commit}`).trim();
const currentRevision = git("rev-parse", "HEAD").trim();
const sha256 = (source) => createHash("sha256").update(source).digest("hex");
const sourceMetadata = {};
function loadSource(variant, path) {
  const source = variant === "baseline"
    ? git("show", `${baselineRevision}:${path}`)
    : readFileSync(resolve(root, path), "utf8");
  sourceMetadata[`${variant}:${path}`] = { path, sha256: sha256(source) };
  return source;
}
function extract(source, name) {
  // Repository top-level function closing braces begin at column zero. Fail
  // loudly if that source shape changes instead of benchmarking a hand-copy.
  const match = source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\b[\\s\\S]*?^}`, "m"));
  assert.ok(match, `Missing function: ${name}`);
  return match[0].replace(/^export /, "");
}
class SyntheticTRPCError extends Error {
  constructor(options) {
    super(options.message);
    this.code = options.code;
  }
}
const noop = async () => {};
function allocator(variant) {
  const roomSource = loadSource(variant, "src/server/room-allocation.ts");
  const rankSource = loadSource(variant, "src/lib/room-allocation.ts");
  const participantSource = /(?:export )?async function participantKeys\b/.test(roomSource)
    ? roomSource
    : loadSource(variant, "src/server/session-planning/participants.ts");
  const compiled = stripTypeScriptTypes([
    extract(rankSource, "rankRoomCandidates"),
    extract(roomSource, "assertRoomVersion"),
    extract(participantSource, "participantKeys"),
    extract(roomSource, "shortageSignature"),
    extract(roomSource, "allocateRoom"),
  ].join("\n"), { mode: "strip" });
  const fn = new Function(
    "lockPlannedRoomSchedule", "assertTutorScheduleAvailable", "assertPlannedRoomAvailable",
    "getFeatures", "datedUnavailableRooms", "TRPCError",
    `${compiled}\nreturn allocateRoom;`,
  )(
    noop,
    noop,
    async (db, booking) => {
      if (db.guardChecks) db.guardChecks.push(booking.roomId);
      if (db.conflictingRoom === booking.roomId && booking.roomId)
        throw new SyntheticTRPCError({ code: "CONFLICT", message: "Synthetic final room conflict" });
    },
    async (db) => ({ AUTO_ASSIGN_ROOMS: db.enabled !== false }),
    async () => new Set(),
    SyntheticTRPCError,
  );
  return { fn, extractedSha256: sha256(compiled), datedGuardPresent: roomSource.includes("await datedUnavailableRooms(") };
}
const baseline = allocator("baseline");
const current = allocator("current");

const schedule = Object.freeze({
  id: "synthetic-changing-pairing", termId: "synthetic-term", tutorId: "tutor-0",
  tuteeIds: Object.freeze(["student-0", "student-1", "student-2"]),
  dayOfWeek: 7, startMin: 600, endMin: 645, scheduleConfirmed: true,
});
const currentAllocation = Object.freeze({
  roomMode: "AUTO", roomId: null, roomNeedsAssignment: false,
  roomShortageKey: null, roomVersion: 1,
});
function fixture(rooms, bookings = [], data = {}) {
  // Fake reads return fixture rows immediately. Neither PostgreSQL query work nor
  // Prisma serialization/connection latency is represented by these functions.
  return {
    enabled: data.enabled ?? true,
    room: { findMany: async () => rooms, count: async () => 1 },
    pairing: { findMany: async () => bookings },
    roomUnavailability: { findMany: async () => (data.blocks ?? []).map((roomId) => ({ roomId })) },
    user: { findMany: async () => data.users ?? [] },
    tutorProfileOwnership: { findMany: async () => data.tutorOwnership ?? [] },
    studentProfileOwnership: { findMany: async () => data.studentOwnership ?? [] },
  };
}
function booking(id, roomId, tutorId = "other", tuteeIds = [], minutes = 45, groupId = null) {
  return { id, roomId, tutorId, groupId, dayOfWeek: 2, startMin: 480, endMin: 480 + minutes,
    tutees: tuteeIds.map((tuteeId) => ({ tuteeId })) };
}
async function resultOf(fn) {
  try { return { ok: true, result: await fn() }; }
  catch (error) { return { ok: false, code: error.code, message: error.message }; }
}
let parityChecks = 0;
const semanticChecks = [];
async function semanticCase(name, db, input, intent, previous, expected) {
  const first = await resultOf(() => baseline.fn(db, input, intent, previous));
  const second = await resultOf(() => current.fn(db, input, intent, previous));
  assert.deepEqual(second, first, `Baseline/current mismatch: ${name}`);
  assert.deepEqual(first, expected, `Unexpected semantic result: ${name}`);
  semanticChecks.push({ name, result: first });
  parityChecks++;
}
const assigned = (roomId, roomOutcome = "ASSIGNED", roomMode = "AUTO") => ({ ok: true, result: {
  roomId, roomMode, roomOutcome, roomNeedsAssignment: false, roomShortageKey: null,
} });
const smallRooms = [{ id: "a" }, { id: "b" }];
for (const [firstMinutes, lastMinutes, selected] of [[120, 30, "a"], [30, 120, "b"]]) {
  await semanticCase(`interleaved-group-last-value-${firstMinutes}-${lastMinutes}`,
    fixture(smallRooms, [booking("first", "a", "other", [], firstMinutes, "shared"),
      booking("other", "b", "other", [], 90), booking("last", "a", "other", [], lastMinutes, "shared")]),
    schedule, {}, currentAllocation, assigned(selected));
}
await semanticCase("canonical-alias-and-duplicate-current-tutees",
  fixture(smallRooms, [booking("alias", "a", "other", ["old-a"]), booking("tutor", "b", "tutor-0")], {
    users: [{ id: "one-person", tutorId: null, studentId: "student-0" }],
    studentOwnership: [{ tuteeId: "old-a", userId: "one-person" }, { tuteeId: "student-1", userId: "one-person" }],
  }), { ...schedule, tuteeIds: ["student-0", "student-1", "student-0"] }, {}, currentAllocation, assigned("b"));
await semanticCase("same-person-across-tutor-and-tutee-roles",
  fixture(smallRooms, [booking("alias", "a", "other", ["old-a"]), booking("alternative", "b", "other", ["student-2"])], {
    users: [{ id: "one-person", tutorId: "tutor-0", studentId: "student-0" }],
    studentOwnership: [{ tuteeId: "old-a", userId: "one-person" }],
  }), schedule, {}, currentAllocation, assigned("a"));
await semanticCase("retains-room-before-better-familiarity",
  fixture(smallRooms, [booking("familiar", "b", "tutor-0", [...schedule.tuteeIds])]),
  schedule, {}, { ...currentAllocation, roomId: "a" }, assigned("a", "RETAINED"));
await semanticCase("moves-away-from-blackout",
  fixture(smallRooms, [], { blocks: ["a"] }), schedule, {}, { ...currentAllocation, roomId: "a" }, assigned("b", "MOVED"));
await semanticCase("intentional-none", fixture(smallRooms), schedule, {},
  { ...currentAllocation, roomMode: "NONE" }, assigned(null, "NONE", "NONE"));
await semanticCase("fixed-choice", fixture(smallRooms), schedule, { roomMode: "FIXED", roomId: "b" },
  currentAllocation, assigned("b", "ASSIGNED", "FIXED"));
await semanticCase("legacy-default-adopts-auto", fixture(smallRooms), schedule, {},
  { ...currentAllocation, roomMode: "LEGACY" }, assigned("a"));
// The prior LEGACY/null default intentionally adopts AUTO unless preserveLegacy
// is passed. This verifies the real default-mode branch rather than a mock mode.
const guardDb = fixture(smallRooms);
guardDb.guardChecks = [];
guardDb.conflictingRoom = "a";
await semanticCase("selected-room-still-reaches-final-guard", guardDb, schedule, {}, currentAllocation,
  { ok: false, code: "CONFLICT", message: "Synthetic final room conflict" });
assert.deepEqual(guardDb.guardChecks, ["a", "a"]);
parityChecks++;

function scaleFixture(roomCount, bookingCount) {
  const rooms = Array.from({ length: roomCount }, (_, index) => ({ id: `room-${String(index).padStart(4, "0")}` }));
  const bookings = Array.from({ length: bookingCount }, (_, index) => {
    const reservation = Math.floor(index / (roomCount * 2));
    const room = index % roomCount;
    const startMin = 480 + reservation % 6 * 45;
    return {
      id: `booking-${index}`, groupId: index % 5 === 0 ? `group-${reservation}-${room}` : null,
      roomId: rooms[room].id, tutorId: `tutor-${index % Math.max(80, roomCount)}`,
      dayOfWeek: 1 + reservation % 5, startMin, endMin: startMin + 45,
      tutees: Array.from({ length: 3 }, (_, person) => ({ tuteeId: `student-${(index * 3 + person) % 2000}` })),
    };
  });
  const tutorIds = [...new Set([schedule.tutorId, ...bookings.map((row) => row.tutorId)])];
  const studentIds = [...new Set([...schedule.tuteeIds, ...bookings.flatMap((row) => row.tutees.map((person) => person.tuteeId))])];
  const users = [
    ...tutorIds.map((id) => ({ id: `person-${id}`, tutorId: id, studentId: null })),
    ...studentIds.map((id) => ({ id: `person-${id}`, tutorId: null, studentId: id })),
  ];
  return { rooms, bookings, db: fixture(rooms, bookings, { users }) };
}
const variants = { baseline: baseline.fn, current: current.fn };
const results = [];
let sink = 0;
for (const [roomCount, bookingCount, repetitions] of [[20, 200, 30], [50, 2000, 10], [100, 10000, 3]]) {
  const data = scaleFixture(roomCount, bookingCount);
  for (const mode of ["candidate-allocation", "retained-room-control"]) {
    const previous = mode === "retained-room-control"
      ? { ...currentAllocation, roomId: data.rooms[0].id } : currentAllocation;
    const expected = await baseline.fn(data.db, schedule, {}, previous);
    assert.equal(expected.roomOutcome, mode === "retained-room-control" ? "RETAINED" : "ASSIGNED");
    const timings = { baseline: [], current: [] };
    // One warmup batch, five measured batches; alternating order within each
    // pair limits systematic order bias. All output assertions run after timing.
    for (let sample = -1; sample < 5; sample++) {
      const order = sample % 2 === 0 ? ["current", "baseline"] : ["baseline", "current"];
      for (const variant of order) {
        const outputs = [];
        const started = performance.now();
        for (let repeat = 0; repeat < repetitions; repeat++) outputs.push(await variants[variant](data.db, schedule, {}, previous));
        const perOperationMs = (performance.now() - started) / repetitions;
        for (const output of outputs) {
          assert.deepEqual(output, expected, `${variant}/${mode}/${roomCount}/${bookingCount}`);
          sink += output.roomId.length;
          parityChecks++;
        }
        if (sample >= 0) timings[variant].push(perOperationMs);
      }
    }
    const summarize = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { minMs: sorted[0], medianMs: sorted[2], maxMs: sorted[4], samples: 5, repetitionsPerSample: repetitions, orderedSamplesMs: values };
    };
    results.push({ rooms: roomCount, bookings: bookingCount, rosterRowsPerBooking: 3, mode,
      allocation: expected, baseline: summarize(timings.baseline), current: summarize(timings.current) });
  }
}
// Reject live edits during this run; never label mixed source as one measurement.
for (const [key, metadata] of Object.entries(sourceMetadata)) {
  if (key.startsWith("current:")) assert.equal(sha256(readFileSync(resolve(root, metadata.path), "utf8")), metadata.sha256, `Source changed during benchmark: ${metadata.path}`);
}
const report = {
  generatedAt: new Date().toISOString(), baselineRevision, currentRevision,
  baselineArgument: options.get("--baseline"), workingTree: git("status", "--short"),
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
  sourceMetadata, extractedFunctions: { baselineSha256: baseline.extractedSha256, currentSha256: current.extractedSha256 },
  datedGuardPresent: { baseline: baseline.datedGuardPresent, current: current.datedGuardPresent },
  methodology: {
    source: "Actual allocateRoom, canonical participantKeys, assertRoomVersion, shortageSignature and rankRoomCandidates from each source revision. Only exports/type syntax are removed; neither allocator algorithm is string-rewritten.",
    boundaries: "Locks and tutor guard are no-ops; final room guard is a shared no-op except its explicit synthetic rejection test; feature read returns a synthetic flag; datedUnavailableRooms returns an empty Set. Synthetic TransactionDb reads resolve immediately. No PostgreSQL, Prisma engine, dated occupancy computation, persistence, notification delivery, network or real request timing.",
    timing: "One warmup batch and five alternating measured batch pairs; fixture construction, source extraction/compilation and assertions excluded. Full AllocationResult equality asserted for every operation. Fresh internal room index on every allocation; no GC forcing. Retained-room control bypasses ranking/index construction.",
    oldHarnessCountercheck: "Same 20/200, 50/2000, 100/10000 scales and three roster rows per booking as outputs/language-performance/scheduler/benchmark.mjs; weekday-7 target versus weekday-1-to-5 bookings forces scoring. Unlike that exploratory harness, both alternatives are actual source. Current fixture adds genuine repeated group rows and uses 45-minute intervals. Participant-key construction and promise overhead remain inside timing, so this is not a scoring-only graph.",
    limitations: "Synthetic sensitivity scales are not observed production load. Five samples do not establish production p95. Local hardware/runtime can differ from deployment. If datedGuardPresent differs, module graphs differ at that stub boundary and the comparison is not solely the index patch. No other-language or website-wide speedup is measured.",
  },
  parityChecks, semanticChecks, results, sink,
};
const outputPath = resolve(root, options.get("--output"));
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, baselineRevision, currentRevision, parityChecks, scenarios: results.length }, null, 2));

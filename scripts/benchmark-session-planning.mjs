import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

// Read-only source loading: no checkout, install, application startup or database.
// Example: node scripts/benchmark-session-planning.mjs --baseline <commit> \
//   --output outputs/language-performance/implementation/compute.json
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireDependency = createRequire(import.meta.url);
const ts = requireDependency("typescript");
const zod = requireDependency("zod");
const samples = 5;
const sourcePaths = [
  "src/i18n/config.ts",
  "src/lib/program-calendar.ts",
  "src/lib/school-calendar.ts",
  "src/lib/program-time.ts",
  "src/lib/session-planning.ts",
  "src/lib/session-calendar.ts",
  "src/server/session-planning/index.ts",
];

function argumentsForRun(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") return { help: true };
    assert.ok(["--baseline", "--output"].includes(flag), `Unknown flag: ${flag}`);
    const value = args[++index];
    assert.ok(value && !value.startsWith("--"), `Missing value for ${flag}`);
    assert.equal(result[flag.slice(2)], undefined, `Repeated flag: ${flag}`);
    result[flag.slice(2)] = value;
  }
  assert.ok(result.baseline, "Pass --baseline <Git commit/ref containing session planning>.");
  return result;
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalized = (value) => JSON.parse(JSON.stringify(value));
const fingerprint = (value) => hash(JSON.stringify(value));
const parity = { boundaryComparisons: 0, scenarioComparisons: 0, explicitContracts: 0 };

function sourceSet(label, commit) {
  const sources = new Map();
  for (const name of sourcePaths) {
    try {
      sources.set(
        name,
        commit ? git(["show", `${commit}:${name}`]) : readFileSync(path.join(root, name), "utf8"),
      );
    } catch (error) {
      throw new Error(`${label} is missing required actual source ${name}: ${error.message}`);
    }
  }
  const hashes = Object.fromEntries([...sources].map(([name, text]) => [name, hash(text)]));
  const factories = new Map();
  for (const [name, text] of sources) {
    if (name.startsWith("src/server/")) continue;
    const compiled = ts.transpileModule(text, {
      fileName: name,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      reportDiagnostics: true,
    });
    const errors = compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? [];
    assert.equal(errors.length, 0, `Cannot transpile ${label}:${name}`);
    factories.set(name, new Script(
      `(function(require, module, exports, __filename, __dirname) {\n${compiled.outputText}\n})`,
      { filename: `${label}:${name}` },
    ).runInThisContext());
  }

  // Extract the actual fingerprint argument from each version, rather than a
  // hand-copied replacement. The surrounding database service is never loaded.
  const server = ts.createSourceFile(
    "session-planning.ts", sources.get("src/server/session-planning/index.ts"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const reconcile = server.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "reconcileOrdinaryPlans",
  );
  assert.ok(reconcile?.body, `${label}: reconcileOrdinaryPlans was not found`);
  const expressions = [];
  function findScheduleHash(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(server) === "scheduleHash") {
      const call = node.initializer;
      assert.ok(call && ts.isCallExpression(call) && call.expression.getText(server) === "fingerprint",
        `${label}: scheduleHash is no longer a fingerprint call`);
      assert.equal(call.arguments.length, 1);
      expressions.push(call.arguments[0].getText(server));
    }
    ts.forEachChild(node, findScheduleHash);
  }
  findScheduleHash(reconcile.body);
  assert.equal(expressions.length, 1, `${label}: expected one scheduleHash expression`);
  const scheduleHashExpression = expressions[0];
  const scheduleHash = new Function(
    "fingerprint", "resolvePlanningTimetableDay", "schedule", "timeZone", "overrides", "calendar",
    `return fingerprint(${scheduleHashExpression});`,
  );

  function instantiate() {
    const modules = new Map();
    function load(name) {
      if (modules.has(name)) return modules.get(name).exports;
      const factory = factories.get(name);
      assert.ok(factory, `${label}: module import is outside the pure source allowlist: ${name}`);
      const loadedModule = { exports: {} };
      modules.set(name, loadedModule);
      const localRequire = (request) => {
        if (request === "zod") return zod;
        let target;
        if (request.startsWith("~/")) target = `src/${request.slice(2)}`;
        else if (request.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(name), request));
        else throw new Error(`${label}:${name}: undeclared dependency ${request}`);
        if (!target.endsWith(".ts")) target += ".ts";
        return load(target);
      };
      factory(localRequire, loadedModule, loadedModule.exports, name, path.posix.dirname(name));
      return loadedModule.exports;
    }
    return {
      time: load("src/lib/program-time.ts"),
      school: load("src/lib/school-calendar.ts"),
      planning: load("src/lib/session-planning.ts"),
      calendar: load("src/lib/session-calendar.ts"),
    };
  }

  return { label, hashes, instantiate, scheduleHash, scheduleHashExpression };
}

function operation(source, api, overrides) {
  // These are the actual public after APIs/call pattern. No source substitution.
  // New operation-owned caches, including their construction, are timed on every run.
  const optimized = source.label === "after";
  const calendar = optimized ? api.school.createSchoolCalendarSnapshot(overrides) : null;
  const parse = optimized ? api.time.createProgramDateTimeParser() : api.time.parseProgramDateTime;
  return {
    parse,
    resolve: optimized ? calendar.resolve : (date) => api.planning.resolvePlanningCalendarDay(date, overrides),
    window: (input, zone) => optimized
      ? api.planning.plannedWindow(input, zone, parse)
      : api.planning.plannedWindow(input, zone),
    scheduleHash: (schedule, zone) => source.scheduleHash(
      fingerprint, api.planning.resolvePlanningCalendarDay, schedule, zone, overrides, calendar,
    ),
  };
}

function outcome(fn) {
  try { return { ok: true, value: normalized(fn()) }; }
  catch (error) {
    return {
      ok: false,
      name: error.name,
      message: error.message,
      ...(error.issues ? { issues: normalized(error.issues) } : {}),
    };
  }
}

function compare(actual, expected, label, category) {
  assert.deepEqual(normalized(actual), normalized(expected), label);
  parity[category]++;
}

function boundaries(source) {
  const api = source.instantiate();
  const overrides = Object.freeze([
    Object.freeze({ date: "2026-11-01", isSchoolDay: true, timetableWeekday: 2, scheduleRevision: 4 }),
    Object.freeze({ date: "2026-11-02", isSchoolDay: false, version: 5 }),
    Object.freeze({ date: "2026-11-03", isSchoolDay: false, active: false, scheduleRevision: 6 }),
    Object.freeze({ date: "2026-11-02", isSchoolDay: true, timetableWeekday: 5, scheduleRevision: 99 }),
  ]);
  const op = operation(source, api, overrides);
  const cases = [
    ["midnight end", () => op.window({ date: "2026-11-01", startMin: 1395 }, "Asia/Shanghai")],
    ["physical room", () => op.window({ date: "2026-11-01", startMin: 900, roomId: "A" }, "Asia/Shanghai")],
    ["online clears room", () => op.window({ date: "2026-11-01", startMin: 900, roomId: "B", online: true }, "Asia/Shanghai")],
    ["invalid date", () => op.window({ date: "2026-02-30", startMin: 900 }, "Asia/Shanghai")],
    ["invalid start", () => op.window({ date: "2026-11-01", startMin: 1396 }, "Asia/Shanghai")],
    ["half-hour DST gap", () => op.window({ date: "2026-10-04", startMin: 105 }, "Australia/Lord_Howe")],
    ["after half-hour DST", () => op.window({ date: "2026-10-04", startMin: 180 }, "Australia/Lord_Howe")],
    ["DST gap", () => op.parse("2026-03-08T02:30", "America/New_York")],
    ["DST repeated time", () => op.parse("2026-11-01T01:30", "America/New_York")],
    ["half-hour zone", () => op.parse("2026-01-01T09:30", "Asia/Kolkata")],
    ["summer offset", () => op.parse("2026-07-01T09:30", "America/New_York")],
    ["winter offset", () => op.parse("2026-01-01T09:30", "America/New_York")],
    ["invalid clock", () => op.parse("2026-02-01T25:30", "UTC")],
    ["invalid zone", () => op.parse("2026-01-01T09:30", "PST")],
    ["DST day end", () => api.time.programDayEnd("2026-03-08", "America/New_York")],
    ["midnight transition", () => api.time.programDayEnd("2026-09-05", "America/Santiago")],
    ["missing civil date", () => api.time.programDayStart("2011-12-30", "Pacific/Apia")],
    ["Sunday preparation", () => api.planning.planningWeeks(new Date("2026-11-01T04:00:00Z"), "Asia/Shanghai")],
    ...["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-02-30"].map((date) => [
      `calendar ${date}`, () => op.resolve(date),
    ]),
    ["fingerprint A", () => op.scheduleHash({ dayOfWeek: 2, startMin: 900, roomId: "A" }, "Asia/Shanghai")],
    ["fingerprint B", () => op.scheduleHash({ dayOfWeek: 2, startMin: 900, roomId: "B" }, "Asia/Shanghai")],
  ];
  const results = [];
  for (const [name, fn] of cases) results.push({ name, first: outcome(fn), second: outcome(fn) });
  for (const name of ["DST gap", "DST repeated time", "half-hour DST gap", "missing civil date", "invalid date", "invalid start"]) {
    assert.equal(results.find((entry) => entry.name === name).first.ok, false, `${source.label}: ${name} must fail`);
    parity.explicitContracts++;
  }
  assert.equal(results.find((entry) => entry.name === "midnight end").first.value.endsAt, "2026-11-01T16:00:00.000Z");
  assert.equal(results.find((entry) => entry.name === "online clears room").first.value.roomId, null);
  parity.explicitContracts += 2;
  const mutable = op.parse("2026-01-01T09:30", "Asia/Kolkata");
  mutable.setTime(0);
  const freshDate = op.parse("2026-01-01T09:30", "Asia/Kolkata").toISOString();
  assert.equal(freshDate, "2026-01-01T04:00:00.000Z");
  parity.explicitContracts++;

  const updated = overrides.map((row) => ({ ...row,
    ...(row.date === "2026-11-01" ? { timetableWeekday: 3, scheduleRevision: 5 } : {}),
  }));
  const next = operation(source, api, updated);
  const oldHash = op.scheduleHash({ dayOfWeek: 2, startMin: 900, roomId: "A" }, "Asia/Shanghai");
  const nextHash = next.scheduleHash({ dayOfWeek: 2, startMin: 900, roomId: "A" }, "Asia/Shanghai");
  assert.notEqual(nextHash, oldHash);
  assert.equal(op.resolve("2026-11-01").calendarRevision, 4);
  assert.equal(next.resolve("2026-11-01").calendarRevision, 5);
  assert.equal(op.resolve("2026-11-02").isSchoolDay, false);
  assert.equal(op.resolve("2026-11-03").calendarRevision, 6);
  parity.explicitContracts += 5;

  // Full escaped/folded output parity covers long UTF-8 lines, escaping and cancellations.
  const calendarEvents = events(3);
  calendarEvents[0].location = "Room\\East;A,B\r\n" + "辅导课🙂".repeat(30);
  calendarEvents[1].cancelled = true;
  const calendar = api.calendar.renderSessionCalendar(calendarEvents);
  const invalidEvents = [
    [...calendarEvents, calendarEvents[0]],
    [{ ...calendarEvents[0], revision: -1 }],
    [{ ...calendarEvents[0], endsAt: calendarEvents[0].startsAt }],
    [{ ...calendarEvents[0], startsAt: new Date(Number.NaN) }],
  ].map((value) => outcome(() => api.calendar.renderSessionCalendar(value)));
  assert.ok(invalidEvents.every((entry) => !entry.ok));
  assert.ok(calendar.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
  parity.explicitContracts += 2;
  return { results, freshDate, oldHash, nextHash, updatedDate: next.resolve("2026-11-01"), calendar, invalidEvents };
}

function addDays(date, offset) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

const overrides = Object.freeze([
  ...Array.from({ length: 100 }, (_, index) => Object.freeze({
    date: addDays("2025-01-01", index), isSchoolDay: false, version: 1,
  })),
  Object.freeze({ date: "2026-10-31", isSchoolDay: true, timetableWeekday: 2, scheduleRevision: 2 }),
]);

function events(count) {
  return Array.from({ length: count }, (_, index) => ({
    uid: `commitment-${index}@shbs-session`,
    revision: index % 5 + 1,
    startsAt: new Date(Date.UTC(2026, 10, 2, 7) + index * 3_600_000),
    endsAt: new Date(Date.UTC(2026, 10, 2, 7, 45) + index * 3_600_000),
    updatedAt: new Date("2026-10-29T00:00:00Z"),
    cancelled: index % 11 === 0,
    location: `Room ${index % 20}`,
  }));
}

function workloads() {
  const result = [];
  for (const groups of [100, 500]) {
    result.push({
      name: `calendar-fingerprint-${groups}-groups`,
      fixture: { groups, overrides: overrides.length },
      scope: "Actual extracted scheduleHash argument; group-specific JSON and SHA-256 retained. No database reconciliation.",
      run(source, api) {
        const op = operation(source, api, overrides);
        return Array.from({ length: groups }, (_, group) => op.scheduleHash({
          dayOfWeek: group % 5 + 1,
          startMin: [900, 960, 1020][group % 3],
          roomId: `room-${group % 20}`,
        }, "Asia/Shanghai"));
      },
    });
    for (const days of [14, 21]) result.push({
      name: `publication-window-${groups}-groups-${days}-days`,
      fixture: { groups, days, overrides: overrides.length, startSlots: [900, 960, 1020], timeZone: "Asia/Shanghai" },
      scope: "Fresh generation keys assumed; actual date/window functions and caller cache lifetimes. No DB, lock, term bounds, roster/conflict validation, notices or writes.",
      run(source, api) {
        const op = operation(source, api, overrides);
        const calendarDays = [];
        const windows = [];
        for (let group = 0; group < groups; group++) {
          for (let offset = 0; offset < days; offset++) {
            const date = api.planning.addPlanningDays("2026-10-26", offset);
            const day = op.resolve(date);
            calendarDays.push({ group, ...day });
            if (!day.isSchoolDay || day.effectiveTimetableWeekday !== group % 5 + 1) continue;
            windows.push({ group, ...op.window({
              date, startMin: [900, 960, 1020][group % 3], roomId: `room-${group % 20}`, online: false,
            }, "Asia/Shanghai") });
          }
        }
        return { calendarDays, windows };
      },
    });
  }
  for (const uniqueInputs of [8, 128]) result.push({
    name: `strict-parse-128-calls-${uniqueInputs}-unique-inputs`,
    fixture: { calls: 128, uniqueInputs, timeZone: "America/New_York" },
    scope: uniqueInputs === 128 ? "Unique-key control: no exact-input memo hits; formatter reuse only plus cache overhead." : "Repeated successful parses with a new operation-owned parser on every run.",
    run(source, api) {
      const op = operation(source, api, []);
      return Array.from({ length: 128 }, (_, index) => op.parse(
        `${addDays("2026-11-02", index % uniqueInputs)}T15:00`, "America/New_York",
      ));
    },
  });
  for (const count of [20, 300, 5000]) {
    const fixture = events(count);
    result.push({
      name: `icalendar-${count}-events-short-fields`,
      fixture: { events: count, location: "Short ASCII room label; other fixed bilingual calendar lines remain actual source." },
      scope: "Actual complete ICS serializer; input construction and database/feed authorization excluded. Compare every output byte.",
      run(_source, api) { return api.calendar.renderSessionCalendar(fixture); },
    });
  }
  return result;
}

function outputSummary(output) {
  if (typeof output === "string") return { utf8Bytes: Buffer.byteLength(output), sha256: hash(output) };
  if (Array.isArray(output)) return { items: output.length, sha256: fingerprint(output) };
  return { calendarCalls: output.calendarDays.length, windows: output.windows.length, sha256: fingerprint(output) };
}

function runBenchmark(before, after) {
  const results = [];
  for (const definition of workloads()) {
    const expected = definition.run(before, before.instantiate());
    for (const mode of ["cold-module-formatters", "warm-module-formatters"]) {
      const modules = new Map([before, after].map((source) => [source.label, source.instantiate()]));
      const timings = new Map([before, after].map((source) => [source.label, []]));
      // One untimed warmup per side/mode. Cold mode discards its module afterwards;
      // warm mode retains only module-global Intl state, not operation caches.
      for (const source of [before, after]) compare(
        definition.run(source, modules.get(source.label)), expected,
        `${definition.name}/${mode}/${source.label}/warmup`, "scenarioComparisons",
      );
      for (let round = 0; round < samples; round++) {
        const order = round % 2 ? [after, before] : [before, after];
        for (const source of order) {
          const api = mode === "cold-module-formatters" ? source.instantiate() : modules.get(source.label);
          const started = performance.now();
          const actual = definition.run(source, api);
          const elapsed = performance.now() - started;
          // Serialization, full equality assertions and report hashing are untimed.
          compare(actual, expected, `${definition.name}/${mode}/${source.label}/${round}`, "scenarioComparisons");
          timings.get(source.label).push(elapsed);
        }
      }
      const variants = Object.fromEntries([before, after].map((source) => {
        const values = timings.get(source.label);
        const sorted = [...values].sort((a, b) => a - b);
        return [source.label, { samples: values.length, sampleMs: values, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) }];
      }));
      results.push({ name: definition.name, mode, fixture: definition.fixture, scope: definition.scope,
        output: outputSummary(expected), variants,
        medianSpeedup: variants.before.medianMs / variants.after.medianMs,
        medianSavedMs: variants.before.medianMs - variants.after.medianMs,
      });
    }
  }
  return results;
}

const args = argumentsForRun(process.argv.slice(2));
if (args.help) {
  console.log("Usage: node scripts/benchmark-session-planning.mjs --baseline <gitref> [--output outputs/language-performance/implementation/result.json]\nPure compute only; requires actual scheduling sources in baseline and working tree. No checkout, installs, server or DB.");
} else {
  const baselineCommit = git(["rev-parse", "--verify", "--end-of-options", `${args.baseline}^{commit}`]).trim();
  const afterCommit = git(["rev-parse", "HEAD"]).trim();
  const before = sourceSet("before", baselineCommit);
  const after = sourceSet("after");
  const afterProbe = after.instantiate();
  assert.equal(typeof afterProbe.time.createProgramDateTimeParser, "function", "After requires actual createProgramDateTimeParser API");
  assert.equal(typeof afterProbe.school.createSchoolCalendarSnapshot, "function", "After requires actual createSchoolCalendarSnapshot API");
  const beforeBoundaries = boundaries(before);
  const afterBoundaries = boundaries(after);
  compare(afterBoundaries, beforeBoundaries, "Complete boundary outputs, errors and revision/fingerprint parity", "boundaryComparisons");
  const results = runBenchmark(before, after);
  for (const [name, expectedHash] of Object.entries(after.hashes)) {
    assert.equal(hash(readFileSync(path.join(root, name), "utf8")), expectedHash, `Working source changed during benchmark: ${name}`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    baseline: { requestedRef: args.baseline, commit: baselineCommit, sourceHashes: before.hashes, scheduleHashExpression: before.scheduleHashExpression },
    after: { commit: afterCommit, source: "Actual working-tree modules; may include uncommitted changes", sourceHashes: after.hashes,
      status: git(["status", "--short", "--", ...sourcePaths]).trim(), scheduleHashExpression: after.scheduleHashExpression },
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
      typescript: ts.version, zod: requireDependency("zod/package.json").version },
    parity,
    boundaryOutputSha256: fingerprint(beforeBoundaries),
    methodology: {
      source: "Actual before Git blob and after working-tree module bodies transpiled to CommonJS using installed TypeScript; restricted local loader permits only listed pure modules and installed Zod. No speculative source replacements. Server scheduleHash argument extracted with the TypeScript AST.",
      timing: "One untimed warmup and five interleaved timed operations per side/scenario/cache mode. Source loading, TypeScript compilation and module initialization excluded; operation-owned parser/calendar cache creation included. All complete outputs/errors compared outside timing; report digests are evidence summaries, not substitutes for equality assertions.",
      cacheModes: "cold-module-formatters creates fresh module-global JS caches for each measured operation; warm-module-formatters retains module Intl caches after one warmup. Every operation creates new parser/calendar snapshots. Cold does not mean a cold OS/ICU/JIT/process, and baseline may have no module caches.",
      fixtures: "Synthetic 100/500 groups, three repeated start slots, one program zone, 101 overrides including a Saturday make-up day; not observed production scale. Separate unique-input parse control and full UTF-8/invalid/calendar-revision boundary comparisons.",
    },
    limitations: [
      "Pure computation, not full publication/agenda/proposal/feed latency or a native-language benchmark.",
      "Database queries, locks, source/ownership/conflict fences, SMTP, rendering, writes and host contention are excluded.",
      "Fresh publication keys assumed; normal unchanged publication can bypass plannedWindow. Fingerprint preparation is a separate workload; do not sum unrelated medians into app latency.",
      "Five samples are illustrative medians/ranges, not p95 or statistical confidence. Node/OS/CPU can differ from production Node 22/Linux.",
      "Repeated-slot memo benefits depend on actual input reuse; unique-key workloads can add cache overhead.",
    ],
    results,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) {
    const output = path.resolve(root, args.output);
    const ownedRoot = path.resolve(root, "outputs/language-performance/implementation");
    const relative = path.relative(ownedRoot, output);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "--output must be inside outputs/language-performance/implementation/");
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, json);
  }
  process.stdout.write(json);
}

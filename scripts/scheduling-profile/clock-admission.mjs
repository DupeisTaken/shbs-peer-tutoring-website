import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

export const CLOCK_ADMISSION_POLICY = Object.freeze({
  version: 1,
  timeZone: "Asia/Shanghai",
  minimumRunwayMs: 3 * 60 * 60 * 1000,
  maximumCampaignMs: 12 * 60 * 60 * 1000,
  maximumDeclarationAgeMs: 60 * 1000,
});

// Apply every day, including Sundays and holidays: makeup calendars and explicit
// Sunday/domain scenarios do not justify exemptions. Leave 30 minutes on either
// side of midnight and the complete 15:00–18:45 fixture lesson band.
const WINDOWS = Object.freeze([
  Object.freeze({ name: "morning", startMinute: 30, endMinute: 14 * 60 + 30 }),
  Object.freeze({ name: "evening", startMinute: 19 * 60 + 15, endMinute: 23 * 60 + 30 }),
]);
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLOCK_ADMISSION_POLICY.timeZone,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** @typedef {string | Date} Instant */
/** @typedef {{version:number,timeZone:string,anchor:string,localDate:string,window:string,intervalStart:string,intervalEnd:string,campaignDeadline:string,minimumRunwayMs:number,maximumCampaignMs:number}} ClockAdmission */
/** @typedef {{schemaVersion:1,policyVersion:number,timeZone:string,evaluatedAt:string,status:"ADMITTED",anchor:string,clockAdmission:ClockAdmission}|{schemaVersion:1,policyVersion:number,timeZone:string,evaluatedAt:string,status:"DEFERRED",nextEligibleAt:string,reason:string}} ClockCampaignPlan */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireCondition(condition, message) {
  if (!condition) throw new Error(`Clock admission: ${message}`);
}

/** Strict canonical UTC strings avoid Date.parse's rollover/locale ambiguity.
 * @param {unknown} value @param {string} label */
function instant(value, label) {
  if (value instanceof Date) {
    requireCondition(Number.isFinite(value.getTime()), `${label} is invalid`);
    return value.getTime();
  }
  requireCondition(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
    `${label} must be a canonical UTC ISO instant`);
  const milliseconds = Date.parse(value);
  requireCondition(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value,
    `${label} is invalid`);
  return milliseconds;
}

/** @param {number} milliseconds */
function localParts(milliseconds) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(milliseconds))
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** @param {number} milliseconds */
function localDay(milliseconds) {
  const local = localParts(milliseconds);
  // Current Shanghai has no DST. Verify the IANA result instead of silently
  // treating historical/nonstandard offsets as the supported campaign policy.
  const midnight = Date.parse(`${local.date}T00:00:00.000+08:00`);
  requireCondition(localParts(midnight).date === local.date && localParts(midnight).minute === 0,
    "unsupported Shanghai calendar offset");
  return { local, midnight };
}

/** @param {unknown} anchor @returns {ClockAdmission} */
function intervalForAnchor(anchor) {
  const milliseconds = instant(anchor, "anchor");
  const { local, midnight } = localDay(milliseconds);
  const window = WINDOWS.find((entry) => milliseconds >= midnight + entry.startMinute * 60_000
    && milliseconds <= midnight + entry.endMinute * 60_000);
  requireCondition(window, "anchor is outside the guarded Shanghai intervals (00:30–14:30, 19:15–23:30)");
  const intervalStart = midnight + window.startMinute * 60_000;
  const intervalEnd = midnight + window.endMinute * 60_000;
  const deadline = Math.min(intervalEnd, milliseconds + CLOCK_ADMISSION_POLICY.maximumCampaignMs);
  requireCondition(deadline - milliseconds >= CLOCK_ADMISSION_POLICY.minimumRunwayMs,
    "anchor has less than three hours of campaign runway");
  return Object.freeze({
    version: CLOCK_ADMISSION_POLICY.version,
    timeZone: CLOCK_ADMISSION_POLICY.timeZone,
    anchor: new Date(milliseconds).toISOString(),
    localDate: local.date,
    window: window.name,
    intervalStart: new Date(intervalStart).toISOString(),
    intervalEnd: new Date(intervalEnd).toISOString(),
    campaignDeadline: new Date(deadline).toISOString(),
    minimumRunwayMs: CLOCK_ADMISSION_POLICY.minimumRunwayMs,
    maximumCampaignMs: CLOCK_ADMISSION_POLICY.maximumCampaignMs,
  });
}

/** Declare once at the real matrix clock. Explicit observedAt is for pure tests;
 * the CLI always supplies actual time. Later report validation never redeclares.
 * @param {Instant} anchor @param {Instant} [observedAt] */
export function createClockAdmission(anchor, observedAt = new Date()) {
  const certificate = intervalForAnchor(anchor);
  const now = instant(observedAt, "observedAt");
  const anchorMs = instant(anchor, "anchor");
  requireCondition(now >= anchorMs, "anchor is in the future");
  requireCondition(now - anchorMs <= CLOCK_ADMISSION_POLICY.maximumDeclarationAgeMs,
    "matrix anchor must be the actual current instant, not a backdated campaign");
  requireCondition(instant(certificate.campaignDeadline, "deadline") - now >= CLOCK_ADMISSION_POLICY.minimumRunwayMs,
    "declaration has less than three hours remaining");
  return certificate;
}

/** Plan from an actual observation without backdating or inventing a future
 * measurement anchor. Deferral is an immediate receipt, never a wait/retry loop.
 * @param {Instant} [now] @returns {ClockCampaignPlan} */
export function planClockCampaign(now = new Date()) {
  const milliseconds = instant(now, "now");
  const evaluatedAt = new Date(milliseconds).toISOString();
  const { midnight } = localDay(milliseconds);
  const common = {
    schemaVersion: /** @type {const} */ (1),
    policyVersion: CLOCK_ADMISSION_POLICY.version,
    timeZone: CLOCK_ADMISSION_POLICY.timeZone,
    evaluatedAt,
  };
  const firstWindow = WINDOWS[0];
  requireCondition(firstWindow, "declaration window inventory is empty");
  let next = midnight + 24 * 60 * 60 * 1000 + firstWindow.startMinute * 60_000;
  for (const window of WINDOWS) {
    const start = midnight + window.startMinute * 60_000;
    const latest = midnight + window.endMinute * 60_000 - CLOCK_ADMISSION_POLICY.minimumRunwayMs;
    if (milliseconds < start) {
      next = start;
      break;
    }
    if (milliseconds <= latest) {
      const clockAdmission = createClockAdmission(evaluatedAt, evaluatedAt);
      return Object.freeze({ ...common, status: "ADMITTED", anchor: evaluatedAt, clockAdmission });
    }
  }
  const nextEligibleAt = new Date(next).toISOString();
  // Verify the next date's IANA offset and exact admission too; never publish an
  // unsupported future instant as a usable next slot.
  intervalForAnchor(nextEligibleAt);
  return Object.freeze({
    ...common, status: "DEFERRED", nextEligibleAt,
    reason: "Outside the Shanghai declaration slots 00:30–11:30 and 19:15–20:30; no measurement anchor was issued.",
  });
}

/** Historical replay is independent of the current clock. Require the same
 * admission for every diagnostic, latency and native report, including failures.
 * @param {{anchor:unknown,startedAt:unknown,finishedAt:unknown}} report
 * @param {unknown} [certificate] */
export function validateClockAdmission(report, certificate) {
  const expected = intervalForAnchor(report.anchor);
  if (certificate !== undefined)
    requireCondition(isDeepStrictEqual(certificate, expected), "certificate differs from the anchor's exact admission");
  const start = instant(report.startedAt, "startedAt");
  const finish = instant(report.finishedAt, "finishedAt");
  requireCondition(start >= instant(expected.anchor, "anchor"), "report starts before its anchor");
  requireCondition(finish >= start, "report finishes before it starts");
  requireCondition(start <= instant(expected.campaignDeadline, "deadline")
    && finish <= instant(expected.campaignDeadline, "deadline"), "report crosses the campaign deadline");
  requireCondition(localParts(start).date === expected.localDate && localParts(finish).date === expected.localDate,
    "report crosses the Shanghai calendar day");
  return expected;
}

/** Check before starting a command, separately from its actual final receipt.
 * This worst-case endpoint is a budget calculation, never a claimed finish time.
 * @param {{anchor:Instant,startedAt:Instant,timeoutMs:number}} operation
 * @param {ClockAdmission} [certificate] */
export function validateClockAdmissionBudget(operation, certificate) {
  requireCondition(Number.isSafeInteger(operation.timeoutMs) && operation.timeoutMs > 0
    && operation.timeoutMs <= CLOCK_ADMISSION_POLICY.maximumCampaignMs, "invalid command timeout budget");
  const start = instant(operation.startedAt, "startedAt");
  return validateClockAdmission({
    anchor: operation.anchor, startedAt: operation.startedAt,
    finishedAt: new Date(start + operation.timeoutMs),
  }, certificate);
}

/** Validate process and PostgreSQL clocks independently against one admission.
 * Their relative ordering is deliberately unspecified; these are distinct clocks.
 * @param {unknown} report */
export function validateReportClocks(report) {
  requireCondition(isRecord(report), "report must be an evidence record");
  const fixture = report.fixture;
  requireCondition(isRecord(fixture) && isRecord(fixture.clockAdmission), "report is missing its fixture clock admission");
  const databaseClock = report.databaseClock;
  requireCondition(isRecord(databaseClock), "report is missing PostgreSQL start/finish clock evidence");
  const certificate = validateClockAdmission({
    anchor: fixture.anchor, startedAt: report.startedAt, finishedAt: report.finishedAt,
  }, fixture.clockAdmission);
  validateClockAdmission({
    anchor: fixture.anchor,
    startedAt: databaseClock.startedAt,
    finishedAt: databaseClock.finishedAt,
  }, certificate);
  return certificate;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

// --anchor remains strict. --plan returns a deferral receipt without creating
// an anchor, sleeping, starting a runner, or changing source control.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const flag = process.argv[2];
    requireCondition(process.argv.length === 3 && typeof flag === "string" && ["--anchor", "--plan"].includes(flag), "usage: clock-admission.mjs --anchor|--plan");
    const now = new Date();
    process.stdout.write((flag === "--plan"
      ? JSON.stringify(planClockCampaign(now))
      : createClockAdmission(now, now).anchor) + "\n");
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : "Clock admission failed") + "\n");
    process.exitCode = 1;
  }
}

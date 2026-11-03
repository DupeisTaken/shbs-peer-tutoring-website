import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOCK_ADMISSION_POLICY, createClockAdmission, planClockCampaign, validateClockAdmission, validateClockAdmissionBudget, validateReportClocks } from "./clock-admission.mjs";

const utc = (local: string) => new Date(`${local}+08:00`).toISOString();
const declare = (local: string) => {
  const anchor = utc(local);
  return createClockAdmission(anchor, anchor);
};

void test("guarded Shanghai windows retain three-hour runway and the twelve-hour cap", () => {
  const morning = declare("2026-11-03T00:30:00.000");
  assert.equal(morning.window, "morning");
  assert.equal(morning.campaignDeadline, utc("2026-11-03T12:30:00.000"));
  assert.equal(morning.intervalEnd, utc("2026-11-03T14:30:00.000"));
  assert.equal(declare("2026-11-03T11:30:00.000").campaignDeadline, utc("2026-11-03T14:30:00.000"));
  const evening = declare("2026-11-03T19:15:00.000");
  assert.equal(evening.window, "evening");
  assert.equal(evening.campaignDeadline, utc("2026-11-03T23:30:00.000"));
  assert.equal(declare("2026-11-03T20:30:00.000").minimumRunwayMs, 3 * 3_600_000);
  for (const local of ["00:29:59.999", "11:30:00.001", "14:30:00.000", "18:45:00.000", "19:14:59.999", "20:30:00.001", "23:30:00.000", "23:59:59.999"])
    assert.throws(() => declare(`2026-11-03T${local}`), /Clock admission/);
});

void test("07:00Z reproduction and both sides of the full lesson band are rejected", () => {
  for (const value of ["2026-11-03T06:58:38.877Z", "2026-11-03T07:00:00.000Z", "2026-11-03T07:00:03.694Z", "2026-11-03T10:45:00.000Z"])
    assert.throws(() => createClockAdmission(value, value), /outside the guarded/);
  const admitted = declare("2026-11-03T11:30:00.000");
  assert.throws(() => validateClockAdmission({ anchor: admitted.anchor, startedAt: "2026-11-03T06:58:38.877Z", finishedAt: "2026-11-03T07:00:07.171Z" }, admitted), /campaign deadline/);
});

void test("report endpoints are inclusive within guards, ordered, and cannot precede the anchor", () => {
  const certificate = declare("2026-11-03T11:30:00.000");
  const exact = { anchor: certificate.anchor, startedAt: certificate.anchor, finishedAt: certificate.campaignDeadline };
  assert.deepEqual(validateClockAdmission(exact, certificate), certificate);
  assert.throws(() => validateClockAdmission({ ...exact, startedAt: utc("2026-11-03T11:29:59.999") }), /before its anchor/);
  assert.throws(() => validateClockAdmission({ ...exact, finishedAt: utc("2026-11-03T14:30:00.001") }), /campaign deadline/);
  assert.throws(() => validateClockAdmission({ ...exact, startedAt: utc("2026-11-03T12:00:00.000"), finishedAt: utc("2026-11-03T11:59:59.999") }), /finishes before/);
  assert.throws(() => validateClockAdmission(exact, { ...certificate, campaignDeadline: utc("2026-11-03T15:00:00.000") }), /certificate differs/);
  assert.throws(() => validateClockAdmission(exact, { ...certificate, anchor: utc("2026-11-03T11:29:59.999") }), /certificate differs/);
});

void test("Monday, Sunday, makeup days and holidays have the same conservative admission", () => {
  for (const day of ["2026-11-02", "2026-11-08", "2026-10-01", "2026-10-10"]) {
    const certificate = declare(`${day}T19:15:00.000`);
    assert.equal(certificate.localDate, day);
    assert.deepEqual(validateClockAdmission({ anchor: certificate.anchor, startedAt: utc(`${day}T19:20:00.000`), finishedAt: utc(`${day}T23:30:00.000`) }), certificate);
    assert.throws(() => declare(`${day}T15:00:00.000`), /outside the guarded/);
  }
});

void test("Shanghai midnight and Sunday-to-Monday rollover cannot enter one campaign", () => {
  const certificate = declare("2026-11-08T19:15:00.000");
  assert.throws(() => validateClockAdmission({ anchor: certificate.anchor, startedAt: utc("2026-11-08T23:29:00.000"), finishedAt: utc("2026-11-09T00:00:00.000") }), /campaign deadline/);
  assert.throws(() => declare("2026-11-09T00:00:00.000"), /outside the guarded/);
  assert.notEqual(declare("2026-11-09T00:30:00.000").localDate, certificate.localDate);
  // UTC's prior date is valid; the calendar admission is explicitly Shanghai.
  assert.equal(declare("2026-11-09T00:30:00.000").anchor, "2026-11-08T16:30:00.000Z");
});

void test("declaration checks actual current time while historical replay ignores today's clock", () => {
  const anchor = utc("2026-11-03T10:00:00.000");
  const certificate = createClockAdmission(anchor, utc("2026-11-03T10:00:01.000"));
  assert.throws(() => createClockAdmission(anchor, utc("2026-11-03T09:59:59.999")), /future/);
  assert.throws(() => createClockAdmission(anchor, utc("2026-11-03T10:01:00.001")), /backdated/);
  assert.throws(() => createClockAdmission(utc("2026-11-03T11:30:00.000"), utc("2026-11-03T11:30:00.001")), /three hours remaining/);
  assert.deepEqual(validateClockAdmission({ anchor, startedAt: utc("2026-11-03T10:10:00.000"), finishedAt: utc("2026-11-03T13:00:00.000") }, certificate), certificate);
  const realNow = new Date();
  assert.throws(() => createClockAdmission(new Date(realNow.getTime() + 24 * 3_600_000), realNow), /Clock admission/);
});

void test("invalid/ambiguous instant strings and invalid Date objects fail closed", () => {
  const valid = utc("2026-11-03T10:00:00.000");
  for (const bad of ["", "not-a-date", "2026-11-03", "2026-11-03T10:00:00+08:00", "2026-11-03T02:00:00Z", "2026-02-30T02:00:00.000Z", "2026-11-03T24:00:00.000Z", "2026-11-03T02:00:00.000Z trailing", new Date(Number.NaN)]) {
    assert.throws(() => createClockAdmission(bad, valid), /Clock admission/);
    assert.throws(() => validateClockAdmission({ anchor: valid, startedAt: bad, finishedAt: valid }), /Clock admission/);
  }
});

void test("native, diagnostic and latency command budgets share the same worst-case guard", () => {
  const certificate = declare("2026-11-03T19:15:00.000");
  for (const timeoutMs of [90_000, 150_000, 300_000]) {
    assert.deepEqual(validateClockAdmissionBudget({ anchor: certificate.anchor, startedAt: utc("2026-11-03T22:00:00.000"), timeoutMs }, certificate), certificate);
    assert.throws(() => validateClockAdmissionBudget({ anchor: certificate.anchor, startedAt: utc("2026-11-03T23:29:59.999"), timeoutMs }, certificate), /campaign deadline/);
  }
  assert.deepEqual(validateClockAdmissionBudget({ anchor: certificate.anchor, startedAt: utc("2026-11-03T23:27:30.000"), timeoutMs: 150_000 }, certificate), certificate);
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, CLOCK_ADMISSION_POLICY.maximumCampaignMs + 1])
    assert.throws(() => validateClockAdmissionBudget({ anchor: certificate.anchor, startedAt: certificate.anchor, timeoutMs }), /invalid command timeout/);
  const morning = declare("2026-11-03T00:30:00.000");
  assert.throws(() => validateClockAdmission({ anchor: morning.anchor, startedAt: morning.anchor, finishedAt: utc("2026-11-03T12:30:00.001") }), /campaign deadline/);
});

void test("every report requires the exact certificate and independent PostgreSQL clock evidence", () => {
  const certificate = declare("2026-11-03T19:15:00.000");
  const report = {
    fixture: { anchor: certificate.anchor, clockAdmission: certificate },
    startedAt: utc("2026-11-03T20:00:00.000"),
    finishedAt: utc("2026-11-03T20:01:00.000"),
    databaseClock: { startedAt: utc("2026-11-03T19:59:59.000"), finishedAt: utc("2026-11-03T20:01:01.000") },
  };
  // Database start can precede process start and finish can follow process finish.
  assert.deepEqual(validateReportClocks(report), certificate);
  assert.throws(() => validateReportClocks({ ...report, fixture: { anchor: certificate.anchor } }), /missing its fixture/);
  assert.throws(() => validateReportClocks({ ...report, databaseClock: undefined }), /missing PostgreSQL/);
  assert.throws(() => validateReportClocks({ ...report, fixture: { ...report.fixture, clockAdmission: { ...certificate, window: "changed" } } }), /certificate differs/);
  assert.throws(() => validateReportClocks({ ...report, databaseClock: { ...report.databaseClock, finishedAt: utc("2026-11-03T23:30:00.001") } }), /campaign deadline/);
  assert.throws(() => validateReportClocks({ ...report, databaseClock: { ...report.databaseClock, startedAt: utc("2026-11-03T19:14:59.999") } }), /before its anchor/);
  assert.throws(() => validateReportClocks({ ...report, databaseClock: { startedAt: report.databaseClock.finishedAt, finishedAt: report.databaseClock.startedAt } }), /finishes before/);
  assert.throws(() => validateReportClocks({ ...report, databaseClock: { ...report.databaseClock, finishedAt: "invalid" } }), /canonical UTC/);
  assert.throws(() => validateReportClocks({ ...report, finishedAt: utc("2026-11-04T00:00:00.000") }), /campaign deadline/);
  for (const value of [null, [], {}, new Date(), { fixture: null }, { fixture: { clockAdmission: [] } }])
    assert.throws(() => validateReportClocks(value), /Clock admission/);
});

void test("campaign planner admits exact declaration endpoints without issuing future anchors", () => {
  for (const local of ["00:30:00.000", "11:30:00.000", "19:15:00.000", "20:30:00.000"]) {
    const now = utc(`2026-11-03T${local}`);
    const plan = planClockCampaign(now);
    assert.equal(plan.status, "ADMITTED");
    assert.ok(plan.status === "ADMITTED");
    assert.equal(plan.anchor, now);
    assert.equal(plan.evaluatedAt, now);
    assert.deepEqual(plan.clockAdmission, createClockAdmission(now, now));
    assert.equal("nextEligibleAt" in plan, false);
  }
});

void test("campaign deferral finds the true next slot across all gaps and day boundaries", () => {
  for (const [local, next] of [
    ["2026-11-03T00:00:00.000", "2026-11-03T00:30:00.000"],
    ["2026-11-03T00:29:59.999", "2026-11-03T00:30:00.000"],
    ["2026-11-03T11:30:00.001", "2026-11-03T19:15:00.000"],
    ["2026-11-03T14:30:00.000", "2026-11-03T19:15:00.000"],
    ["2026-11-03T15:00:00.000", "2026-11-03T19:15:00.000"],
    ["2026-11-03T19:14:59.999", "2026-11-03T19:15:00.000"],
    ["2026-11-03T20:30:00.001", "2026-11-04T00:30:00.000"],
    ["2026-11-03T23:59:59.999", "2026-11-04T00:30:00.000"],
    ["2026-10-31T20:31:00.000", "2026-11-01T00:30:00.000"],
    ["2026-11-08T20:31:00.000", "2026-11-09T00:30:00.000"],
    ["2026-12-31T23:59:59.999", "2027-01-01T00:30:00.000"],
  ]) {
    assert.ok(local && next);
    const now = utc(local), expected = utc(next);
    const plan = planClockCampaign(now);
    assert.ok(plan.status === "DEFERRED");
    assert.equal(plan.nextEligibleAt, expected);
    assert.equal(plan.evaluatedAt, now);
    assert.match(plan.reason, /no measurement anchor/);
    assert.equal("anchor" in plan, false);
    assert.equal("clockAdmission" in plan, false);
    assert.throws(() => createClockAdmission(plan.nextEligibleAt, now), /future/);
    const prior = planClockCampaign(new Date(Date.parse(expected) - 1));
    assert.ok(prior.status === "DEFERRED");
    assert.equal(prior.nextEligibleAt, expected);
    assert.equal(planClockCampaign(expected).status, "ADMITTED");
  }
  for (const bad of ["invalid", "2026-02-30T00:00:00.000Z", new Date(Number.NaN)])
    assert.throws(() => planClockCampaign(bad), /Clock admission/);
});

void test("Nov3 before/after 15:00 selects Nov3 versus Nov10 even with the same fence order", () => {
  // Mirrors scheduledCohort's earliest SCHEDULED startsAt > actual now query.
  // The retained hosted source evidence has the same tutor, term, fingerprint,
  // room and participants; only the selected originalDate/cohort identity changes.
  const common = { tutorId: "same-tutor", termId: "same-term", sourceFingerprint: "same-fingerprint", contentionOrder: "bulk-before-acceptance" };
  const cohorts = [
    { ...common, id: "cohort-nov3", originalDate: "2026-11-03", startsAt: utc("2026-11-03T15:00:00.000"), status: "SCHEDULED" },
    { ...common, id: "cohort-nov10", originalDate: "2026-11-10", startsAt: utc("2026-11-10T15:00:00.000"), status: "SCHEDULED" },
  ];
  const before = "2026-11-03T06:59:59.999Z", after = "2026-11-03T07:00:00.001Z";
  const earliestFuture = (now: string) => cohorts.filter((row) => row.status === "SCHEDULED" && Date.parse(row.startsAt) > Date.parse(now))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))[0];
  assert.deepEqual(earliestFuture(before), cohorts[0]);
  assert.deepEqual(earliestFuture(after), cohorts[1]);
  assert.equal(earliestFuture(before)?.contentionOrder, earliestFuture(after)?.contentionOrder);
  assert.equal(planClockCampaign(before).status, "DEFERRED");
  assert.equal(planClockCampaign(after).status, "DEFERRED");
  // Latest possible morning deadline is 14:30; earliest evening anchor is
  // 19:15. These extrema cover both allowed windows, independent of fence order.
  for (const certificate of [declare("2026-11-03T11:30:00.000"), declare("2026-11-03T19:15:00.000")]) {
    for (const observation of [before, after]) {
      const report = {
        ...common, fixture: { anchor: certificate.anchor, clockAdmission: certificate },
        startedAt: observation, finishedAt: observation,
        databaseClock: { startedAt: observation, finishedAt: observation },
        selectedCohort: earliestFuture(observation),
      };
      assert.throws(() => validateReportClocks(report), /campaign deadline|before its anchor/);
    }
  }
});

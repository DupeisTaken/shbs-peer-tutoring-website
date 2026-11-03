import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCURRENT_CASES,
  assertAgendaResult,
  assertDeadlineReturns,
  assertSplitOutcome,
} from "./concurrent-scenarios";

void test("the supplementary contract declares every workload, actual role and transport independently", () => {
  assert.deepEqual(Object.keys(CONCURRENT_CASES), [
    "cold",
    "sunday",
    "proposal-split",
    "acceptance",
    "deadline",
    "two-readers",
  ]);
  assert.deepEqual(CONCURRENT_CASES, {
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
        {
          operation: "deadline:first",
          role: "maintenance",
          transport: "domain",
        },
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
  });
  const operations = Object.values(CONCURRENT_CASES).flatMap((spec) =>
    spec.calls.map((call) => call.operation),
  );
  assert.equal(new Set(operations).size, 12);
});

const child = (person: string) => ({
  scope: "ONE",
  status: "PENDING",
  participantIds: [person],
});

void test("split validation requires the complete persisted roster and never mutates read or recovery order", () => {
  const children = Object.freeze([
    Object.freeze({
      ...child("second"),
      participantIds: Object.freeze(["second"]),
    }),
    Object.freeze({
      ...child("first"),
      participantIds: Object.freeze(["first"]),
    }),
  ]);
  assertSplitOutcome("SPLIT", children, Object.freeze(["first", "second"]));
  assert.deepEqual(
    children.map((row) => row.participantIds),
    [["second"], ["first"]],
  );
});

void test("a returned split ID cannot stand in for a completed parent transition", () => {
  for (const status of ["PENDING", "SPLIT_REQUESTED", "ACCEPTED", "EXPIRED"]) {
    assert.throws(() =>
      assertSplitOutcome(status, [child("one"), child("two")], ["one", "two"]),
    );
  }
});

void test("split validation refuses missing, duplicated, foreign or extra child commitments", () => {
  const people = ["one", "two"];
  for (const children of [
    [child("one")],
    [child("one"), child("one")],
    [child("one"), child("foreign")],
    [child("one"), child("two"), child("extra")],
  ])
    assert.throws(() => assertSplitOutcome("SPLIT", children, people));
  assert.throws(() =>
    assertSplitOutcome(
      "SPLIT",
      [child("one"), { ...child("two"), participantIds: ["two", "one"] }],
      people,
    ),
  );
  assert.throws(() =>
    assertSplitOutcome(
      "SPLIT",
      [child("one"), { ...child("two"), participantIds: "two" }],
      people,
    ),
  );
});

void test("child scope and pending consent are substantive split postconditions", () => {
  assert.throws(() =>
    assertSplitOutcome(
      "SPLIT",
      [child("one"), { ...child("two"), scope: "ALL" }],
      ["one", "two"],
    ),
  );
  for (const status of ["ACCEPTED", "CANCELLED", "EXPIRED"]) {
    assert.throws(() =>
      assertSplitOutcome(
        "SPLIT",
        [child("one"), { ...child("two"), status }],
        ["one", "two"],
      ),
    );
  }
});

void test("a successful-looking empty agenda is not concurrent publication evidence", () => {
  for (const result of [
    undefined,
    null,
    {},
    { cohorts: [] },
    { cohorts: null },
    { status: "OK" },
  ]) {
    assert.throws(() => assertAgendaResult(result));
  }
  const agenda = Object.freeze({
    cohorts: Object.freeze([{ id: "real-cohort" }]),
  });
  assertAgendaResult(agenda);
});

void test("deadline results retain both real visitor counts rather than normalizing race variants", () => {
  assertDeadlineReturns(Object.freeze([1, 1]));
  for (const result of [[1, 0], [0, 1], [0, 0], [1], [1, 1, 1], [1, "1"]]) {
    assert.throws(() => assertDeadlineReturns(result));
  }
});

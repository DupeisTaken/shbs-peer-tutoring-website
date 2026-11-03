import assert from "node:assert/strict";
import { test } from "node:test";
import { createProfiler } from "../scheduling-profile/metrics";
import { createWave } from "./wave";

const group = { role: "tutor", transport: "domain" as const };
const period = [
  ["SELECT pg_advisory_xact_lock(hashtextextended(", ", 0))"],
  "program:period",
];
const due = {
  strings: [
    'SELECT r.id FROM "SessionPlanningRequest" r LEFT JOIN "SessionPlanningOffer" o ON true WHERE s.deadline<=',
    ' ORDER BY r."updatedAt",r.id LIMIT 200',
  ],
};
void test("second operation begins only after its peer acquired the actual bound period fence", async () => {
  const profiler = createProfiler("latency");
  try {
    const wave = createWave(profiler);
    let peerStarted!: () => void;
    const peer = new Promise<void>((resolve) => {
      peerStarted = resolve;
    });
    const output = await wave.runWave(
      [
        {
          ...group,
          operation: "primary",
          run: async () => {
            await wave.observe("execute", period, async () => 1);
            await peer;
            return "primary-result";
          },
        },
        {
          ...group,
          operation: "peer",
          run: async () => {
            peerStarted();
            return "peer-result";
          },
        },
      ],
      "first-period",
    );
    assert.deepEqual(output, ["primary-result", "peer-result"]);
    const { witness, calls } = wave.receipt();
    assert.ok(
      witness.firstAcquiredOffsetMs !== undefined &&
        witness.firstAcquiredOffsetMs <= calls[1]!.startedOffsetMs,
    );
    assert.ok(calls[1]!.startedOffsetMs < calls[0]!.finishedOffsetMs);
  } finally {
    profiler.close();
  }
});
void test("missing acquisition releases the peer without starting an ineligible operation", async () => {
  const profiler = createProfiler("latency");
  try {
    const wave = createWave(profiler);
    let launched = false;
    await assert.rejects(
      wave.runWave(
        [
          { ...group, operation: "first", run: async () => 1 },
          {
            ...group,
            operation: "peer",
            run: async () => {
              launched = true;
              return 2;
            },
          },
        ],
        "first-period",
      ),
      /without acquiring/,
    );
    assert.equal(launched, false);
  } finally {
    profiler.close();
  }
});
void test("both real candidate snapshots must identify the same single request before settlement proceeds", async () => {
  const profiler = createProfiler("diagnostic");
  try {
    const wave = createWave(profiler);
    const select = () =>
      wave.observe("query", due, async () => [{ id: "synthetic" }]);
    await wave.runWave(
      [
        { ...group, operation: "one", run: select },
        { ...group, operation: "two", run: select },
      ],
      "due-candidates",
    );
    const { witness, calls } = wave.receipt();
    assert.ok(witness.selected);
    const last = Math.max(...witness.selected.map((s) => s.observedOffsetMs));
    assert.ok(witness.selected.every((s) => s.releasedOffsetMs >= last));
    assert.ok(
      calls.every(
        (c) =>
          c.sample?.diagnostics?.overlappedAnotherRequest &&
          c.coordinationWaitMs >= 0,
      ),
    );
  } finally {
    profiler.close();
  }
});

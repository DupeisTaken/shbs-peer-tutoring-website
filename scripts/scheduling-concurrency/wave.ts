import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { isContentionPeriodFence } from "../scheduling-profile/contention-fence-witness";
import type { createProfiler } from "../scheduling-profile/metrics";

export type LaunchPolicy = "first-period" | "due-candidates" | "simultaneous";
type Call<T> = {
  operation: string;
  role: string;
  transport: "domain" | "http";
  run: () => Promise<T>;
};
export type RunWave = <A, B>(
  calls: readonly [Call<A>, Call<B>],
  policy: LaunchPolicy,
) => Promise<[A, B]>;
type Sample = ReturnType<
  ReturnType<typeof createProfiler>["summary"]
>["samples"][number];
type CallRecord = Omit<Call<unknown>, "run"> & {
  callId: string;
  startedOffsetMs: number;
  finishedOffsetMs: number;
  coordinationWaitMs: number;
  sample?: Sample;
};
type Selection = {
  callId: string;
  ids: string[];
  observedOffsetMs: number;
  releasedOffsetMs: number;
};

function signal() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** This untransactional due-first read is the only rendezvous. Neither request
 * holds a transaction while waiting for its peer's genuine candidate snapshot. */
function isDueSelection(args: unknown) {
  const object: unknown = Array.isArray(args) ? args[0] : args;
  const strings: unknown =
    object && typeof object === "object" && "strings" in object
      ? object.strings
      : object;
  if (!Array.isArray(strings) || !strings.every((s) => typeof s === "string"))
    return false;
  const sql = strings.join("?").trim().replace(/\s+/g, " ");
  return (
    sql.startsWith(
      'SELECT r.id FROM "SessionPlanningRequest" r LEFT JOIN "SessionPlanningOffer" o',
    ) &&
    sql.includes("s.deadline<=?") &&
    sql.endsWith('r."updatedAt",r.id LIMIT 200')
  );
}

export function createWave(profiler: ReturnType<typeof createProfiler>) {
  const context = new AsyncLocalStorage<CallRecord>();
  const firstPeriod = signal(),
    bothSelected = signal();
  const calls: CallRecord[] = [],
    selected: Selection[] = [];
  let policy: LaunchPolicy | undefined;
  let origin = 0,
    firstAcquiredOffsetMs: number | undefined;
  let failure: Error | undefined;
  const now = () => performance.now() - origin;
  function abort(reason: unknown) {
    failure ??=
      reason instanceof Error
        ? reason
        : new Error("Concurrent operation failed", { cause: reason });
    firstPeriod.release();
    bothSelected.release();
  }
  const runWave: RunWave = async <A, B>(
    pair: readonly [Call<A>, Call<B>],
    launch: LaunchPolicy,
  ) => {
    assert.equal(policy, undefined, "Only one measured wave per reset");
    policy = launch;
    origin = performance.now();
    // A failed/missing acquisition must release any waiter, including a failed peer.
    const timer = setTimeout(
      () =>
        abort(new Error("Concurrent operation exceeded its 35-second budget")),
      35_000,
    );
    async function execute<T>(call: Call<T>) {
      const rec: CallRecord = {
        operation: call.operation,
        callId: call.operation,
        role: call.role,
        transport: call.transport,
        startedOffsetMs: now(),
        finishedOffsetMs: 0,
        coordinationWaitMs: 0,
      };
      calls.push(rec);
      try {
        const value = await context.run(rec, () =>
          profiler.measure(call.operation, call.run),
        );
        if (
          launch === "first-period" &&
          rec === calls[0] &&
          firstAcquiredOffsetMs === undefined
        )
          throw new Error(
            "First request finished without acquiring its period fence",
          );
        if (
          launch === "due-candidates" &&
          !selected.some((row) => row.callId === rec.callId)
        )
          throw new Error(
            "Settlement finished without the expected candidate query",
          );
        return value;
      } catch (error) {
        abort(error);
        throw error;
      } finally {
        rec.finishedOffsetMs = now();
      }
    }
    try {
      const outputs = await Promise.allSettled([
        execute(pair[0]),
        (async () => {
          if (launch === "first-period") await firstPeriod.promise;
          if (failure) throw failure;
          return execute(pair[1]);
        })(),
      ] as const);
      if (failure) throw failure;
      const [a, b] = outputs;
      if (a.status === "rejected") throw a.reason;
      if (b.status === "rejected") throw b.reason;
      assert.ok(
        Math.min(...calls.map((c) => c.finishedOffsetMs)) >
          Math.max(...calls.map((c) => c.startedOffsetMs)),
        "Calls did not overlap",
      );
      const samples = profiler.summary().samples.slice(-2);
      for (const call of calls) {
        call.sample = samples.find((s) => s.label === call.operation);
        assert.ok(call.sample?.succeeded && !call.sample.censored);
      }
      return [a.value, b.value];
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    runWave,
    bind<Args extends unknown[], R>(callback: (...args: Args) => R) {
      const active = context.getStore();
      return (...args: Args) =>
        active ? context.run(active, callback, ...args) : callback(...args);
    },
    async observe<T>(
      method: "execute" | "query",
      args: unknown,
      query: () => Promise<T>,
    ): Promise<T> {
      const record = context.getStore();
      const result = await query();
      if (!record) return result;
      if (
        policy === "first-period" &&
        method === "execute" &&
        record === calls[0] &&
        firstAcquiredOffsetMs === undefined &&
        isContentionPeriodFence(args)
      ) {
        firstAcquiredOffsetMs = now();
        firstPeriod.release();
      }
      if (
        policy === "due-candidates" &&
        method === "query" &&
        isDueSelection(args)
      ) {
        const item: unknown =
          Array.isArray(result) && result.length === 1 ? result[0] : null;
        assert.ok(
          item &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string",
          "Expected exactly one actual due request",
        );
        assert.ok(!selected.some((s) => s.callId === record.callId));
        const w = {
          callId: record.callId,
          ids: [item.id],
          observedOffsetMs: now(),
          releasedOffsetMs: 0,
        };
        selected.push(w);
        if (selected.length === 2) bothSelected.release();
        await bothSelected.promise;
        if (failure) throw failure;
        w.releasedOffsetMs = now();
        record.coordinationWaitMs = w.releasedOffsetMs - w.observedOffsetMs;
      }
      return result;
    },
    receipt() {
      assert.ok(policy && calls.length === 2);
      if (policy === "due-candidates")
        assert.ok(
          selected.length === 2 && selected[0]!.ids[0] === selected[1]!.ids[0],
        );
      return {
        calls,
        launchPolicy: policy,
        witness:
          policy === "due-candidates"
            ? { policy, selected }
            : policy === "first-period"
              ? { policy, firstAcquiredOffsetMs }
              : { policy },
      };
    },
  };
}

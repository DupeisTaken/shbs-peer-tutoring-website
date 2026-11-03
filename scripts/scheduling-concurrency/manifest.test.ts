import assert from "node:assert/strict";
import { test } from "node:test";
import { supplementClock } from "./manifest.mjs";

void test("the supplementary extension must fit the verified clock span with its full minimum runway", () => {
  const last = supplementClock(new Date("2026-11-03T14:15:00.000Z"));
  assert.equal(last.status, "ADMITTED");
  assert.equal(last.origin, "verified-original-interval");
  assert.ok("anchor" in last);
  assert.equal(last.anchor, "2026-11-03T11:20:59.961Z");
  const deferred = supplementClock(new Date("2026-11-03T14:15:00.001Z"));
  assert.equal(deferred.status, "DEFERRED");
  assert.equal("anchor" in deferred, false);
});
void test("a later day gets its own real clock and cannot silently replay the previous interval", () => {
  const current = new Date("2026-11-03T16:30:01.000Z");
  const fresh = supplementClock(current);
  assert.equal(fresh.origin, "fresh-declaration");
  assert.equal(fresh.status, "ADMITTED");
  assert.ok("anchor" in fresh);
  assert.equal(fresh.anchor, current.toISOString());
});

import assert from "node:assert/strict";
import test from "node:test";
import { inspectControlledChain, type LockRow } from "./controlled-contention";

const row = (pid: number, key: LockRow["key"], granted: boolean, blockers: number[] = [], start = 0): LockRow => ({
  pid, key, granted, blockers, mode: "ExclusiveLock", classid: "123", objid: key === "period" ? "1" : "2", objsubid: 1,
  xactStart: new Date(start), observedAt: new Date(20),
  applicationName: pid === 1 ? "test-hold" : "test",
});
const chain = () => [row(1, "room", true), row(2, "period", true), row(2, "room", false, [1]), row(3, "period", false, [2], 5)];

void test("requires a granted period owner and both direct blocker edges", () => {
  const proof = inspectControlledChain(chain(), 1);
  assert.equal(proof?.leader.pid, 2); assert.equal(proof?.follower?.pid, 3);
  const noPeriod = chain().filter((value) => !(value.pid === 2 && value.key === "period"));
  assert.equal(inspectControlledChain(noPeriod, 1), null);
  const wrongEdge = chain(); wrongEdge[3]!.blockers = [1];
  assert.equal(inspectControlledChain(wrongEdge, 1)?.follower, undefined);
});
void test("does not treat a first room waiter as a period owner or assume queue order", () => {
  const rows = [row(1, "room", true), row(2, "room", false, [1]), row(3, "room", false, [1])];
  assert.equal(inspectControlledChain(rows, 1), null);
  assert.throws(() => inspectControlledChain(chain(), 1, 99), /backend changed/);
  assert.throws(() => inspectControlledChain(chain().filter((value) => value.pid !== 1), 1), /no longer owns/);
});
void test("rejects ambiguous ownership and transaction timestamp ties", () => {
  assert.throws(() => inspectControlledChain([...chain(), row(4, "period", true), row(4, "room", false, [1])], 1), /Ambiguous first/);
  const tied = chain(); tied[3]!.xactStart = new Date(2);
  assert.throws(() => inspectControlledChain(tied, 1), /backend transaction starts/);
});

import assert from "node:assert/strict";
import { profileMatrix } from "./aggregate-partitions.mjs";

export const PROFILE_GROUPS = Object.freeze([
  "cold", "warm", "sunday", "negotiation", "allocation", "catalog", "contention", "backlog",
]);

export function profileGroups() { return [...PROFILE_GROUPS]; }

/** Hosted checks group partitions, never their sample populations. The preflight
 * control group must finish before any latency group starts.
 * @param {string} group */
export function groupSlots(group) {
  assert.ok(group === "preflight" || PROFILE_GROUPS.includes(group), "Unknown scheduling profile group");
  return group === "preflight" ? profileMatrix("preflight").include
    : profileMatrix("remaining").include.filter((slot) => slot.scenario === group);
}

/** Stable provider step names bind each receipt to its actual execution.
 * @param {{scenario:string, mode:string, partition:number}} slot */
export function partitionStepName(slot) { return `partition (${slot.scenario}, ${slot.mode}, ${slot.partition})`; }
/** @param {{scenario:string, mode:string, partition:number}} slot */
export function prepareStepName(slot) { return `prepare (${slot.scenario}, ${slot.mode}, ${slot.partition})`; }
/** @param {string} group */
export function groupJobName(group) {
  groupSlots(group);
  return group === "preflight" ? "preflight / measure" : `profile (${group}) / measure`;
}

import { createHash } from "node:crypto";
import { z } from "zod";

/** Only request-local answers participate in the current projection. Account identity,
 * original consent and server-captured academic concurrency evidence remain source-owned. */
const answerFields = [
  "firstName",
  "lastName",
  "preferredName",
  "alternativeNames",
  "englishName",
  "gradeLevel",
  "phone",
  "preferredContact",
  "firstChoiceId",
  "secondChoiceId",
  "slotIds",
] as const;
const answerObject = z.record(z.unknown());

/** Current payloads are complete normalized answer snapshots, not patches: omission clears
 * optional/hidden answers instead of resurrecting the original value. Domain callers still
 * perform authoritative field/configuration validation; this helper never authorizes an edit. */
export function currentStudentSignupPayload(row: {
  payload: unknown;
  currentPayload?: unknown;
}): Record<string, unknown> {
  const original = answerObject.parse(row.payload);
  if (row.currentPayload == null) return { ...original };
  const current = answerObject.parse(row.currentPayload);
  const result = { ...original };
  for (const key of answerFields) {
    delete result[key];
    if (Object.hasOwn(current, key)) result[key] = current[key];
  }
  return result;
}

/** Persist a complete local-answer snapshot without identity, consent or concurrency proofs. */
export function studentSignupLocalAnswers(
  payload: unknown,
): Record<string, unknown> {
  const source = answerObject.parse(payload);
  return Object.fromEntries(
    answerFields
      .filter((key) => Object.hasOwn(source, key) && source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

/** Object key order is transport detail; array order and every explicit value are evidence.
 * Reject non-JSON numbers so a malformed value cannot collide with legitimate null data. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Signup intent must contain finite JSON numbers.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object")
    throw new TypeError("Signup intent must contain JSON values.");
  if (Array.isArray(value)) {
    const entries: unknown[] = value;
    return `[${entries.map(canonicalJson).join(",")}]`;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("Signup intent must contain plain JSON objects.");
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

/** Bind a stable retry key to exact normalized answers, target/version and explicit consent.
 * Callers include that complete intent; a hash or matching email is never identity proof. */
export function studentSignupIntentDigest(intent: unknown): string {
  return createHash("sha256")
    .update("student-signup-intent:v1\0")
    .update(canonicalJson(intent))
    .digest("hex");
}

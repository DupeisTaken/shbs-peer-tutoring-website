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
const answerObject = z.record(z.string(), z.unknown());

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

const blankWhenEmpty = new Set<string>([
  "preferredName",
  "alternativeNames",
  "gradeLevel",
  "phone",
  "preferredContact",
  "secondChoiceId",
]);

function comparableStudentSignupAnswers(
  payload: unknown,
): Record<string, unknown> {
  const answers = studentSignupLocalAnswers(payload);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (key === "slotIds") continue;
    if (blankWhenEmpty.has(key) && (value === null || value === "")) continue;
    normalized[key] = value;
  }
  normalized.slotIds = Array.isArray(answers.slotIds)
    ? [
        ...new Set(
          answers.slotIds.filter((id): id is string => typeof id === "string"),
        ),
      ].sort()
    : [];
  return normalized;
}

/** Compare two signup answer snapshots for semantic equality, ignoring key order,
 * availability slot order and absent/blank optional values so initial confirmations
 * and no-op saves do not mark a request as edited. */
export function studentSignupAnswersEqual(
  left: unknown,
  right: unknown,
): boolean {
  return (
    studentSignupIntentDigest(comparableStudentSignupAnswers(left)) ===
    studentSignupIntentDigest(comparableStudentSignupAnswers(right))
  );
}

/** Compute the persisted edit marker after saving `nextAnswers`: null when the
 * resulting answers match the original submission, unchanged on no-op saves, and
 * `now` when the answers actually changed. */
export function nextStudentSignupEditedAt(
  row: { payload: unknown; currentPayload?: unknown; editedAt: Date | null },
  nextAnswers: unknown,
  now = new Date(),
): Date | null {
  if (studentSignupAnswersEqual(row.payload, nextAnswers)) return null;
  if (studentSignupAnswersEqual(currentStudentSignupPayload(row), nextAnswers))
    return row.editedAt;
  return now;
}

/** Effective edit timestamp for badges and triage. Suppresses historical rows
 * where confirmation, unassignment or no-op saves stamped editedAt without
 * changing answers away from the original submission, while preserving legacy
 * pre-revision rows (`currentPayload == null`). */
export function effectiveStudentSignupEditedAt(row: {
  payload: unknown;
  currentPayload?: unknown;
  editedAt: Date | null;
}): Date | null {
  if (!row.editedAt) return null;
  if (row.currentPayload == null) return row.editedAt;
  return studentSignupAnswersEqual(row.payload, row.currentPayload)
    ? null
    : row.editedAt;
}

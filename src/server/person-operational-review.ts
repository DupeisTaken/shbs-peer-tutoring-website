import type { PersonSource } from "./person-identity";

/** Stable reasons are presentation keys; source/work IDs keep each decision
 * inspectable without returning private request payloads or invitation secrets. */
export type PersonReviewReason =
  | "MULTIPLE_LIVE_LOGINS"
  | "RETAINED_LOGIN_REQUIRED"
  | "ACTIVE_UNOWNED_PROFILE"
  | "CURRENT_ASSIGNMENT"
  | "ACCOUNT_SUSPENDED"
  | "SCHOOL_DEPARTURE"
  | "CREDENTIAL_SETUP_REQUIRED"
  | "CAPABILITY_DIFFERENCE"
  | "ACADEMIC_DIFFERENCE"
  | "CURRENT_TUTOR_PROFILE"
  | "CURRENT_TUTEE_ENROLLMENT"
  | "PENDING_TUTOR_REQUEST"
  | "PENDING_CREW_REQUEST"
  | "PENDING_STUDENT_REQUEST"
  | "PENDING_APPROVAL"
  | "UNCONFIRMED_INTAKE"
  | "PENDING_HISTORY_INVITATION"
  | "HEAD_ACCOUNT"
  | "MESSAGING_DIFFERENCE"
  | "ACCOUNT_RETIRED"
  | "ACCOUNT_SAFETY_REVIEW";

export type PersonReviewDestination =
  | "/admin/users"
  | "/admin/tutors"
  | "/admin/tutor-requests"
  | "/admin/tutees"
  | "/admin/tutee-requests"
  | "/admin/pairings"
  | "/admin/crew"
  | "/admin/requests"
  | "/admin/approvals"
  | "/admin/academic-corrections";

export type PersonReviewItem = {
  id: string;
  reason: PersonReviewReason;
  sources: PersonSource[];
  work: { kind: string; id: string; dueAt: Date | null; availableAt?: Date | null }[];
  destination: PersonReviewDestination;
  blocksFinalization: boolean;
  blocksRetirement: boolean;
  /** A field name, never a private value, for capability disagreements. */
  field: string | null;
};

export function personReviewItem(
  reason: PersonReviewReason,
  sources: PersonSource[],
  destination: PersonReviewDestination,
  options: Partial<Pick<PersonReviewItem, "work" | "field" | "blocksFinalization" | "blocksRetirement">> = {},
): PersonReviewItem {
  const ordered = [...sources].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const work = [...(options.work ?? [])].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  return {
    id: [reason, ...ordered.map((s) => `${s.kind}:${s.id}`), ...work.map((w) => `${w.kind}:${w.id}`), options.field ?? ""].join("|"),
    reason,
    sources: ordered,
    work,
    destination,
    blocksFinalization: options.blocksFinalization ?? true,
    blocksRetirement: options.blocksRetirement ?? true,
    field: options.field ?? null,
  };
}

/** The old read-only safety inventory is still useful to the shared planner.
 * Convert its established rules at one boundary; clients never parse prose. */
export function accountSafetyReason(message: string): PersonReviewReason {
  if (message.includes("already retired")) return "ACCOUNT_RETIRED";
  if (message.includes("Transfer leadership")) return "HEAD_ACCOUNT";
  if (message.includes("suspensions")) return "ACCOUNT_SUSPENDED";
  if (message.includes("school-departure")) return "SCHOOL_DEPARTURE";
  if (message.includes("unconfirmed student intake")) return "UNCONFIRMED_INTAKE";
  if (message.includes("password setup")) return "CREDENTIAL_SETUP_REQUIRED";
  if (message.includes("pending approval")) return "PENDING_APPROVAL";
  if (message.includes("pending crew or student")) return "PENDING_STUDENT_REQUEST";
  if (message.includes("tutor profiles")) return "CURRENT_TUTOR_PROFILE";
  if (message.includes("tutee profiles")) return "CURRENT_TUTEE_ENROLLMENT";
  if (message.includes("ranks differ") || message.includes("Crew membership")) return "CAPABILITY_DIFFERENCE";
  if (message.includes("Academic profiles")) return "ACADEMIC_DIFFERENCE";
  if (message.includes("Messaging permissions")) return "MESSAGING_DIFFERENCE";
  return "ACCOUNT_SAFETY_REVIEW";
}

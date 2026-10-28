import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { APPROVAL_OPERATIONS, humanizeOperation } from "./approval-policy";
import { approvalReview } from "./approval-review";
import type { NotificationInAppDetail } from "./notification-details";

type Row = Record<string, unknown>;
type Outcome = "pending" | "approved" | "rejected";
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const label = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, 80)
    : undefined;
const statuses = {
  pending: { en: "Proposed", zh: "待审核" },
  approved: { en: "Approved", zh: "已批准" },
  rejected: { en: "Declined", zh: "已拒绝" },
} as const;

/** Captured identity fields only: never serialize a review payload, note, contact,
 * or arbitrary before/after value into a notification. Historical decisions use
 * their immutable proposal evidence rather than looking up today's identities. */
export function approvalNotificationDetail(
  operation: string,
  payload: unknown,
  targets: unknown,
  outcome: Outcome,
): NotificationInAppDetail {
  const input = object(payload);
  const evidence = object(targets);
  const rows = (table: string) => {
    const value = evidence[table];
    return (Array.isArray(value) ? value : value ? [value] : []).map((item) =>
      object(object(item).record ?? item),
    );
  };
  const name = (row: Row | undefined) =>
    row &&
    (label(row.englishName) ??
      label(row.name) ??
      label(object(row.currentPayload ?? row.payload).englishName));
  const find = (table: string, id: unknown) =>
    typeof id === "string"
      ? rows(table).find((row) => row.id === id)
      : undefined;
  const assignment = [
    "studentWorkflow.assign",
    "admin.assignTuteeToTutor",
    "admin.assignSignup",
  ].includes(operation);
  if (assignment) {
    const tutee = name(
      operation === "studentWorkflow.assign"
        ? find("StudentSurvey", input.id)
        : find("Tutee", input.tuteeId),
    );
    const assignments =
      operation === "admin.assignSignup" && Array.isArray(input.assignments)
        ? input.assignments.map(object)
        : [input];
    const descriptions = assignments.slice(0, 3).map((item) => {
      const tutor = name(find("Tutor", item.tutorId));
      const subject =
        label(find("Subject", item.subjectId)?.name) ?? label(item.subject);
      return {
        en: `Tutee ${tutee ?? "(name not recorded)"} → Tutor ${tutor ?? "(name not recorded)"}${subject ? ` (${subject})` : ""}`,
        zh: `学习伙伴 ${tutee ?? "（未记录姓名）"} → 辅导伙伴 ${tutor ?? "（未记录姓名）"}${subject ? `（${subject}）` : ""}`,
      };
    });
    const extra = Math.max(0, assignments.length - descriptions.length);
    return {
      en: `${statuses[outcome].en} assignment: ${descriptions.map((item) => item.en).join("; ")}${extra ? `; ${extra} more` : ""}.`,
      zh: `${statuses[outcome].zh}的分配：${descriptions.map((item) => item.zh).join("；")}${extra ? `；另有 ${extra} 项` : ""}。`,
    };
  }

  // Only these identity-bearing tables may supply the short target label. In
  // particular, message bodies/titles and announcement audiences are excluded.
  const namedTables = new Set([
    "User",
    "Tutor",
    "Tutee",
    "StudentSurvey",
    "TutorApplication",
    "CrewApplication",
    "Subject",
    "SubjectLevel",
    "Room",
    "Term",
  ]);
  const primary = APPROVAL_OPERATIONS[operation];
  const targetId =
    input.id ??
    input.userId ??
    input.tuteeId ??
    input.tutorId ??
    input.applicationId;
  const primaryRows = primary && namedTables.has(primary) ? rows(primary) : [];
  const selected = targetId
    ? primaryRows.filter((row) => row.id === targetId)
    : primaryRows;
  const related = selected.length
    ? selected
    : [...namedTables].flatMap((table) => rows(table));
  const names = [
    ...new Set(related.map(name).filter((item): item is string => !!item)),
  ];
  const target = names.slice(0, 3).join(", ");
  const review = approvalReview(operation, payload, targets);
  // Field names explain profile/configuration changes without copying sensitive values.
  const changedFields =
    review.kind === "update"
      ? review.changes
          .map((field) => field.key)
          .filter(
            (key) =>
              !["reason", "note", "body", "password", "email"].includes(key),
          )
          .slice(0, 4)
      : [];
  const detail = (locale: "en" | "zh") => {
    const catalog = locale === "en" ? en : zh;
    const operations: Record<string, string> =
      catalog.approvals.review.operations;
    const fields: Record<string, string> = catalog.approvals.review.fields;
    const action =
      operations[operation.replaceAll(".", "_")] ??
      humanizeOperation(operation);
    const changes = changedFields
      .map((key) => fields[key] ?? humanizeOperation(key))
      .join(", ");
    return `${statuses[outcome][locale]}: ${action}${target ? ` — ${target}` : ""}${names.length > 3 ? ` (+${names.length - 3})` : ""}${changes ? ` (${changes})` : ""}.`;
  };
  return { en: detail("en"), zh: detail("zh") };
}

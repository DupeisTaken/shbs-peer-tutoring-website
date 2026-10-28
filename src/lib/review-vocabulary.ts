import {
  reviewEnumValues,
  reviewFieldKeys,
  reviewSchema,
} from "./review-vocabulary-schema";

type EntitySchema = {
  fields: readonly string[];
  enums: Readonly<Record<string, string>>;
  references: Readonly<Record<string, string>>;
};
const schemas = reviewSchema as Readonly<Record<string, EntitySchema>>;
const fields = new Set<string>(reviewFieldKeys);
const prefix = "auditEventDetails.presentation";
/** These persisted String columns have closed domains owned by their writers,
 * rather than Prisma enums. Keep each mapping scoped to its exact entity/field;
 * an identical token in a name, explanation or unknown object remains text. */
export const reviewStringDomains = {
  TranslationDraft: {
    state: {
      PENDING: "translationEditor.PENDING",
      APPROVED: "translationEditor.APPROVED",
      REJECTED: "translationEditor.REJECTED",
    },
  },
  StudentAppeal: {
    state: {
      PENDING: "approvals.review.values.PENDING",
      // student.decideAppeal overturns the card when the appeal is UPHELD.
      UPHELD: "approvals.review.overturn",
      REJECTED: "approvals.review.uphold",
    },
  },
  SchoolDepartureEvent: {
    action: {
      GRADUATED: "approvals.review.values.GRADUATED",
      TRANSFERRED: "approvals.review.values.TRANSFERRED",
      RETURN: "approvals.review.values.RETURN",
      REVOKE: "approvals.review.values.REVOKE",
      RESTORE: "approvals.review.values.RESTORE",
    },
  },
  MessageModeration: {
    action: {
      REVIEW: "messaging.actions.REVIEW",
      HIDE: "messaging.actions.HIDE",
      RESTORE: "messaging.actions.RESTORE",
      RESTRICT: "messaging.actions.RESTRICT",
      UNRESTRICT: "messaging.actions.UNRESTRICT",
    },
  },
  MessagePermission: {
    groups: {
      MANAGEMENT: "messaging.groups.MANAGEMENT",
      CURRENT_TUTORS: "messaging.groups.CURRENT_TUTORS",
      PAST_TUTORS: "messaging.groups.PAST_TUTORS",
      SAME_GROUP: "messaging.groups.SAME_GROUP",
      ALL_USERS: "messaging.groups.ALL_USERS",
    },
  },
} as const;
const stringDomains = reviewStringDomains as Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
>;
const aliases: Readonly<Record<string, string>> = {
  programSettings: "ProgramSettings",
  programFeature: "ProgramFeature",
  term: "Term",
  rooms: "Room",
  calendar: "SchoolCalendarDay",
  programCalendar: "ProgramCalendarDay",
  settings: "StudentSettings",
  content: "HomeContent",
  translation: "MessageOverride",
  policy: "PolicyDocument",
  layout: "PageLayout",
  languages: "Language",
  messagePermissions: "MessagePermission",
  academic: "AcademicProfile",
  departure: "SchoolDeparture",
};
export const reviewEntity = (entity: string | undefined) =>
  entity
    ? Object.hasOwn(aliases, entity)
      ? aliases[entity]
      : entity
    : undefined;
const schemaFor = (entity: string | undefined) =>
  entity && Object.hasOwn(schemas, entity) ? schemas[entity] : undefined;

/** Fully-qualified message keys are shared by audit and approval readers. Only
 * explicit schema fields/enums receive meaning; user-authored text stays literal. */
export function auditEntityLabelKey(entity: string | undefined): string | null {
  const name = reviewEntity(entity);
  return name && Object.hasOwn(schemas, name)
    ? `${prefix}.entities.${name}`
    : null;
}
export function auditFieldLabelKey(
  entity: string | undefined,
  field: string,
): string | null {
  const name = reviewEntity(entity);
  if (!name || !schemaFor(name)?.fields.includes(field) || !fields.has(field))
    return null;
  if (
    field === "action" &&
    ["MessageModeration", "SchoolDepartureEvent"].includes(name)
  )
    return "auditEventDetails.action";
  if (field === "groupId" && ["Pairing", "PairingGroup"].includes(name))
    return `${prefix}.fieldOverrides.combinedGroup`;
  return `${prefix}.fields.${field}`;
}
export function auditEnumLabelKey(
  entity: string | undefined,
  field: string,
  value: unknown,
): string | null {
  const name = reviewEntity(entity);
  const owner =
    name && Object.hasOwn(stringDomains, name)
      ? stringDomains[name]
      : undefined;
  const domain =
    owner && Object.hasOwn(owner, field) ? owner[field] : undefined;
  if (domain && typeof value === "string" && Object.hasOwn(domain, value))
    return domain[value] ?? null;
  const enumFields = schemaFor(name)?.enums;
  const type =
    enumFields && Object.hasOwn(enumFields, field)
      ? enumFields[field]
      : undefined;
  return type &&
    typeof value === "string" &&
    (reviewEnumValues as Readonly<Record<string, readonly string[]>>)[
      type
    ]?.includes(value)
    ? `${prefix}.enums.${type}.${value}`
    : null;
}
export function auditReferenceEntity(
  entity: string | undefined,
  field: string,
): string | undefined {
  const name = reviewEntity(entity);
  const references = schemaFor(name)?.references;
  return references && Object.hasOwn(references, field)
    ? references[field]
    : undefined;
}
export const supportedReviewEntities = Object.keys(schemas);
export { reviewSchema, reviewEnumValues, reviewFieldKeys };

export const APPLICATION_COMPLETIONS = [
  "",
  "COMPLETED",
  "NOT_COMPLETED",
] as const;
export const APPLICATION_IDENTITIES = ["", "NEEDS_REVIEW", "READY"] as const;
export const APPLICATION_SORTS = [
  "",
  "COMPLETED_DESC",
  "COMPLETED_ASC",
  "CREATED_DESC",
  "CREATED_ASC",
  "NAME_ASC",
  "NAME_DESC",
] as const;
export type ApplicationSort = (typeof APPLICATION_SORTS)[number];

type ApplicationDate = Date | string | null;

/** Invalid or absent evidence is unrecorded, never a completed interview. */
function timestamp(value: ApplicationDate | undefined): number | null {
  if (value == null || value === "") return null;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export type ApplicationFilters = {
  search: string;
  status: string;
  type: string;
  subjectId: string;
  completion: (typeof APPLICATION_COMPLETIONS)[number];
  identity: (typeof APPLICATION_IDENTITIES)[number];
  sort: ApplicationSort;
};

export const emptyApplicationFilters: ApplicationFilters = {
  search: "",
  status: "",
  type: "",
  subjectId: "",
  completion: "",
  identity: "",
  sort: "",
};

/** Match the complete queue locally, combining dimensions without changing its order.
 * Subject IDs keep same-named courses/levels separate; an intent may match any subject. */
export function matchesApplicationFilters(
  application: {
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    preferredName?: string | null;
    alternativeNames?: string | null;
    email: string;
    status: string;
    type: string;
    subjectIntents: { subjectId: string }[];
    interviewCompletedAt?: ApplicationDate;
    identityNeedsReview?: boolean;
  },
  filters: ApplicationFilters,
) {
  return (
    matchesPersonSearch(application, filters.search, [application.name, application.email]) &&
    (!filters.status || application.status === filters.status) &&
    (!filters.type || application.type === filters.type) &&
    (!filters.subjectId ||
      application.subjectIntents.some(
        (intent) => intent.subjectId === filters.subjectId,
      )) &&
    (!filters.identity ||
      (application.type === "INITIAL" &&
        typeof application.identityNeedsReview === "boolean" &&
        application.identityNeedsReview === (filters.identity === "NEEDS_REVIEW"))) &&
    (!filters.completion ||
      (timestamp(application.interviewCompletedAt) !== null) ===
        (filters.completion === "COMPLETED"))
  );
}

/** Reorder keyed records without changing their owners or the incoming queue.
 * Missing dates always stay last; equal values retain incoming order. */
export function sortApplications<
  T extends {
    name: string;
    createdAt?: ApplicationDate;
    interviewCompletedAt?: ApplicationDate;
  },
>(applications: readonly T[], sort: ApplicationSort, locale: string): T[] {
  if (!sort) return [...applications];
  const direction = sort.endsWith("_DESC") ? -1 : 1;
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  return applications
    .map((application, index) => ({ application, index }))
    .sort((left, right) => {
      let comparison: number;
      if (sort.startsWith("NAME_")) {
        comparison =
          direction *
          collator.compare(left.application.name, right.application.name);
      } else {
        const field = sort.startsWith("COMPLETED_")
          ? "interviewCompletedAt"
          : "createdAt";
        const a = timestamp(left.application[field]);
        const b = timestamp(right.application[field]);
        comparison =
          a === null
            ? b === null
              ? 0
              : 1
            : b === null
              ? -1
              : direction * (a - b);
      }
      return comparison || left.index - right.index;
    })
    .map(({ application }) => application);
}
import { matchesPersonSearch } from "./person-search";


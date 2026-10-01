export type ApplicationFilters = {
  search: string;
  status: string;
  type: string;
  subjectId: string;
};

export const emptyApplicationFilters: ApplicationFilters = {
  search: "",
  status: "",
  type: "",
  subjectId: "",
};

/** Match the complete queue locally, combining dimensions without changing its order.
 * Subject IDs keep same-named courses/levels separate; an intent may match any subject. */
export function matchesApplicationFilters(
  application: {
    name: string;
    email: string;
    status: string;
    type: string;
    subjectIntents: { subjectId: string }[];
  },
  filters: ApplicationFilters,
) {
  const search = filters.search.trim().toLocaleLowerCase();
  return (
    (!search ||
      application.name.toLocaleLowerCase().includes(search) ||
      application.email.toLocaleLowerCase().includes(search)) &&
    (!filters.status || application.status === filters.status) &&
    (!filters.type || application.type === filters.type) &&
    (!filters.subjectId ||
      application.subjectIntents.some(
        (intent) => intent.subjectId === filters.subjectId,
      ))
  );
}

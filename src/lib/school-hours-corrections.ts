export type SchoolHoursPriorEdition = {
  revision: number;
  monthAmount: number;
  correctionToCurrent: number;
};

/** Old saved editions know only their immediate predecessor. Do not invent an
 * earlier applied balance: recipients with missing history must ask the team. */
export function schoolHoursPriorEditions(
  row: {
    priorEditions?: readonly SchoolHoursPriorEdition[];
    previousEditionAmount: number | null;
    hoursToAdd: number;
  },
  revision: number,
): SchoolHoursPriorEdition[] {
  if (revision < 2) return [];
  if (row.priorEditions?.length)
    return [...row.priorEditions].sort((a, b) => a.revision - b.revision);
  return row.previousEditionAmount === null
    ? []
    : [
        {
          revision: revision - 1,
          monthAmount: row.previousEditionAmount,
          correctionToCurrent: row.hoursToAdd,
        },
      ];
}

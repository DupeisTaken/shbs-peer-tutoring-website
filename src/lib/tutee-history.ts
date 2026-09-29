/** Archive visibility is not an access grant. Undated active/pending legacy rows remain
 * current until staff resolve them; neither age nor a missing login proves departure. */
export function isHistoricalTutee(
  row: {
    status: string;
    intakeTermId?: string | null;
  },
  activeTermId: string | null,
) {
  return (
    row.status === "INACTIVE" ||
    (!!row.intakeTermId && row.intakeTermId !== activeTermId)
  );
}

export type TuteeHistoryView = "current" | "historical" | "all";
export function matchesTuteeHistoryView(
  historical: boolean,
  view: TuteeHistoryView,
) {
  return view === "all" || (view === "historical" ? historical : !historical);
}

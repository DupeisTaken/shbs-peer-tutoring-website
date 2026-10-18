type CatalogSlot = {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
};

/** Recommendations compare catalog identities only. Similar clock ranges never
 * imply agreement, and sorting a copy leaves both the catalog and saved choice intact. */
export function rankMutualAvailability<T extends CatalogSlot>({
  slots,
  tutorSlotIds,
  tutees,
  ready = true,
}: {
  slots: readonly T[];
  tutorSlotIds: readonly string[] | undefined;
  tutees: readonly { id: string; slotIds: readonly string[] | undefined }[];
  ready?: boolean;
}) {
  const published = new Set(slots.map((slot) => slot.id));
  const selected = (ids: readonly string[] | undefined) =>
    new Set((ids ?? []).filter((id) => published.has(id)));
  const tutor = selected(tutorSlotIds);
  const students = [
    ...new Map(tutees.map((tutee) => [tutee.id, tutee])).values(),
  ];
  const studentSlots = students.map((student) => selected(student.slotIds));
  const missingTutees = studentSlots.filter((ids) => ids.size === 0).length;
  const missingTutor = tutor.size === 0;
  const available = ready && tutorSlotIds !== undefined;
  const ranked = slots.map((slot) => {
    const tutorSelected = tutor.has(slot.id);
    const matchedTutees = studentSlots.filter((ids) => ids.has(slot.id)).length;
    const mutual =
      available &&
      students.length > 0 &&
      tutorSelected &&
      matchedTutees === students.length;
    return { slot, tutorSelected, matchedTutees, mutual };
  });
  ranked.sort(
    (a, b) =>
      Number(b.mutual) - Number(a.mutual) ||
      (available ? Number(b.tutorSelected) - Number(a.tutorSelected) : 0) ||
      (available ? b.matchedTutees - a.matchedTutees : 0) ||
      a.slot.dayOfWeek - b.slot.dayOfWeek ||
      a.slot.startMin - b.slot.startMin ||
      a.slot.endMin - b.slot.endMin ||
      (a.slot.id < b.slot.id ? -1 : a.slot.id > b.slot.id ? 1 : 0),
  );
  const status = !available
    ? "unavailable"
    : students.length === 0
      ? "noTutees"
      : missingTutor || missingTutees > 0
        ? "missing"
        : ranked.some((entry) => entry.mutual)
          ? "mutual"
          : "noCommon";
  return {
    ranked,
    status,
    missingTutor,
    missingTutees,
    totalTutees: students.length,
  };
}

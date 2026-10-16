"use client";

import { useTranslations } from "next-intl";

/** Display only persisted room intent. A missing reservation is never labelled
 * as availability; legacy roomless records are not inferred to be shortages. */
export function RoomAllocationStatus({
  pairing,
}: {
  pairing: {
    room?: { name: string } | null;
    roomMode: string;
    roomNeedsAssignment: boolean;
    scheduleConfirmed: boolean;
  };
}) {
  const t = useTranslations("roomAllocation");
  return (
    <div className="space-y-1">
      {pairing.scheduleConfirmed && pairing.room && (
        <span className="block">{pairing.room.name}</span>
      )}
      <span
        className={pairing.roomNeedsAssignment ? "badge-amber" : "badge-slate"}
      >
        {t(
          !pairing.scheduleConfirmed
            ? "awaiting"
            : pairing.roomNeedsAssignment
              ? "needsRoom"
              : !pairing.room && pairing.roomMode === "AUTO"
                ? "outcome.UNASSIGNED"
                : `mode.${pairing.roomMode}`,
        )}
      </span>
    </div>
  );
}

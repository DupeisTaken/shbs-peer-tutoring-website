"use client";

import { useTranslations } from "next-intl";

/** Compact room outcome, not a new allocation rule. An unconfirmed stored room
 * is only a selection; amber is reserved for a persisted staff-attention state. */
export function PairingRoomSummary({
  pairing,
}: {
  pairing: {
    scheduleConfirmed: boolean;
    room?: { name: string } | null;
    roomMode: string;
    roomNeedsAssignment: boolean;
  };
}) {
  const t = useTranslations("roomAllocation");
  const reserved = pairing.scheduleConfirmed && !!pairing.room;
  const notRequired = !pairing.scheduleConfirmed || pairing.roomMode === "NONE";
  const needsAttention =
    !reserved && !notRequired && pairing.roomNeedsAssignment;
  const status = !pairing.scheduleConfirmed
    ? t("awaiting")
    : pairing.roomMode === "NONE"
      ? t("mode.NONE")
      : needsAttention
        ? t("needsRoom")
        : !reserved
          ? t("outcome.UNASSIGNED")
          : pairing.roomMode === "LEGACY"
            ? t("outcome.ASSIGNED")
            : t(`mode.${pairing.roomMode}`);
  // Both empty-state symbols share a gray fill. Amber text retains the staff
  // attention cue; confirmed staff choices follow the selected app accent.
  const color = !reserved
    ? needsAttention
      ? "badge bg-slate-100 text-amber-700"
      : "badge-slate"
    : pairing.roomMode === "FIXED"
      ? "badge bg-accent-100 text-accent-800"
      : pairing.roomMode === "NONE" || pairing.roomMode === "LEGACY"
        ? "badge border border-slate-300 bg-white text-slate-600"
        : "badge-slate";
  const label = reserved ? pairing.room!.name : notRequired ? "-" : "x";

  return (
    <span className={`${color} relative min-w-6 justify-center`} title={status}>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {reserved ? `${label} · ${status}` : status}
      </span>
    </span>
  );
}

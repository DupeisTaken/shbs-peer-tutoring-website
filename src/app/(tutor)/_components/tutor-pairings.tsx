"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { useMerge } from "~/app/(tutor)/_components/merge-context";

/**
 * The tutor's pairings, each with a control to pick the default reference time slot.
 * Picking a slot copies its day/time onto the pairing (server-side, scoped to the caller).
 */
export function TutorPairings() {
  const t = useTranslations();
  const utils = api.useUtils();
  const pairings = api.tutor.myPairings.useQuery();
  const availability = api.tutor.myAvailability.useQuery();
  const setSlot = api.tutor.setPairingSlot.useMutation({
    onSuccess: () => utils.tutor.myPairings.invalidate(),
  });
  const { primaryPairingId, mergeIds, setMergeIds } = useMerge();

  const slots = availability.data?.slots ?? [];

  if (pairings.isLoading) return <p className="muted">{t("tutor.pairings.loading")}</p>;
  const list = pairings.data ?? [];
  if (list.length === 0) {
    return <p className="muted">{t("tutor.pairings.empty")}</p>;
  }

  // Merge eligibility: the attendance form sets the primary pairing; another pairing can be
  // merged into the same block only when it shares a tutee with the primary OR is the same
  // subject (we don't merge unrelated sessions).
  const primary = list.find((p) => p.id === primaryPairingId);
  const primaryTuteeIds = new Set(primary?.tutees.map((x) => x.tuteeId) ?? []);
  const mergeCandidates = primary
    ? list.filter(
        (p) =>
          p.id !== primary.id &&
          (p.subject === primary.subject ||
            p.tutees.some((x) => primaryTuteeIds.has(x.tuteeId))),
      )
    : [];

  return (
    <>
    <ul className="divide-y divide-slate-100">
      {list.map((p) => (
        <li key={p.id} className="py-3">
          <p className="font-medium text-slate-900">
            {p.subject}
            <span className="muted font-normal">
              {" · "}
              {DAY_NAMES[p.dayOfWeek]} {minToHm(p.startMin)}–{minToHm(p.endMin)}
            </span>
          </p>
          <p className="muted">
            {t("tutor.pairings.tutees", {
              names:
                p.tutees.map((x) => x.tutee.englishName).join(", ") ||
                t("tutor.pairings.noTuteesYet"),
            })}
            {p.room
              ? t("tutor.pairings.room", { room: p.room.name })
              : t("tutor.pairings.noRoom")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              {t("tutor.pairings.defaultSlotLabel")}
            </span>
            <select
              value={p.timeSlotId ?? ""}
              onChange={(e) =>
                setSlot.mutate({ pairingId: p.id, slotId: e.target.value || null })
              }
              className="select w-auto"
            >
              <option value="">{t("tutor.pairings.notSet")}</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {DAY_NAMES[s.dayOfWeek]} {minToHm(s.startMin)}–{minToHm(s.endMin)}
                </option>
              ))}
            </select>
            {p.timeSlot && (
              <span className="muted">
                ({DAY_NAMES[p.timeSlot.dayOfWeek]} {minToHm(p.timeSlot.startMin)}–
                {minToHm(p.timeSlot.endMin)})
              </span>
            )}
          </div>
        </li>
      ))}
      {setSlot.error && <li className="py-2 text-sm text-red-600">{setSlot.error.message}</li>}
    </ul>

    {/* Merge sessions — combine several of your pairings into one attendance block. */}
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="label">{t("tutor.pairings.mergeTitle")}</p>
      {!primary ? (
        <p className="muted mt-1 text-xs">{t("tutor.pairings.mergeSelectPrimary")}</p>
      ) : mergeCandidates.length === 0 ? (
        <p className="muted mt-1 text-xs">{t("tutor.pairings.mergeNone")}</p>
      ) : (
        <>
          <p className="muted mt-1 mb-2 text-xs">{t("tutor.pairings.mergeHelp")}</p>
          <div className="space-y-1">
            {mergeCandidates.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mergeIds.includes(p.id)}
                  onChange={(e) =>
                    setMergeIds((ids) =>
                      e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                    )
                  }
                />
                <span className="truncate">
                  {p.subject} · {DAY_NAMES[p.dayOfWeek]} {minToHm(p.startMin)}–{minToHm(p.endMin)}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
    </>
  );
}

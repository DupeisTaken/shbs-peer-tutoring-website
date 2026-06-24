"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { useMerge } from "~/app/(tutor)/_components/merge-context";

/**
 * The tutor's pairings, each with a control to pick the default reference time slot and to
 * request removal of a tutee who has left (admin-reviewed). Picking a slot copies its day/time
 * onto the pairing (server-side, scoped to the caller).
 */
export function TutorPairings() {
  const t = useTranslations();
  const utils = api.useUtils();
  const pairings = api.tutor.myPairings.useQuery();
  const availability = api.tutor.myAvailability.useQuery();
  const removalRequests = api.tutor.myTuteeRemovalRequests.useQuery();
  const setSlot = api.tutor.setPairingSlot.useMutation({
    onSuccess: () => utils.tutor.myPairings.invalidate(),
  });

  const refreshRemoval = () => utils.tutor.myTuteeRemovalRequests.invalidate();
  const requestRemoval = api.tutor.requestTuteeRemoval.useMutation({ onSuccess: refreshRemoval });
  const recallRemoval = api.tutor.recallTuteeRemoval.useMutation({ onSuccess: refreshRemoval });

  // Which (pairing,tutee) the tutor is composing a removal reason for.
  const [removing, setRemoving] = useState<{ pairingId: string; tuteeId: string } | null>(null);
  const [reason, setReason] = useState("");

  const { primaryPairingId, mergeIds, setMergeIds } = useMerge();

  const slots = availability.data?.slots ?? [];
  // Pending removal requests keyed by `${pairingId}:${tuteeId}` for quick lookup.
  const pendingByKey = new Map(
    (removalRequests.data ?? []).map((r) => [`${r.pairingId}:${r.tuteeId}`, r.id]),
  );

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
            {p.room
              ? t("tutor.pairings.roomOnly", { room: p.room.name })
              : t("tutor.pairings.noRoom")}
          </p>

          {/* Tutees on this pairing, each with a "left the program" removal request control. */}
          <div className="mt-2">
            {p.tutees.length === 0 ? (
              <p className="muted text-sm">{t("tutor.pairings.noTuteesYet")}</p>
            ) : (
              <ul className="space-y-1">
                {p.tutees.map((x) => {
                  const key = `${p.id}:${x.tuteeId}`;
                  const pendingId = pendingByKey.get(key);
                  const composing =
                    removing?.pairingId === p.id && removing?.tuteeId === x.tuteeId;
                  return (
                    <li key={x.tuteeId} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-700">{x.tutee.englishName}</span>
                        {pendingId ? (
                          <>
                            <span className="badge-amber">
                              {t("tutor.pairings.removalPending")}
                            </span>
                            <button
                              className="link-danger text-xs"
                              disabled={recallRemoval.isPending}
                              onClick={() => recallRemoval.mutate({ requestId: pendingId })}
                            >
                              {t("tutor.pairings.removalRecall")}
                            </button>
                          </>
                        ) : composing ? null : (
                          <button
                            className="link text-xs"
                            onClick={() => {
                              setRemoving({ pairingId: p.id, tuteeId: x.tuteeId });
                              setReason("");
                            }}
                          >
                            {t("tutor.pairings.requestRemoval")}
                          </button>
                        )}
                      </div>
                      {composing && (
                        <div className="mt-1 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                          <p className="muted text-xs">{t("tutor.pairings.removalHelp")}</p>
                          <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t("tutor.pairings.removalReasonPlaceholder")}
                            className="textarea w-full text-sm"
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <button
                              className="btn-secondary btn-sm"
                              disabled={requestRemoval.isPending}
                              onClick={() =>
                                requestRemoval.mutate(
                                  {
                                    pairingId: p.id,
                                    tuteeId: x.tuteeId,
                                    reason: reason.trim() || undefined,
                                  },
                                  { onSuccess: () => setRemoving(null) },
                                )
                              }
                            >
                              {t("tutor.pairings.removalSubmit")}
                            </button>
                            <button
                              className="link text-xs"
                              onClick={() => setRemoving(null)}
                            >
                              {t("tutor.pairings.removalCancel")}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {requestRemoval.error && (
              <p className="mt-1 text-xs text-red-600">{requestRemoval.error.message}</p>
            )}
          </div>
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

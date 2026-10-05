"use client";
import { pairingScheduleText } from "~/lib/pairing-schedule";

import { StudentScheduleAction } from "./student-schedule-action";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { useMerge } from "~/app/(tutor)/_components/merge-context";
import { useDialog } from "~/app/_components/confirm-dialog";

/**
 * The tutor's pairings, each with a control to pick the default reference time slot and to
 * relay a tutee opt-out (seven-day recall window). Picking a slot copies its day/time
 * onto the pairing (server-side, scoped to the caller).
 */
export function TutorPairings({ active = true }: { active?: boolean }) {
  const t = useTranslations();
  const format = useFormatter();
  const { confirm, dialog } = useDialog();
  const utils = api.useUtils();
  const pairings = api.tutor.myPairings.useQuery();
  const workflowRoster = api.studentWorkflow.tutorRoster.useQuery();
  const availability = api.tutor.myAvailability.useQuery();
  const removalRequests = api.tutor.myTuteeRemovalRequests.useQuery();
  const setSlot = api.tutor.setPairingSlot.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tutor.myPairings.invalidate(),
        utils.tutor.schedule.invalidate(),
      ]);
    },
  });

  const refreshRemoval = () => utils.tutor.myTuteeRemovalRequests.invalidate();
  const requestRemoval = api.tutor.requestTuteeRemoval.useMutation({
    onSuccess: refreshRemoval,
  });
  const recallRemoval = api.tutor.recallTuteeRemoval.useMutation({
    onSuccess: refreshRemoval,
  });

  // Which (pairing,tutee) the tutor is composing a removal reason for.
  const [removing, setRemoving] = useState<{
    pairingId: string;
    tuteeId: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  // Feedback belongs to the latest attempted action, not any earlier mutation
  // that still has a success/error result in React Query's separate caches.
  const [lastAction, setLastAction] = useState<
    "slot" | "request" | "recall" | null
  >(null);
  const feedback =
    lastAction === "slot"
      ? setSlot
      : lastAction === "request"
        ? requestRemoval
        : lastAction === "recall"
          ? recallRemoval
          : null;

  const { primaryPairingId, mergeIds, setMergeIds, attendanceLocked } =
    useMerge();

  const slots = availability.data?.slots ?? [];
  // Pending removal requests keyed by `${pairingId}:${tuteeId}` for quick lookup.
  const pendingByKey = new Map(
    (removalRequests.data ?? []).map((r) => [`${r.pairingId}:${r.tuteeId}`, r]),
  );

  if (pairings.isLoading)
    return <p className="muted">{t("tutor.pairings.loading")}</p>;
  const list = pairings.data ?? [];
  if (list.length === 0 && !pairings.error) {
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
      {dialog}
      {[pairings, workflowRoster, availability, removalRequests].some(
        (query) => query.error,
      ) && (
        <div role="alert" className="mb-3 text-sm text-red-700">
          <p>{t("tutor.tasks.loadError")}</p>
          <button
            className="btn-secondary btn-sm"
            onClick={() => {
              for (const query of [
                pairings,
                workflowRoster,
                availability,
                removalRequests,
              ])
                if (query.error) void query.refetch();
            }}
          >
            {t("tutor.tasks.retry")}
          </button>
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {list.map((p) => (
          <li key={p.id} className="py-3">
            <p className="font-medium text-wrap text-slate-900">
              {p.subject}
              <span className="muted font-normal">
                {" · "}
                {pairingScheduleText(p, t("scheduling.awaiting"))}
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
                <p className="muted text-sm">
                  {t("tutor.pairings.noTuteesYet")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {p.tutees.map((x) => {
                    const workflowRow = workflowRoster.data?.find(
                      (r) => r.tuteeId === x.tuteeId && r.pairingId === p.id,
                    );
                    const key = `${p.id}:${x.tuteeId}`;
                    const pendingRequest = pendingByKey.get(key);
                    const pendingId = pendingRequest?.id;
                    const composing =
                      removing?.pairingId === p.id &&
                      removing?.tuteeId === x.tuteeId;
                    return (
                      <li key={x.tuteeId} className="text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 text-slate-700">
                            {x.tutee.englishName}
                          </span>
                          {workflowRow && !workflowRow.managed && (
                            <StudentScheduleAction
                              row={workflowRow}
                              active={active}
                              name={x.tutee.englishName}
                            />
                          )}
                          {workflowRow?.managed ? (
                            <StudentScheduleAction
                              row={workflowRow}
                              active={active}
                              name={x.tutee.englishName}
                            />
                          ) : pendingId ? (
                            <>
                              <span className="badge-amber">
                                {t("tutor.pairings.removalPending")}
                              </span>
                              {pendingRequest?.eligibleAt && (
                                <span className="text-xs text-amber-800">
                                  {t("tutor.tasks.recallDeadline", {
                                    date: format.dateTime(
                                      pendingRequest.eligibleAt,
                                      {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      },
                                    ),
                                  })}
                                </span>
                              )}
                              {/* Recalling a pending relay remains permitted while inactive. */}
                              <button
                                className="link-danger inline-flex min-h-11 items-center text-xs lg:min-h-7"
                                disabled={recallRemoval.isPending}
                                onClick={async () => {
                                  if (
                                    await confirm({
                                      title: t("tutor.pairings.removalRecall"),
                                      message: t("tutor.tasks.recallRemoval", {
                                        name: x.tutee.englishName,
                                        subject: p.subject,
                                      }),
                                      confirmLabel: t(
                                        "tutor.pairings.removalRecall",
                                      ),
                                      cancelLabel: t("common.cancel"),
                                    })
                                  ) {
                                    setLastAction("recall");
                                    recallRemoval.mutate({
                                      requestId: pendingId,
                                    });
                                  }
                                }}
                              >
                                {t("tutor.pairings.removalRecall")}
                              </button>
                            </>
                          ) : composing ||
                            !active ||
                            !workflowRoster.data ||
                            !removalRequests.data ? null : (
                            <button
                              className="link inline-flex min-h-11 items-center text-xs lg:min-h-7"
                              disabled={requestRemoval.isPending}
                              onClick={() => {
                                setRemoving({
                                  pairingId: p.id,
                                  tuteeId: x.tuteeId,
                                });
                                setReason("");
                                setLastAction(null);
                              }}
                            >
                              {t("tutor.pairings.requestRemoval")}
                            </button>
                          )}
                        </div>
                        {composing && (
                          <div className="mt-1 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                            <p className="muted text-xs">
                              {t("tutor.pairings.removalHelp")}
                            </p>
                            <textarea
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder={t(
                                "tutor.pairings.removalReasonPlaceholder",
                              )}
                              className="textarea w-full text-sm"
                              aria-label={t(
                                "tutor.pairings.removalReasonPlaceholder",
                              )}
                              disabled={requestRemoval.isPending}
                              rows={2}
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="btn-secondary btn-sm"
                                disabled={requestRemoval.isPending}
                                onClick={async () => {
                                  if (
                                    !(await confirm({
                                      title: t("tutor.pairings.requestRemoval"),
                                      message: t("tutor.tasks.confirmRemoval", {
                                        name: x.tutee.englishName,
                                        subject: p.subject,
                                      }),
                                      confirmLabel: t(
                                        "tutor.pairings.removalSubmit",
                                      ),
                                      cancelLabel: t("common.cancel"),
                                    }))
                                  )
                                    return;
                                  setLastAction("request");
                                  requestRemoval.mutate(
                                    {
                                      pairingId: p.id,
                                      tuteeId: x.tuteeId,
                                      reason: reason.trim() || undefined,
                                    },
                                    {
                                      onSuccess: () => {
                                        setRemoving(null);
                                        setReason("");
                                      },
                                    },
                                  );
                                }}
                              >
                                {t("tutor.pairings.removalSubmit")}
                              </button>
                              <button
                                className="btn-secondary btn-sm"
                                disabled={requestRemoval.isPending}
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
            </div>
            {active && (
              <div className="mt-2 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                <span className="text-xs font-medium text-slate-500">
                  {t("tutor.pairings.defaultSlotLabel")}
                </span>
                <select
                  value={p.timeSlotId ?? ""}
                  aria-label={`${p.subject}: ${t("tutor.pairings.defaultSlotLabel")}`}
                  disabled={setSlot.isPending}
                  onChange={async (e) => {
                    const slotId = e.target.value || null;
                    const slot = slots.find((s) => s.id === slotId);
                    if (
                      !(await confirm({
                        title: t("tutor.tasks.changeSchedule"),
                        message: t("tutor.tasks.confirmSchedule", {
                          subject: p.subject,
                          slot: slot
                            ? `${slot.label} · ${DAY_NAMES[slot.dayOfWeek]} ${minToHm(slot.startMin)}–${minToHm(slot.endMin)}`
                            : t("scheduling.noLinkedSlot"),
                        }),
                        confirmLabel: t("common.save"),
                        cancelLabel: t("common.cancel"),
                      }))
                    )
                      return;
                    setLastAction("slot");
                    setSlot.mutate({
                      pairingId: p.id,
                      slotId,
                    });
                  }}
                  className="select min-w-0 sm:w-auto"
                >
                  <option value="">{t("scheduling.noLinkedSlot")}</option>
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} · {DAY_NAMES[s.dayOfWeek]} {minToHm(s.startMin)}
                      –{minToHm(s.endMin)}
                    </option>
                  ))}
                </select>
                {p.timeSlot && (
                  <span className="muted">
                    ({DAY_NAMES[p.timeSlot.dayOfWeek]}{" "}
                    {minToHm(p.timeSlot.startMin)}–{minToHm(p.timeSlot.endMin)})
                  </span>
                )}
              </div>
            )}
            {p.scheduleConfirmed && !p.timeSlotId && (
              <p className="muted mt-1 text-sm">{t("scheduling.retained")}</p>
            )}
          </li>
        ))}
      </ul>
      {feedback?.error && (
        <p role="alert" className="text-sm text-red-700">
          {feedback.error.message}
        </p>
      )}
      {feedback?.isSuccess && (
        <p role="status" className="text-sm text-green-700">
          {t(
            lastAction === "request"
              ? "tutor.tasks.removalSubmitted"
              : "workflows.saved",
          )}
        </p>
      )}

      {/* Merge sessions — combine several of your pairings into one attendance block. */}
      {active && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="label">{t("tutor.pairings.mergeTitle")}</p>
          {!primary ? (
            <p className="muted mt-1 text-xs">
              {t("tutor.pairings.mergeSelectPrimary")}
            </p>
          ) : mergeCandidates.length === 0 ? (
            <p className="muted mt-1 text-xs">
              {t("tutor.pairings.mergeNone")}
            </p>
          ) : (
            <>
              <p className="muted mt-1 mb-2 text-xs">
                {t("tutor.pairings.mergeHelp")}
              </p>
              <div className="space-y-1">
                {mergeCandidates.map((p) => (
                  <label
                    key={p.id}
                    className="flex min-h-11 items-center gap-2 text-sm lg:min-h-8"
                  >
                    <input
                      type="checkbox"
                      disabled={attendanceLocked}
                      checked={mergeIds.includes(p.id)}
                      onChange={(e) =>
                        setMergeIds((ids) =>
                          e.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span className="truncate">
                      {p.subject} ·{" "}
                      {pairingScheduleText(p, t("scheduling.awaiting"))}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

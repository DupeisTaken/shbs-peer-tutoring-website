"use client";
import { participantNameLabel } from "~/app/_components/participant-name";
import { pairingEntries } from "~/lib/pairing-groups";
import { PairingGroupEditor } from "./pairing-group-editor";
import { Button } from "~/app/_components/ui/button";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import { pairingScheduleText } from "~/lib/pairing-schedule";

import { PairingTuteeDetails } from "./pairing-tutee-details";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { formatWeekday, minToHm } from "~/lib/time";
import { useMerge } from "~/app/(tutor)/_components/merge-context";
import { useDialog } from "~/app/_components/confirm-dialog";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";

/**
 * The tutor's pairings, each with a control to pick the default reference time slot and to
 * relay a tutee opt-out (seven-day recall window). Picking a slot copies its day/time
 * onto the pairing (server-side, scoped to the caller).
 */
export function TutorPairings({ active = true }: { active?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { confirm, dialog } = useDialog();
  const utils = api.useUtils();
  const pairings = api.tutor.myPairings.useQuery();
  const workflowRoster = api.studentWorkflow.tutorRoster.useQuery();
  const availability = api.tutor.myAvailability.useQuery();
  const removalRequests = api.tutor.myTuteeRemovalRequests.useQuery();
  const denied = useSessionAccessDenied(
    pairings,
    workflowRoster,
    removalRequests,
  );
  const setSlot = api.tutor.setPairingSlot.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tutor.myPairings.invalidate(),
        utils.tutor.schedule.invalidate(),
      ]);
    },
  });

  const [lastAction, setLastAction] = useState<"slot" | null>(null);
  const feedback = lastAction === "slot" ? setSlot : null;

  const {
    primaryPairingId,
    mergeIds,
    setMergeIds,
    attendanceLocked,
    selectAttendance,
  } = useMerge();

  const slots = availability.data?.slots ?? [];
  // Pending removal requests keyed by `${pairingId}:${tuteeId}` for quick lookup.
  const pendingByKey = new Map(
    (removalRequests.data ?? []).map((r) => [`${r.pairingId}:${r.tuteeId}`, r]),
  );

  if (pairings.isLoading)
    return <p className="muted">{t("tutor.pairings.loading")}</p>;
  // An authoritative access failure must unmount cached assignment readers and drafts.
  if (denied)
    return (
      <div role="alert" className="text-sm text-red-700">
        <p>{t("tutor.tasks.loadError")}</p>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            void pairings.refetch();
            void workflowRoster.refetch();
            void removalRequests.refetch();
          }}
        >
          {t("tutor.tasks.retry")}
        </button>
      </div>
    );
  const list = pairings.data ?? [];
  if (list.length === 0 && !pairings.error) {
    return <p className="muted">{t("tutor.pairings.empty")}</p>;
  }

  const primary = list.find((p) => p.id === primaryPairingId);
  const mergeCandidates = primary
    ? list.filter((p) => p.id !== primary.id)
    : [];

  const entries = pairingEntries(list);
  // A member's legacy slot control changes the whole group; the confirmation
  // names every affected subject so it describes the server's actual write.
  const scheduleSubjects = (pairingId: string) =>
    entries
      .find((entry) => entry.pairings.some((p) => p.id === pairingId))
      ?.pairings.map((p) => p.subject)
      .join(" + ");
  const renderAssignment = (p: (typeof list)[number]) => (
    <li key={p.id} className="py-3">
      <p className="font-medium text-wrap text-slate-900">
        {p.subject}
        <span className="muted font-normal">
          {" · "}
          {pairingScheduleText(p, t("scheduling.awaiting"), locale)}
        </span>
      </p>
      <p className="muted">
        {p.room
          ? t("tutor.pairings.roomOnly", { room: p.room.name })
          : t("tutor.pairings.noRoom")}
      </p>

      {/* Default scheduling belongs before the roster/availability actions. */}
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
                    subject: scheduleSubjects(p.id) ?? p.subject,
                    slot: slot
                      ? `${slot.label} · ${formatWeekday(slot.dayOfWeek, locale)} ${minToHm(slot.startMin)}–${minToHm(slot.endMin)}`
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
                {s.label} · {formatWeekday(s.dayOfWeek, locale)}{" "}
                {minToHm(s.startMin)}–{minToHm(s.endMin)}
              </option>
            ))}
          </select>
          {p.timeSlot && (
            <span className="muted">
              ({formatWeekday(p.timeSlot.dayOfWeek, locale)}{" "}
              {minToHm(p.timeSlot.startMin)}–{minToHm(p.timeSlot.endMin)})
            </span>
          )}
        </div>
      )}

      {/* Keep the roster brief; each Details owner retains its own request drafts. */}
      <div className="mt-2">
        {p.tutees.length === 0 ? (
          <p className="muted text-sm">{t("tutor.pairings.noTuteesYet")}</p>
        ) : (
          <ul className="space-y-1">
            {p.tutees.map((x) => {
              const name = participantNameLabel(
                x.tutee.englishName,
                x.tutee.user?.username,
                t("participantNames.unnamed"),
              );
              const workflowRow = workflowRoster.data?.find(
                (r) => r.tuteeId === x.tuteeId && r.pairingId === p.id,
              );
              const key = `${p.id}:${x.tuteeId}`;
              const pendingRequest = pendingByKey.get(key);
              return (
                <li
                  key={x.tuteeId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 break-words text-slate-700">
                    {name}
                  </span>
                  <PairingTuteeDetails
                    pairingId={p.id}
                    tuteeId={x.tuteeId}
                    name={name}
                    subject={p.subject}
                    active={active}
                    row={workflowRow}
                    pendingRequest={pendingRequest}
                    ready={!!workflowRoster.data && !!removalRequests.data}
                    failed={
                      !!pairings.error ||
                      !!workflowRoster.error ||
                      !!removalRequests.error
                    }
                    onRetry={() => {
                      void pairings.refetch();
                      void workflowRoster.refetch();
                      void removalRequests.refetch();
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {p.scheduleConfirmed && !p.timeSlotId && (
        <p className="muted mt-1 text-sm">{t("scheduling.retained")}</p>
      )}
    </li>
  );

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="muted text-sm">{t("pairingGroups.catalogueHelp")}</p>
        <PairingGroupEditor pairings={list} slots={slots} active={active} />
      </div>
      <ul className="divide-y divide-slate-100">
        {entries.map((entry) =>
          entry.groupId ? (
            <li key={entry.id} className="space-y-3 py-4">
              <p className="badge">{t("pairingGroups.combined")}</p>
              <h3 className="font-semibold text-wrap">
                {entry.pairings.map((p) => p.subject).join(" + ")}
              </h3>
              <p className="muted text-sm">
                {pairingScheduleText(
                  entry.primary,
                  t("scheduling.awaiting"),
                  locale,
                )}{" "}
                · {entry.primary.room?.name ?? t("pairingGroups.noRoom")}
              </p>
              <ul
                className="space-y-2"
                aria-label={t("pairingGroups.combinedRoster")}
              >
                {[
                  ...new Map(
                    entry.pairings
                      .flatMap((p) => p.tutees)
                      .map((x) => [x.tuteeId, x]),
                  ).values(),
                ].map((student) => (
                  <li key={student.tuteeId} className="text-sm">
                    <p>
                      {participantNameLabel(
                        student.tutee.englishName,
                        student.tutee.user?.username,
                        t("participantNames.unnamed"),
                      )}
                    </p>
                    <p className="muted text-xs">
                      {entry.pairings
                        .filter((p) =>
                          p.tutees.some((x) => x.tuteeId === student.tuteeId),
                        )
                        .map((p) => p.subject)
                        .join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
              {active && (
                <Button
                  size="compact"
                  disabled={attendanceLocked}
                  onClick={() => {
                    selectAttendance("group:" + entry.groupId);
                    document
                      .getElementById("attendance")
                      ?.scrollIntoView({ block: "start" });
                  }}
                >
                  {t("pairingGroups.record")}
                </Button>
              )}
              <DisclosureSection
                title={t("pairingGroups.memberDetails")}
                lifetime="retained"
              >
                <ul>{entry.pairings.map(renderAssignment)}</ul>
              </DisclosureSection>
            </li>
          ) : (
            renderAssignment(entry.primary)
          ),
        )}
      </ul>
      {feedback?.error && (
        <p role="alert" className="text-sm text-red-700">
          {feedback.error.message}
        </p>
      )}
      {feedback?.isSuccess && (
        <p role="status" className="text-sm text-green-700">
          {t("workflows.saved")}
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
                      disabled={
                        attendanceLocked ||
                        (!mergeIds.includes(p.id) && mergeIds.length >= 5)
                      }
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
                      {pairingScheduleText(p, t("scheduling.awaiting"), locale)}
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

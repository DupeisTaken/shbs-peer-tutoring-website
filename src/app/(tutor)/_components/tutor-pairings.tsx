"use client";
import { invalidateWorkloads } from "~/lib/workload-cache";
import { participantNameLabel } from "~/app/_components/participant-name";
import { pairingEntries } from "~/lib/pairing-groups";
import { PairingGroupEditor } from "./pairing-group-editor";
import { Button } from "~/app/_components/ui/button";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import { pairingScheduleText } from "~/lib/pairing-schedule";
import { rankMutualAvailability } from "~/lib/mutual-availability";
import { plannedIntervalsOverlap } from "~/lib/planned-scheduling";

import { PairingTuteeDetails } from "./pairing-tutee-details";
import { useLayoutEffect, useRef, useState } from "react";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { RoomAllocationStatus } from "~/app/_components/room-allocation-status";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { formatWeekday, minToHm } from "~/lib/time";
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
  const a = useTranslations("roomAllocation");
  const { confirm, dialog } = useDialog();
  const utils = api.useUtils();
  const pairings = api.tutor.myPairings.useQuery();
  const workflowRoster = api.studentWorkflow.tutorRoster.useQuery();
  const availability = api.tutor.myAvailability.useQuery();
  const removalRequests = api.tutor.myTuteeRemovalRequests.useQuery();
  const denied = useSessionAccessDenied(
    pairings,
    workflowRoster,
    availability,
    removalRequests,
  );
  const slotEligibility = useRef({ active, blocked: true });
  useLayoutEffect(() => {
    slotEligibility.current = {
      active,
      blocked:
        denied ||
        !!pairings.error ||
        !!availability.error ||
        !availability.data,
    };
  }, [active, denied, pairings.error, availability.error, availability.data]);
  const slotAdmitted = useRef(false);
  const slotAccepted = useRef(false);
  const slotTarget = useRef<string | undefined>(undefined);
  const [slotDrafts, setSlotDrafts] = useState<
    Record<string, { slotId: string | null; version: number }>
  >({});
  const clearSlotDraft = (id: string) =>
    setSlotDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  const [slotWorking, setSlotWorking] = useState(false);
  const [slotOutcome, setSlotOutcome] = useState<string>();
  const [slotRefreshFailed, setSlotRefreshFailed] = useState(false);
  const refreshSlot = async () => {
    setSlotWorking(true);
    setSlotRefreshFailed(false);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.tutor.myPairings),
        () => invalidateAndReport(utils.tutor.schedule),
        // The same account may also have an inactive management reader cached.
        () =>
          utils.admin?.pairings
            ? invalidateAndReport(utils.admin.pairings)
            : Promise.resolve(),
        () =>
          availability.refetch({ throwOnError: true }).then((result) => {
            if (!result.isSuccess)
              throw new Error("Availability refresh failed");
          }),
        () => invalidateAndReport(utils.student.me),
        () => invalidateAndReport(utils.studentWorkflow.mine),
        () => invalidateAndReport(utils.pairingGroups.mine),
        () => invalidateWorkloads(utils, true),
        () => invalidateAndReport(utils.notification.list),
        () => invalidateAndReport(utils.notification.unreadCount),
      ]);
      slotAdmitted.current = false;
      if (slotAccepted.current && slotTarget.current)
        clearSlotDraft(slotTarget.current);
    } catch {
      setSlotRefreshFailed(true);
    } finally {
      setSlotWorking(false);
    }
  };
  const setSlot = api.tutor.setPairingSlot.useMutation({
    // Completion and synchronization are separate: failed reads leave a read-only
    // retry and cannot replay the accepted allocation.
    onSuccess: async (result) => {
      slotAccepted.current = true;
      setSlotOutcome(result.roomOutcome);
      await refreshSlot();
    },
    onError: () => {
      slotAdmitted.current = false;
      slotAccepted.current = false;
      setSlotWorking(false);
    },
  });

  const changeSlot = async (
    p: NonNullable<typeof pairings.data>[number],
    slotId: string | null,
  ) => {
    if (
      slotAdmitted.current ||
      !slotEligibility.current.active ||
      slotEligibility.current.blocked ||
      slotRefreshFailed
    )
      return;
    const entry = pairingEntries(pairings.data ?? []).find((item) =>
      item.pairings.some((member) => member.id === p.id),
    );
    const candidate = availability.data?.slots.find(
      (slot) => slot.id === slotId,
    );
    const exclusions =
      entry?.groupId && entry.groupStatus !== "needsRepair"
        ? entry.pairings.map((member) => member.id)
        : [p.id];
    // Native disabled options are also guarded at admission, including retries
    // of a retained draft after the occupied timetable changes.
    if (
      entry?.groupStatus === "needsRepair" ||
      (candidate &&
        (pairings.data ?? []).some(
          (other) =>
            !exclusions.includes(other.id) &&
            other.termId === p.termId &&
            other.scheduleConfirmed &&
            plannedIntervalsOverlap(candidate, other),
        ))
    )
      return;
    const draft = {
      slotId,
      version: slotDrafts[p.id]?.version ?? p.roomVersion,
    };
    const slot = availability.data?.slots.find((s) => s.id === slotId);
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
    if (
      slotAdmitted.current ||
      !slotEligibility.current.active ||
      slotEligibility.current.blocked
    )
      return;
    // Keep the attempted slot and its original concurrency version until a save
    // has synchronized, or an explicit successful Reload discards this draft.
    setSlotDrafts((current) => ({ ...current, [p.id]: draft }));
    slotTarget.current = p.id;
    slotAccepted.current = false;
    slotAdmitted.current = true;
    setSlotWorking(true);
    setSlotOutcome(undefined);
    setLastAction("slot");
    setSlot.mutate({
      pairingId: p.id,
      slotId: draft.slotId,
      expectedRoomVersion: draft.version,
    });
  };
  const reloadSlot = async (id: string) => {
    if (slotWorking) return;
    setSlotWorking(true);
    try {
      const result = await pairings.refetch({ throwOnError: true });
      if (result.data?.some((p) => p.id === id)) clearSlotDraft(id);
    } catch {
      /* Retain the original draft; the query owns its recovery message. */
    } finally {
      setSlotWorking(false);
    }
  };

  const [lastAction, setLastAction] = useState<"slot" | null>(null);
  const feedback = lastAction === "slot" ? setSlot : null;

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
            void availability.refetch();
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

  const entries = pairingEntries(list);
  // A member's legacy slot control changes the whole group; the confirmation
  // names every affected subject so it describes the server's actual write.
  const scheduleSubjects = (pairingId: string) =>
    entries
      .find((entry) => entry.pairings.some((p) => p.id === pairingId))
      ?.pairings.map((p) => p.subject)
      .join(" + ");
  const renderAssignment = (p: (typeof list)[number]) => {
    // A member control schedules its entire saved group. Recommendations must
    // therefore include every current tutee affected by that reviewed write.
    const entry = entries.find((entry) =>
      entry.pairings.some((member) => member.id === p.id),
    );
    const members = entry?.pairings ?? [p];
    const excluded = new Set(
      entry?.groupId && entry.groupStatus !== "needsRepair"
        ? members.map((member) => member.id)
        : [p.id],
    );
    const conflicting = (slot: (typeof slots)[number]) =>
      list.find(
        (other) =>
          !excluded.has(other.id) &&
          other.termId === p.termId &&
          other.scheduleConfirmed &&
          plannedIntervalsOverlap(slot, other),
      );
    const currentTutees = [
      ...new Map(
        members.flatMap((member) =>
          member.tutees.map(
            (student) =>
              [student.tuteeId, { student, pairingId: member.id }] as const,
          ),
        ),
      ).values(),
    ];
    const ranking = rankMutualAvailability({
      slots,
      tutorSlotIds: availability.data?.selectedSlotIds,
      tutees: currentTutees.map(({ student, pairingId }) => ({
        id: student.tuteeId,
        slotIds: workflowRoster.data
          ?.find(
            (row) =>
              row.pairingId === pairingId && row.tuteeId === student.tuteeId,
          )
          ?.slots.map((slot) => slot.id),
      })),
      ready:
        !!workflowRoster.data &&
        !workflowRoster.error &&
        !!availability.data &&
        !availability.error,
    });
    // Group the existing advisory ranking without changing selection or save
    // ownership. Unknown availability never qualifies as shared by everyone.
    const slotGroups = [
      {
        key: "bothAvailable",
        options: ranking.ranked.filter((s) => s.mutual && !conflicting(s.slot)),
        disabled: false,
      },
      {
        key: "otherTimeSlots",
        options: ranking.ranked.filter(
          (s) => !s.mutual && !conflicting(s.slot),
        ),
        disabled: false,
      },
      {
        key: "unavailable",
        options: ranking.ranked.filter((s) => conflicting(s.slot)),
        disabled: true,
      },
    ] as const;
    return (
      <li key={p.id} className="py-3">
        <p className="font-medium text-wrap text-slate-900">
          {p.subject}
          <span className="muted font-normal">
            {" · "}
            {pairingScheduleText(p, t("scheduling.awaiting"), locale)}
          </span>
        </p>
        <RoomAllocationStatus pairing={p} />

        {/* Default scheduling belongs before the roster/availability actions. */}
        {active && (
          <div className="mt-2 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
            <span className="text-xs font-medium text-slate-500">
              {t("tutor.pairings.defaultSlotLabel")}
            </span>
            <select
              value={
                slotDrafts[p.id]?.slotId ??
                (slotDrafts[p.id] ? "" : p.timeSlotId) ??
                ""
              }
              aria-label={`${p.subject}: ${t("tutor.pairings.defaultSlotLabel")}`}
              disabled={
                setSlot.isPending ||
                slotWorking ||
                slotRefreshFailed ||
                !!pairings.error ||
                !!availability.error ||
                entry?.groupStatus === "needsRepair"
              }
              onChange={(e) => void changeSlot(p, e.target.value || null)}
              className="select min-w-0 sm:w-auto"
            >
              <option value="">{t("scheduling.noLinkedSlot")}</option>
              {p.timeSlotId &&
                !slots.some((slot) => slot.id === p.timeSlotId) && (
                  <option value={p.timeSlotId} disabled>
                    {t("tutor.pairings.ranking.retainedOption")} ·{" "}
                    {pairingScheduleText(p, t("scheduling.awaiting"), locale)}
                  </option>
                )}
              {slotGroups.map(({ key, options, disabled }) =>
                options.length > 0 ? (
                  <optgroup
                    key={key}
                    label={t(`tutor.pairings.ranking.${key}`)}
                  >
                    {options.map(({ slot: s }) => (
                      <option key={s.id} value={s.id} disabled={disabled}>
                        {s.label} · {formatWeekday(s.dayOfWeek, locale)}{" "}
                        {minToHm(s.startMin)}–{minToHm(s.endMin)}
                        {disabled
                          ? ` · ${t("pairingGroups.slotConflict", { subjects: conflicting(s)!.subject })}`
                          : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            {slotDrafts[p.id] && !slotWorking && !slotRefreshFailed && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="compact"
                  disabled={!!pairings.error || !!availability.error}
                  onClick={() => void changeSlot(p, slotDrafts[p.id]!.slotId)}
                >
                  {t("common.save")}
                </Button>
                <Button size="compact" onClick={() => void reloadSlot(p.id)}>
                  {a("reload")}
                </Button>
              </div>
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
  };

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
        <PairingGroupEditor
          pairings={list}
          slots={slots}
          active={
            active && !slotWorking && !pairings.error && !availability.error
          }
        />
      </div>
      <ul className="divide-y divide-slate-100">
        {entries.map((entry) =>
          entry.groupId ? (
            <li key={entry.id} className="space-y-3 py-4">
              <p className="badge">{t("pairingGroups.combined")}</p>
              <h3 className="font-semibold text-wrap">
                {[...new Set(entry.pairings.map((p) => p.subject))].join(" + ")}
              </h3>
              {entry.groupStatus === "needsRepair" && (
                <InlineNotice tone="warning">
                  {t("pairingGroups.needsRepair")}
                </InlineNotice>
              )}
              <p className="muted text-sm">
                {pairingScheduleText(
                  entry.primary,
                  t("scheduling.awaiting"),
                  locale,
                )}{" "}
              </p>
              <RoomAllocationStatus pairing={entry.primary} />
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
                        .filter(
                          (subject, index, all) =>
                            all.indexOf(subject) === index,
                        )
                        .join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
              {active && (
                <a
                  className="link inline-flex min-h-11 items-center lg:min-h-8"
                  href="#sessions"
                >
                  {t("sessionPlanning.viewSessions")}
                </a>
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
      {slotOutcome && (
        <InlineNotice
          tone={slotOutcome === "UNAVAILABLE" ? "warning" : "success"}
          announcement="status"
        >
          {a(`outcome.${slotOutcome}`)}
        </InlineNotice>
      )}
      {slotRefreshFailed && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={slotWorking} onClick={() => void refreshSlot()}>
              {a("retryRefresh")}
            </Button>
          }
        >
          {a(slotOutcome !== undefined ? "savedRefreshFailed" : "readFailed")}
        </InlineNotice>
      )}
      {(pairings.error ?? availability.error) && !slotRefreshFailed && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={slotWorking} onClick={() => void refreshSlot()}>
              {a("retryRefresh")}
            </Button>
          }
        >
          {a("readFailed")}
        </InlineNotice>
      )}
      {feedback?.error && (
        <p role="alert" className="text-sm text-red-700">
          {feedback.error.message}
        </p>
      )}
      {feedback?.isSuccess && lastAction !== "slot" && (
        <p role="status" className="text-sm text-green-700">
          {t("workflows.saved")}
        </p>
      )}
    </>
  );
}

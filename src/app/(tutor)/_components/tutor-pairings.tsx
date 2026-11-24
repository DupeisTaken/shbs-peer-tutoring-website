"use client";
import { invalidateWorkloads } from "~/lib/workload-cache";
import { participantNameLabel } from "~/app/_components/participant-name";
import { pairingEntries } from "~/lib/pairing-groups";
import { pairingGroupEligibility } from "~/lib/pairing-group-eligibility";
import {
  combineSelectionOptions,
  resolveCombineAddition,
  resolveCombineRemoval,
} from "~/lib/pairing-group-selection";
import {
  PairingGroupActionDialog,
  type PairingGroupAction,
} from "./pairing-group-editor";
import { Button } from "~/app/_components/ui/button";
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
 * Unified tutor pairings page: every pairing starts as its own 1-assignment
 * group and shares the same card layout and schedule/room/roster controls as
 * combined groups. Active tutors combine selected groups or split/repair
 * combined groups directly here.
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

  // Inline group selection for combining (hidden until triggered), plus the focused review dialog owner.
  const [selectingToCombine, setSelectingToCombine] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [autoSelectedIds, setAutoSelectedIds] = useState<string[]>([]);
  const [groupAction, setGroupAction] = useState<PairingGroupAction | null>(
    null,
  );

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
        () =>
          utils.sessionPlanning?.agenda
            ? invalidateAndReport(utils.sessionPlanning.agenda)
            : Promise.resolve(),
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
  const scheduleSubjects = (pairingId: string) =>
    entries
      .find((entry) => entry.pairings.some((p) => p.id === pairingId))
      ?.pairings.map((p) => p.subject)
      .join(" + ");

  const groupControlsReady =
    active &&
    !slotWorking &&
    !slotRefreshFailed &&
    !pairings.error &&
    !availability.error;
  const canSelectEntry = (entry: (typeof entries)[number]) =>
    groupControlsReady &&
    entry.groupStatus !== "needsRepair" &&
    entry.pairings.every((p) => p.tutees.length > 0);
  const showCombineCheckboxes =
    selectingToCombine && active && entries.length >= 2;
  const combineEntries = entries.map((entry) => ({
    id: entry.id,
    pairings: entry.pairings,
    selectable: canSelectEntry(entry),
  }));
  const selectableIds = new Set(
    combineEntries.filter((entry) => entry.selectable).map((entry) => entry.id),
  );
  // Filter stale selections during render without discarding valid choices on refresh.
  const activeSelectedIds = showCombineCheckboxes
    ? selectedEntryIds.filter((id) => selectableIds.has(id))
    : [];
  const selectionOptions = showCombineCheckboxes
    ? combineSelectionOptions(combineEntries, activeSelectedIds)
    : null;
  const hasAnySelectableOption = selectionOptions
    ? [...selectionOptions.values()].some((opt) => opt.enabled)
    : false;
  const selectedEntries = entries.filter((entry) =>
    activeSelectedIds.includes(entry.id),
  );
  const selectedPairings = selectedEntries.flatMap((entry) => entry.pairings);
  const selectionEligibility =
    activeSelectedIds.length >= 2
      ? pairingGroupEligibility(selectedPairings)
      : null;

  const studentLabel = (tuteeId: string) => {
    const student = list
      .flatMap((p) => p.tutees)
      .find((item) => item.tuteeId === tuteeId)?.tutee;
    return participantNameLabel(
      student?.englishName ?? "",
      student?.user?.username,
      t("participantNames.unnamed"),
    );
  };

  const entrySummaryLabel = (entryId: string) => {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return entryId;
    const subjects = [...new Set(entry.pairings.map((p) => p.subject))].join(
      " + ",
    );
    const names = [
      ...new Map(
        entry.pairings
          .flatMap((p) => p.tutees)
          .map((item) => [
            item.tuteeId,
            participantNameLabel(
              item.tutee.englishName,
              item.tutee.user?.username,
              t("participantNames.unnamed"),
            ),
          ]),
      ).values(),
    ].join(", ");
    return names ? `${subjects} (${names})` : subjects;
  };

  const toggleSelect = (entryId: string) => {
    if (activeSelectedIds.includes(entryId)) {
      const removed = resolveCombineRemoval(
        combineEntries,
        activeSelectedIds,
        entryId,
      );
      setSelectedEntryIds(removed.nextSelectedIds);
      setAutoSelectedIds([]);
      return;
    }
    const added = resolveCombineAddition(
      combineEntries,
      activeSelectedIds,
      entryId,
    );
    if (!added) return;
    setSelectedEntryIds(added.nextSelectedIds);
    setAutoSelectedIds(added.autoSelectedIds);
  };

  const openCombine = () => {
    if (
      !groupControlsReady ||
      activeSelectedIds.length < 2 ||
      !selectionEligibility?.eligible
    )
      return;
    const targetGroupId =
      selectedEntries.find((entry) => entry.groupId)?.groupId ?? undefined;
    setGroupAction({
      kind: "combine",
      pairingIds: selectedPairings.map((p) => p.id),
      targetGroupId,
    });
  };

  const renderGroupCard = (entry: (typeof entries)[number]) => {
    const primary = entry.primary;
    const members = entry.pairings;
    const subjects = [...new Set(members.map((p) => p.subject))];
    const subjectHeading = subjects.join(" + ");
    const isCombined = !!entry.groupId;
    const isSelected = activeSelectedIds.includes(entry.id);
    const checkboxEnabled = selectionOptions?.get(entry.id)?.enabled ?? false;
    const isUnavailableInCombine =
      showCombineCheckboxes && !isSelected && !checkboxEnabled;

    const excluded = new Set(
      entry.groupId && entry.groupStatus !== "needsRepair"
        ? members.map((member) => member.id)
        : [primary.id],
    );
    const conflicting = (slot: (typeof slots)[number]) =>
      list.find(
        (other) =>
          !excluded.has(other.id) &&
          other.termId === primary.termId &&
          other.scheduleConfirmed &&
          plannedIntervalsOverlap(slot, other),
      );

    // Deduplicate students across every member pairing while keeping each
    // (pairingId, tuteeId) assignment owner independent for Details actions.
    const rosterMap = new Map<
      string,
      {
        tuteeId: string;
        tutee: (typeof members)[number]["tutees"][number]["tutee"];
        assignments: { pairingId: string; subject: string }[];
      }
    >();
    for (const member of members) {
      for (const student of member.tutees) {
        const existing = rosterMap.get(student.tuteeId);
        if (existing) {
          existing.assignments.push({
            pairingId: member.id,
            subject: member.subject,
          });
        } else {
          rosterMap.set(student.tuteeId, {
            tuteeId: student.tuteeId,
            tutee: student.tutee,
            assignments: [{ pairingId: member.id, subject: member.subject }],
          });
        }
      }
    }
    const roster = [...rosterMap.values()];

    const ranking = rankMutualAvailability({
      slots,
      tutorSlotIds: availability.data?.selectedSlotIds,
      tutees: roster.map((student) => ({
        id: student.tuteeId,
        slotIds: workflowRoster.data
          ?.find(
            (row) =>
              row.tuteeId === student.tuteeId &&
              student.assignments.some(
                (item) => item.pairingId === row.pairingId,
              ),
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

    const studentNamesSummary = roster
      .map((student) =>
        participantNameLabel(
          student.tutee.englishName,
          student.tutee.user?.username,
          t("participantNames.unnamed"),
        ),
      )
      .join(", ");
    const selectionName = studentNamesSummary
      ? `${subjectHeading} (${studentNamesSummary})`
      : subjectHeading;
    const rosterLabel = isCombined
      ? t("pairingGroups.combinedRoster")
      : t("admin.pairings.colTutees");

    return (
      <li key={entry.id} className="py-2">
        <div
          className={`min-w-0 rounded-xl border transition-opacity ${
            isSelected
              ? "border-accent-500 ring-accent-500/20 ring-2"
              : isUnavailableInCombine
                ? "border-slate-200/80 bg-slate-50/70 opacity-55"
                : "border-slate-200"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b border-slate-100 bg-slate-50/50 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              {showCombineCheckboxes && (
                <label
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center lg:min-h-8 lg:min-w-8 ${
                    checkboxEnabled
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!checkboxEnabled}
                    aria-label={t("pairingGroups.selectToCombine", {
                      group: selectionName,
                    })}
                    onChange={() => toggleSelect(entry.id)}
                  />
                </label>
              )}
              <h3 className="min-w-0 text-base font-semibold break-words text-slate-900">
                {subjectHeading}
              </h3>
              {isCombined && (
                <span className="badge-slate">
                  {t("pairingGroups.combined")}
                </span>
              )}
            </div>
            {active && (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  className="link inline-flex min-h-11 items-center text-sm font-medium lg:min-h-8"
                  href="#sessions"
                >
                  {t("sessionPlanning.viewSessions")}
                </a>
                {isCombined && (
                  <Button
                    size="compact"
                    disabled={!groupControlsReady}
                    onClick={() =>
                      setGroupAction({ kind: "split", groupId: entry.groupId! })
                    }
                  >
                    {entry.groupStatus === "needsRepair"
                      ? t("pairingGroups.repairOrSplit")
                      : t("pairingGroups.split")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3 p-4">
            {entry.groupStatus === "needsRepair" && (
              <InlineNotice tone="warning">
                {t("pairingGroups.needsRepair")}
              </InlineNotice>
            )}
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="min-w-0 space-y-3">
                <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium text-slate-600">
                      {isCombined
                        ? t("pairingGroups.schedule")
                        : t("pairingGroups.scheduleLabel")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium break-words text-slate-900">
                      {pairingScheduleText(
                        primary,
                        t("scheduling.awaiting"),
                        locale,
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-medium text-slate-600">
                      {t("roomAllocation.room")}
                    </dt>
                    <dd className="mt-1 text-sm break-words text-slate-900">
                      <RoomAllocationStatus pairing={primary} />
                    </dd>
                  </div>
                </dl>

                {/* Default scheduling belongs before the roster/availability actions. */}
                {active && (
                  <div className="grid gap-2">
                    <label className="grid justify-items-start gap-1">
                      <span className="text-xs font-medium text-slate-600">
                        {t("tutor.pairings.defaultSlotLabel")}
                      </span>
                      <select
                        value={
                          slotDrafts[primary.id]?.slotId ??
                          (slotDrafts[primary.id] ? "" : primary.timeSlotId) ??
                          ""
                        }
                        aria-label={`${subjectHeading}: ${t("tutor.pairings.defaultSlotLabel")}`}
                        disabled={
                          setSlot.isPending ||
                          slotWorking ||
                          slotRefreshFailed ||
                          !!pairings.error ||
                          !!availability.error ||
                          entry.groupStatus === "needsRepair"
                        }
                        onChange={(e) =>
                          void changeSlot(primary, e.target.value || null)
                        }
                        className="select control-compact field-auto-bounded [--field-min-width:11rem] lg:min-h-8 lg:py-1"
                      >
                        <option value="">{t("scheduling.noLinkedSlot")}</option>
                        {primary.timeSlotId &&
                          !slots.some(
                            (slot) => slot.id === primary.timeSlotId,
                          ) && (
                            <option value={primary.timeSlotId} disabled>
                              {t("tutor.pairings.ranking.retainedOption")} ·{" "}
                              {pairingScheduleText(
                                primary,
                                t("scheduling.awaiting"),
                                locale,
                              )}
                            </option>
                          )}
                        {slotGroups.map(({ key, options, disabled }) =>
                          options.length > 0 ? (
                            <optgroup
                              key={key}
                              label={t(`tutor.pairings.ranking.${key}`)}
                            >
                              {options.map(({ slot: s }) => (
                                <option
                                  key={s.id}
                                  value={s.id}
                                  disabled={disabled}
                                >
                                  {s.label} ·{" "}
                                  {formatWeekday(s.dayOfWeek, locale)}{" "}
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
                    </label>
                    {slotDrafts[primary.id] &&
                      !slotWorking &&
                      !slotRefreshFailed && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="compact"
                            disabled={!!pairings.error || !!availability.error}
                            onClick={() =>
                              void changeSlot(
                                primary,
                                slotDrafts[primary.id]!.slotId,
                              )
                            }
                          >
                            {t("common.save")}
                          </Button>
                          <Button
                            size="compact"
                            onClick={() => void reloadSlot(primary.id)}
                          >
                            {a("reload")}
                          </Button>
                        </div>
                      )}
                  </div>
                )}

                {primary.scheduleConfirmed && !primary.timeSlotId && (
                  <p className="muted text-sm">{t("scheduling.retained")}</p>
                )}
              </div>

              {/* Keep the roster brief; each Details owner retains its own request drafts. */}
              <div className="min-w-0 border-t border-slate-100 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-4">
                <p className="mb-1.5 text-xs font-medium text-slate-600">
                  {rosterLabel}
                </p>
                {roster.length === 0 ? (
                  <p className="muted text-sm">
                    {t("tutor.pairings.noTuteesYet")}
                  </p>
                ) : (
                  <ul className="space-y-1.5" aria-label={rosterLabel}>
                    {roster.map((student) => {
                      const name = participantNameLabel(
                        student.tutee.englishName,
                        student.tutee.user?.username,
                        t("participantNames.unnamed"),
                      );
                      const studentSubjects = [
                        ...new Set(student.assignments.map((x) => x.subject)),
                      ];
                      if (student.assignments.length === 1) {
                        const item = student.assignments[0]!;
                        const workflowRow = workflowRoster.data?.find(
                          (r) =>
                            r.tuteeId === student.tuteeId &&
                            r.pairingId === item.pairingId,
                        );
                        const pendingRequest = pendingByKey.get(
                          `${item.pairingId}:${student.tuteeId}`,
                        );
                        return (
                          <li
                            key={student.tuteeId}
                            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-1.5 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-medium break-words text-slate-900">
                                {name}
                              </p>
                              {/* One shared subject is already named in the panel heading. */}
                              {subjects.length > 1 && (
                                <p className="mt-0.5 text-xs break-words text-slate-600">
                                  {item.subject}
                                </p>
                              )}
                            </div>
                            <PairingTuteeDetails
                              pairingId={item.pairingId}
                              tuteeId={student.tuteeId}
                              name={name}
                              subject={item.subject}
                              active={active}
                              row={workflowRow}
                              pendingRequest={pendingRequest}
                              ready={
                                !!workflowRoster.data && !!removalRequests.data
                              }
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
                      }

                      return (
                        <li
                          key={student.tuteeId}
                          className="min-w-0 space-y-2 rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-1.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="font-medium break-words text-slate-900">
                              {name}
                            </p>
                            {subjects.length > 1 && (
                              <p className="mt-0.5 text-xs break-words text-slate-600">
                                {studentSubjects.join(", ")}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1 border-t border-slate-200/70 pt-1.5">
                            {student.assignments.map((item) => {
                              const workflowRow = workflowRoster.data?.find(
                                (r) =>
                                  r.tuteeId === student.tuteeId &&
                                  r.pairingId === item.pairingId,
                              );
                              const pendingRequest = pendingByKey.get(
                                `${item.pairingId}:${student.tuteeId}`,
                              );
                              return (
                                <div
                                  key={item.pairingId}
                                  className="flex items-center justify-between gap-2 text-xs text-slate-600"
                                >
                                  {subjects.length > 1 && (
                                    <span className="min-w-0 break-words">
                                      {item.subject}
                                    </span>
                                  )}
                                  <PairingTuteeDetails
                                    pairingId={item.pairingId}
                                    tuteeId={student.tuteeId}
                                    name={name}
                                    subject={item.subject}
                                    includeSubjectInLabel={subjects.length > 1}
                                    active={active}
                                    row={workflowRow}
                                    pendingRequest={pendingRequest}
                                    ready={
                                      !!workflowRoster.data &&
                                      !!removalRequests.data
                                    }
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
                                </div>
                              );
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
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

      {active && entries.length >= 2 && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted text-sm">{t("pairingGroups.catalogueHelp")}</p>
            {!showCombineCheckboxes && (
              <Button
                size="compact"
                disabled={!groupControlsReady}
                onClick={() => {
                  setSelectedEntryIds([]);
                  setAutoSelectedIds([]);
                  setSelectingToCombine(true);
                }}
              >
                {t("pairingGroups.confirmCombine")}
              </Button>
            )}
          </div>
          {showCombineCheckboxes && (
            <div
              role="region"
              aria-label={t("pairingGroups.combineTitle")}
              className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">
                  {t("pairingGroups.selectedSummary", {
                    groups: activeSelectedIds.length,
                    assignments: selectedPairings.length,
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="compact"
                    onClick={() => {
                      setSelectedEntryIds([]);
                      setAutoSelectedIds([]);
                      setSelectingToCombine(false);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    size="compact"
                    disabled={
                      !groupControlsReady ||
                      activeSelectedIds.length < 2 ||
                      !selectionEligibility?.eligible
                    }
                    onClick={openCombine}
                  >
                    {t("pairingGroups.combineSelected")}
                  </Button>
                </div>
              </div>
              {activeSelectedIds.length === 0 && !hasAnySelectableOption ? (
                <InlineNotice tone="info">
                  {t("pairingGroups.noCompatibleGroups")}
                </InlineNotice>
              ) : (
                activeSelectedIds.length < 2 && (
                  <p className="muted text-sm">
                    {t("pairingGroups.selectMore")}
                  </p>
                )
              )}
              {autoSelectedIds.some((id) => activeSelectedIds.includes(id)) && (
                <p role="status" className="text-xs text-slate-600">
                  {t("pairingGroups.autoSelectedCompanions", {
                    groups: autoSelectedIds
                      .filter((id) => activeSelectedIds.includes(id))
                      .map(entrySummaryLabel)
                      .join(", "),
                  })}
                </p>
              )}
              {selectionEligibility && !selectionEligibility.eligible && (
                <InlineNotice tone="warning">
                  <p>
                    {t(
                      `pairingGroups.eligibility.${selectionEligibility.reason ?? "size"}`,
                    )}
                  </p>
                  {selectionEligibility.missing.map((missing) => (
                    <p key={missing.tuteeId}>
                      {t("pairingGroups.missingCoverage", {
                        student: studentLabel(missing.tuteeId),
                        subjects: missing.subjects.join(", "),
                      })}
                    </p>
                  ))}
                </InlineNotice>
              )}
            </div>
          )}
        </div>
      )}

      <ul className="space-y-1">{entries.map(renderGroupCard)}</ul>

      {groupAction && (
        <PairingGroupActionDialog
          action={groupAction}
          active={groupControlsReady}
          onClose={() => setGroupAction(null)}
          onSaved={() => {
            setSelectedEntryIds([]);
            setAutoSelectedIds([]);
            setSelectingToCombine(false);
          }}
        />
      )}

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

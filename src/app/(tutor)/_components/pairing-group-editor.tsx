"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { Button, ChoiceButton } from "~/app/_components/ui/button";
import {
  ChangeReview,
  FormActions,
  FormSection,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { useDialogPending } from "~/app/_components/ui/modal";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { participantNameLabel } from "~/app/_components/participant-name";
import { formatWeekday, minToHm } from "~/lib/time";
import { invalidateWorkloads } from "~/lib/workload-cache";
import { pairingGroupEligibility } from "~/lib/pairing-group-eligibility";
import { plannedIntervalsOverlap } from "~/lib/planned-scheduling";

type GroupState = RouterOutputs["pairingGroups"]["mine"];
type SavedGroup = GroupState["groups"][number];
type PayloadGroup = {
  id?: string;
  pairingIds: string[];
  slotId: string | null;
  retainSchedule?: boolean;
};

export type PairingGroupAction =
  | { kind: "combine"; pairingIds: string[]; targetGroupId?: string }
  | { kind: "split"; groupId: string };

type CombineDraft = {
  kind: "combine";
  id?: string;
  pairingIds: string[];
  slotId: string | null;
  staleSelection: boolean;
};

type SplitDraft = {
  kind: "split";
  id: string;
  mode: "all" | "partial";
  originalPairingIds: string[];
  keptPairingIds: string[];
  slotId: string | null;
  retainSchedule?: boolean;
  missingGroup: boolean;
};

type ActionDraft = CombineDraft | SplitDraft;

/** Preserve an unchanged saved group's slot or confirmed custom interval. */
function savedGroupToPayload(
  group: SavedGroup,
  slots: GroupState["slots"],
): PayloadGroup {
  const retain =
    group.scheduleConfirmed && !slots.some((slot) => slot.id === group.slotId);
  return {
    id: group.id,
    pairingIds: group.pairingIds,
    slotId: retain ? null : group.slotId,
    ...(retain ? { retainSchedule: true } : {}),
  };
}

function buildInitialDraft(
  action: PairingGroupAction,
  state: GroupState,
): { draft: ActionDraft; phase: "edit" | "review" } {
  if (action.kind === "combine") {
    const knownIds = new Set(state.pairings.map((p) => p.id));
    const uniqueIds = [...new Set(action.pairingIds)];
    const selectedSet = new Set(uniqueIds);
    const overlapping = state.groups.filter((g) =>
      g.pairingIds.some((id) => selectedSet.has(id)),
    );
    // Reject silently splitting an overlapping group that gained members after selection.
    const partialOverlap = overlapping.some((g) =>
      g.pairingIds.some((id) => !selectedSet.has(id)),
    );
    const missingAny = uniqueIds.some((id) => !knownIds.has(id));
    const preservedGroup =
      overlapping.find((g) => g.id === action.targetGroupId) ?? overlapping[0];
    return {
      draft: {
        kind: "combine",
        id: preservedGroup?.id,
        pairingIds: uniqueIds.filter((id) => knownIds.has(id)),
        slotId: null,
        staleSelection: missingAny || partialOverlap,
      },
      phase: "edit",
    };
  }

  const target = state.groups.find((g) => g.id === action.groupId);
  if (!target) {
    return {
      draft: {
        kind: "split",
        id: action.groupId,
        mode: "all",
        originalPairingIds: [],
        keptPairingIds: [],
        slotId: null,
        missingGroup: true,
      },
      phase: "edit",
    };
  }
  const retain =
    target.scheduleConfirmed &&
    !state.slots.some((slot) => slot.id === target.slotId);
  const directDissolve = target.pairingIds.length <= 2;
  return {
    draft: {
      kind: "split",
      id: target.id,
      mode: "all",
      originalPairingIds: target.pairingIds,
      keptPairingIds: target.pairingIds,
      slotId: retain ? null : target.slotId,
      ...(retain ? { retainSchedule: true } : {}),
      missingGroup: false,
    },
    phase: directDissolve ? "review" : "edit",
  };
}

/** Focused dialog for combining selected groups or splitting/repairing a group
 * directly from the unified Tutor Pairings page. Owns one immutable read
 * snapshot through editing, review, retry and accepted-save refresh recovery. */
export function PairingGroupActionDialog({
  action,
  active,
  onClose,
  onSaved,
}: {
  action: PairingGroupAction;
  active: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useTranslations("pairingGroups");
  const title = action.kind === "combine" ? t("combineTitle") : t("splitTitle");
  return (
    <ProfileDialog title={title} onClose={onClose}>
      <GroupActionDraft
        action={action}
        active={active}
        onClose={onClose}
        onSaved={onSaved}
      />
    </ProfileDialog>
  );
}

function GroupActionDraft({
  action,
  active,
  onClose,
  onSaved,
}: {
  action: PairingGroupAction;
  active: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useTranslations("pairingGroups");
  const common = useTranslations("common");
  const locale = useLocale();
  const utils = api.useUtils();
  const query = api.pairingGroups.mine.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: "always",
  });
  const denied = useSessionAccessDenied(query);
  const [snapshot, setSnapshot] = useState<GroupState>();
  const [draft, setDraft] = useState<ActionDraft>();
  const [phase, setPhase] = useState<"edit" | "review" | "saved">("edit");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const admitted = useRef(false);

  if (!snapshot && query.data && !query.isFetching && !query.error) {
    const initial = buildInitialDraft(action, query.data);
    setSnapshot(query.data);
    setDraft(initial.draft);
    setPhase(initial.phase);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const results = await Promise.allSettled([
        utils.tutor.myPairings.invalidate(
          undefined,
          { refetchType: "all" },
          { throwOnError: true },
        ),
        utils.tutor.schedule.invalidate(
          undefined,
          { refetchType: "all" },
          { throwOnError: true },
        ),
        utils.admin?.pairings
          ? utils.admin.pairings.invalidate(
              undefined,
              { refetchType: "all" },
              { throwOnError: true },
            )
          : Promise.resolve(),
        query.refetch({ throwOnError: true }),
        // Combining and splitting change counted sessions without an assignment
        // write. Refresh both workload readers inside the accepted-save boundary,
        // including its read-only Retry, so a failed read never replays the save.
        invalidateWorkloads(utils, true),
      ]);
      setRefreshFailed(results.some((r) => r.status === "rejected"));
    } finally {
      setRefreshing(false);
    }
  }

  const save = api.pairingGroups.save.useMutation({
    onSuccess: async () => {
      setPhase("saved");
      onSaved?.();
      await refresh();
    },
    onSettled: () => {
      admitted.current = false;
    },
  });

  const busy = useDialogPending(save.isPending || refreshing);

  if (denied) {
    return (
      <StatePanel
        kind="denied"
        title={t("accessDenied")}
        action={
          <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
        }
      />
    );
  }

  const assignments = snapshot?.pairings ?? [];
  const scheduleSlots = snapshot?.slots ?? [];
  const pairingById = new Map(assignments.map((p) => [p.id, p]));

  const label = (id: string) => pairingById.get(id)?.subject ?? id;
  const studentLabel = (id: string) => {
    const student = assignments
      .flatMap((p) => p.tutees)
      .find((x) => x.tuteeId === id)?.tutee;
    return participantNameLabel(
      student?.englishName ?? "",
      student?.user?.username,
      t("unnamed"),
    );
  };
  const slotLabel = (id: string | null) => {
    const s = scheduleSlots.find((slot) => slot.id === id);
    return s
      ? `${s.label} · ${formatWeekday(s.dayOfWeek, locale)} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`
      : t("awaiting");
  };
  const memberStudentsLabel = (id: string) =>
    pairingById
      .get(id)
      ?.tutees.map((x) =>
        participantNameLabel(
          x.tutee.englishName,
          x.tutee.user?.username,
          t("unnamed"),
        ),
      )
      .join(", ") ?? "";

  // Compute unaffected saved groups, the target group payload (if any), and validation.
  const touchedSet = new Set(
    draft
      ? draft.kind === "combine"
        ? draft.pairingIds
        : draft.originalPairingIds
      : [],
  );
  const otherSavedGroups = (snapshot?.groups ?? []).filter((g) =>
    draft?.kind === "split"
      ? g.id !== draft.id
      : !g.pairingIds.some((id) => touchedSet.has(id)),
  );
  const otherGroupsPayload = otherSavedGroups.map((g) =>
    savedGroupToPayload(g, scheduleSlots),
  );
  const otherGroupNeedsRepair = otherSavedGroups.some(
    (g) => g.groupStatus === "needsRepair",
  );

  const activeGroupIds =
    draft?.kind === "combine"
      ? draft.pairingIds
      : draft?.kind === "split" && draft.mode === "partial"
        ? draft.keptPairingIds
        : [];
  const activeMembers = activeGroupIds
    .map((id) => pairingById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const hasActiveGroup =
    draft?.kind === "combine" ||
    (draft?.kind === "split" && draft.mode === "partial");
  const activeEligibility = hasActiveGroup
    ? pairingGroupEligibility(activeMembers)
    : null;

  const finalPayloadGroups: PayloadGroup[] = (() => {
    if (!draft) return [];
    if (draft.kind === "combine") {
      return [
        ...otherGroupsPayload,
        {
          ...(draft.id ? { id: draft.id } : {}),
          pairingIds: draft.pairingIds,
          slotId: draft.slotId,
        },
      ];
    }
    if (draft.mode === "all") return otherGroupsPayload;
    return [
      ...otherGroupsPayload,
      {
        id: draft.id,
        pairingIds: draft.keptPairingIds,
        slotId: draft.retainSchedule ? null : draft.slotId,
        ...(draft.retainSchedule ? { retainSchedule: true } : {}),
      },
    ];
  })();

  const finalGroupedIds = new Set(
    finalPayloadGroups.flatMap((g) => g.pairingIds),
  );
  const released = assignments.filter(
    (p) => p.groupId !== null && !finalGroupedIds.has(p.id),
  );

  const savedTargetGroup =
    draft?.kind === "split"
      ? snapshot?.groups.find((g) => g.id === draft.id)
      : undefined;
  const retainedMembershipMatches =
    draft?.kind === "split" &&
    !!savedTargetGroup &&
    savedTargetGroup.pairingIds.length === draft.keptPairingIds.length &&
    savedTargetGroup.pairingIds.every((id) =>
      draft.keptPairingIds.includes(id),
    );
  const canRetainSchedule =
    draft?.kind === "split" &&
    !!savedTargetGroup &&
    savedTargetGroup.scheduleConfirmed &&
    !scheduleSlots.some((slot) => slot.id === savedTargetGroup.slotId);
  const retainedLabel = savedTargetGroup
    ? `${t("keepCurrentTime")} · ${formatWeekday(savedTargetGroup.dayOfWeek, locale)} ${minToHm(savedTargetGroup.startMin)}–${minToHm(savedTargetGroup.endMin)}`
    : t("keepCurrentTime");

  const activeInterval = (() => {
    if (!draft || !hasActiveGroup) return undefined;
    if (draft.kind === "split" && draft.retainSchedule) return savedTargetGroup;
    return scheduleSlots.find((slot) => slot.id === draft.slotId);
  })();

  // Check conflicts against independent ungrouped pairings and other saved groups.
  const conflictFor = (
    interval:
      | { dayOfWeek: number; startMin: number; endMin: number }
      | undefined = activeInterval,
  ) => {
    if (!interval) return undefined;
    const independent = assignments.find(
      (p) =>
        !finalGroupedIds.has(p.id) &&
        !p.groupId &&
        p.scheduleConfirmed &&
        plannedIntervalsOverlap(interval, p),
    );
    if (independent) return independent.subject;
    const other = otherSavedGroups.find((g) => {
      const otherInterval = g.retainSchedule
        ? g
        : scheduleSlots.find((slot) => slot.id === g.slotId);
      return (
        otherInterval &&
        g.scheduleConfirmed &&
        plannedIntervalsOverlap(interval, otherInterval)
      );
    });
    return other?.pairingIds.map(label).join(" + ");
  };

  const activeConflict = conflictFor(activeInterval);

  const staleOrMissing =
    !draft ||
    (draft.kind === "combine" && draft.staleSelection) ||
    (draft.kind === "split" && draft.missingGroup);

  const invalid =
    staleOrMissing ||
    otherGroupNeedsRepair ||
    (hasActiveGroup &&
      (!activeEligibility?.eligible ||
        !!activeConflict ||
        (draft.kind === "split" &&
          (draft.retainSchedule ?? false) &&
          !retainedMembershipMatches) ||
        (!!draft.slotId &&
          !scheduleSlots.some((slot) => slot.id === draft.slotId))));

  const reloadSaved = async () => {
    const fresh = await query.refetch();
    if (fresh.data && !fresh.error) {
      const next = buildInitialDraft(action, fresh.data);
      setSnapshot(fresh.data);
      setDraft(next.draft);
      setPhase(next.phase);
      save.reset();
    }
  };

  const commit = () => {
    if (
      !snapshot ||
      !active ||
      busy ||
      invalid ||
      query.error ||
      admitted.current
    )
      return;
    admitted.current = true;
    save.mutate({
      snapshot: snapshot.snapshot,
      groups: finalPayloadGroups,
    });
  };

  const canGoBackToEdit =
    draft?.kind === "combine" ||
    (draft?.kind === "split" && draft.originalPairingIds.length > 2);

  return (
    <div className="space-y-4">
      {phase !== "saved" && (
        <QueryFeedback
          hasData={!!snapshot}
          loading={!snapshot && (query.isLoading || query.isFetching)}
          error={!!query.error}
          loadingTitle={t("loading")}
          errorTitle={t("loadError")}
          retryLabel={t("retry")}
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}
      {snapshot && draft && (
        <>
          {phase === "saved" ? (
            <>
              <InlineNotice tone="success" announcement="status">
                {t("saved")}
              </InlineNotice>
              {refreshFailed && (
                <InlineNotice
                  tone="warning"
                  announcement="alert"
                  action={
                    <Button
                      size="compact"
                      disabled={refreshing}
                      onClick={() => void refresh()}
                    >
                      {t("retry")}
                    </Button>
                  }
                >
                  {t("refreshFailed")}
                </InlineNotice>
              )}
              <FormActions>
                <Button onClick={onClose} disabled={busy}>
                  {common("close")}
                </Button>
              </FormActions>
            </>
          ) : phase === "review" ? (
            <ChangeReview
              title={t("review")}
              evidence={
                <div className="space-y-3">
                  {staleOrMissing && (
                    <InlineNotice tone="warning">
                      {t("selectionChanged")}
                    </InlineNotice>
                  )}
                  {otherGroupNeedsRepair && (
                    <InlineNotice tone="warning">
                      {t("otherGroupNeedsRepair")}
                    </InlineNotice>
                  )}
                  {hasActiveGroup && activeMembers.length > 0 && (
                    <section className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold text-wrap">
                        {[...new Set(activeGroupIds.map(label))].join(" + ")}
                      </h3>
                      <p className="mt-1 text-sm">
                        {draft.kind === "split" && draft.retainSchedule
                          ? retainedLabel
                          : slotLabel(draft.slotId)}
                      </p>
                      <p className="text-sm">
                        {t("sharedRoom", {
                          room:
                            draft.slotId ||
                            (draft.kind === "split" && draft.retainSchedule)
                              ? (pairingById.get(activeGroupIds[0]!)?.room
                                  ?.name ?? t("noRoom"))
                              : t("noRoom"),
                        })}
                      </p>
                      <p className="mt-2 text-sm">
                        {[
                          ...new Map(
                            activeMembers
                              .flatMap((p) => p.tutees)
                              .map((x) => [x.tuteeId, x]),
                          ).values(),
                        ]
                          .map((x) =>
                            participantNameLabel(
                              x.tutee.englishName,
                              x.tutee.user?.username,
                              t("unnamed"),
                            ),
                          )
                          .join(", ")}
                      </p>
                      {!draft.slotId &&
                        !(draft.kind === "split" && draft.retainSchedule) &&
                        activeMembers.some((p) => p.scheduleConfirmed) && (
                          <InlineNotice tone="warning">
                            {t("clearSchedule")}
                          </InlineNotice>
                        )}
                    </section>
                  )}
                  {draft.kind === "split" &&
                    draft.mode === "all" &&
                    otherGroupsPayload.length === 0 && (
                      <p className="text-sm">{t("noGroups")}</p>
                    )}
                  {released.length > 0 && (
                    <p className="text-sm">
                      {t("released", {
                        subjects: released.map((p) => p.subject).join(", "),
                      })}
                    </p>
                  )}
                </div>
              }
              consequences={
                <p className="muted text-sm">{t("consequences")}</p>
              }
              actions={
                <>
                  {canGoBackToEdit ? (
                    <Button disabled={busy} onClick={() => setPhase("edit")}>
                      {t("back")}
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={onClose}>
                      {common("cancel")}
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    disabled={!active || busy || invalid || !!query.error}
                    onClick={commit}
                  >
                    {draft.kind === "combine"
                      ? t("confirmCombine")
                      : t("confirmSplit")}
                  </Button>
                </>
              }
            />
          ) : (
            <FormSection
              title={t("title")}
              description={
                draft.kind === "combine" ? t("combineHelp") : t("splitHelp")
              }
              busy={busy}
              actions={
                <>
                  <Button onClick={onClose} disabled={busy}>
                    {common("cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!active || invalid || !!query.error}
                    onClick={() => {
                      if (!active || invalid || query.error) return;
                      setPhase("review");
                    }}
                  >
                    {t("review")}
                  </Button>
                </>
              }
            >
              {staleOrMissing && (
                <InlineNotice
                  tone="warning"
                  action={
                    <Button size="compact" onClick={() => void reloadSaved()}>
                      {t("reload")}
                    </Button>
                  }
                >
                  {t("selectionChanged")}
                </InlineNotice>
              )}
              {otherGroupNeedsRepair && (
                <InlineNotice tone="warning">
                  {t("otherGroupNeedsRepair")}
                </InlineNotice>
              )}

              {draft.kind === "split" && !draft.missingGroup && (
                <div
                  role="group"
                  aria-label={t("splitTitle")}
                  className="flex flex-wrap gap-2"
                >
                  <ChoiceButton
                    selected={draft.mode === "all"}
                    onClick={() => setDraft({ ...draft, mode: "all" })}
                  >
                    {t("splitModeAll")}
                  </ChoiceButton>
                  <ChoiceButton
                    selected={draft.mode === "partial"}
                    onClick={() => setDraft({ ...draft, mode: "partial" })}
                  >
                    {t("splitModePartial")}
                  </ChoiceButton>
                </div>
              )}

              {draft.kind === "combine" && !draft.staleSelection && (
                <section className="space-y-3 rounded-lg border border-slate-200 p-3">
                  <h3 className="font-semibold text-wrap">
                    {[...new Set(draft.pairingIds.map(label))].join(" + ")}
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {draft.pairingIds.map((id) => (
                      <li key={id} className="flex flex-wrap gap-x-2">
                        <span className="font-medium text-slate-900">
                          {label(id)}
                        </span>
                        <span className="muted">{memberStudentsLabel(id)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {draft.kind === "split" &&
                draft.mode === "partial" &&
                !draft.missingGroup && (
                  <fieldset className="space-y-1 rounded-lg border border-slate-200 p-3">
                    <legend className="label">{t("members")}</legend>
                    {draft.originalPairingIds.map((id) => {
                      const p = pairingById.get(id);
                      if (!p) return null;
                      const checked = draft.keptPairingIds.includes(id);
                      return (
                        <label
                          key={id}
                          className="flex min-h-11 items-center gap-2 text-sm lg:min-h-8"
                        >
                          <input
                            type="checkbox"
                            aria-describedby={`split-member-${id}`}
                            checked={checked}
                            onChange={(e) => {
                              const nextIds = e.target.checked
                                ? [...draft.keptPairingIds, id]
                                : draft.keptPairingIds.filter(
                                    (item) => item !== id,
                                  );
                              setDraft({ ...draft, keptPairingIds: nextIds });
                            }}
                          />
                          <span className="text-wrap">{p.subject}</span>
                          <span
                            id={`split-member-${id}`}
                            className="muted text-xs"
                            aria-hidden="true"
                          >
                            {memberStudentsLabel(id)}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}

              {hasActiveGroup && !staleOrMissing && (
                <>
                  {activeEligibility && !activeEligibility.eligible && (
                    <InlineNotice tone="warning">
                      <p>
                        {t(`eligibility.${activeEligibility.reason ?? "size"}`)}
                      </p>
                      {activeEligibility.missing.map((missing) => (
                        <p key={missing.tuteeId}>
                          {t("missingCoverage", {
                            student: studentLabel(missing.tuteeId),
                            subjects: missing.subjects.join(", "),
                          })}
                        </p>
                      ))}
                    </InlineNotice>
                  )}

                  {activeGroupIds.length > 0 && (
                    <label className="block">
                      <span className="label">{t("primary")}</span>
                      <select
                        className="select"
                        aria-label={t("primary")}
                        value={activeGroupIds[0] ?? ""}
                        onChange={(e) => {
                          const nextIds = [
                            e.target.value,
                            ...activeGroupIds.filter(
                              (id) => id !== e.target.value,
                            ),
                          ];
                          if (draft.kind === "combine")
                            setDraft({ ...draft, pairingIds: nextIds });
                          else setDraft({ ...draft, keptPairingIds: nextIds });
                        }}
                      >
                        <option value="" disabled>
                          {t("choosePrimary")}
                        </option>
                        {activeGroupIds.map((id) => (
                          <option key={id} value={id}>
                            {label(id)}
                            {" · "}
                            {memberStudentsLabel(id)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="block">
                    <span className="label">{t("schedule")}</span>
                    <select
                      className="select"
                      aria-label={t("schedule")}
                      value={
                        draft.kind === "split" && draft.retainSchedule
                          ? "__retain__"
                          : (draft.slotId ?? "")
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (draft.kind === "combine") {
                          setDraft({ ...draft, slotId: value || null });
                        } else {
                          setDraft({
                            ...draft,
                            slotId:
                              value === "__retain__" ? null : value || null,
                            retainSchedule:
                              value === "__retain__" ? true : undefined,
                          });
                        }
                      }}
                    >
                      <option value="">{t("awaiting")}</option>
                      {canRetainSchedule && (
                        <option value="__retain__">{retainedLabel}</option>
                      )}
                      {scheduleSlots.map((slot) => {
                        const conflict = conflictFor(slot);
                        return (
                          <option
                            key={slot.id}
                            value={slot.id}
                            disabled={!!conflict}
                          >
                            {slotLabel(slot.id)}
                            {conflict
                              ? ` · ${t("slotConflict", { subjects: conflict })}`
                              : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  {activeConflict && (
                    <InlineNotice tone="warning">
                      {t("slotConflict", { subjects: activeConflict })}
                    </InlineNotice>
                  )}

                  {draft.kind === "split" &&
                    draft.retainSchedule &&
                    !retainedMembershipMatches && (
                      <InlineNotice tone="warning">
                        {t("scheduleAfterMembershipChange")}
                      </InlineNotice>
                    )}
                </>
              )}
            </FormSection>
          )}
          {save.error && phase !== "saved" && (
            <InlineNotice
              tone="error"
              announcement="alert"
              action={
                <Button
                  size="compact"
                  disabled={busy}
                  onClick={() => void reloadSaved()}
                >
                  {t("reload")}
                </Button>
              }
            >
              {save.error.message}
            </InlineNotice>
          )}
        </>
      )}
    </div>
  );
}

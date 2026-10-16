"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { Button } from "~/app/_components/ui/button";
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

type Pairing = RouterOutputs["tutor"]["myPairings"][number];
type GroupState = RouterOutputs["pairingGroups"]["mine"];
type DraftGroup = { id?: string; pairingIds: string[]; slotId: string };

/** The editor owns one immutable read snapshot through editing/review/retry.
 * Opening or cancelling the review never writes; saved refresh failures never replay. */
export function PairingGroupEditor({
  pairings,
  slots,
  active,
}: {
  pairings: Pairing[];
  slots: {
    id: string;
    label: string;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
  }[];
  active: boolean;
}) {
  const t = useTranslations("pairingGroups");
  const [open, setOpen] = useState(false);
  return (
    <>
      {active && (
        <Button
          size="compact"
          onClick={() => setOpen(true)}
          disabled={pairings.length < 2}
        >
          {t("manage")}
        </Button>
      )}
      {open && (
        <ProfileDialog title={t("manage")} onClose={() => setOpen(false)}>
          <GroupDraft
            pairings={pairings}
            slots={slots}
            active={active}
            onClose={() => setOpen(false)}
          />
        </ProfileDialog>
      )}
    </>
  );
}

function GroupDraft({
  pairings,
  slots,
  active,
  onClose,
}: {
  pairings: Pairing[];
  slots: {
    id: string;
    label: string;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
  }[];
  active: boolean;
  onClose: () => void;
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
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [phase, setPhase] = useState<"edit" | "review" | "saved">("edit");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const admitted = useRef(false);
  if (!snapshot && query.data && !query.isFetching && !query.error) {
    setSnapshot(query.data);
    setGroups(query.data.groups.map((g) => ({ ...g, slotId: g.slotId ?? "" })));
  }
  async function refresh() {
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
      query.refetch({ throwOnError: true }),
      // Combining and splitting change counted sessions without an assignment
      // write. Refresh both workload readers inside the accepted-save boundary,
      // including its read-only Retry, so a failed read never replays the save.
      invalidateWorkloads(utils, true),
    ]);
    setRefreshFailed(results.some((r) => r.status === "rejected"));
  }
  const save = api.pairingGroups.save.useMutation({
    onSuccess: async () => {
      setPhase("saved");
      await refresh();
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const busy = useDialogPending(save.isPending);
  // Preview labels/rosters and the version token come from the same authoritative
  // read. The catalogue may have an older cache or refresh independently.
  const assignments = snapshot?.pairings ?? pairings;
  const scheduleSlots = snapshot?.slots ?? slots;
  const selected = new Set(groups.flatMap((g) => g.pairingIds));
  const released =
    snapshot?.pairings.filter((p) => p.groupId && !selected.has(p.id)) ?? [];
  const invalid = groups.some(
    (g) => g.pairingIds.length < 2 || g.pairingIds.length > 6 || !g.slotId,
  );
  const label = (id: string) =>
    assignments.find((p) => p.id === id)?.subject ?? id;
  const slotLabel = (id: string) => {
    const s = scheduleSlots.find((slot) => slot.id === id);
    return s
      ? `${s.label} · ${formatWeekday(s.dayOfWeek, locale)} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`
      : t("chooseSlot");
  };
  const patch = (index: number, update: Partial<DraftGroup>) =>
    setGroups((value) =>
      value.map((g, i) => (i === index ? { ...g, ...update } : g)),
    );
  if (denied)
    return (
      <StatePanel
        kind="denied"
        title={t("accessDenied")}
        action={
          <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
        }
      />
    );
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
      {snapshot && (
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
                    <Button size="compact" onClick={() => void refresh()}>
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
                  {groups.map((group, index) => {
                    const members = assignments.filter((p) =>
                      group.pairingIds.includes(p.id),
                    );
                    const students = [
                      ...new Map(
                        members
                          .flatMap((p) => p.tutees)
                          .map((x) => [x.tuteeId, x]),
                      ).values(),
                    ];
                    const primary = assignments.find(
                      (p) => p.id === group.pairingIds[0],
                    );
                    return (
                      <section
                        className="rounded-lg border border-slate-200 p-3"
                        key={index}
                      >
                        <h3 className="font-semibold text-wrap">
                          {group.pairingIds.map(label).join(" + ")}
                        </h3>
                        <p className="mt-1 text-sm">
                          {slotLabel(group.slotId)}
                        </p>
                        <p className="text-sm">
                          {t("sharedRoom", {
                            room: primary?.room?.name ?? t("noRoom"),
                          })}
                        </p>
                        <p className="mt-2 text-sm">
                          {students
                            .map((x) =>
                              participantNameLabel(
                                x.tutee.englishName,
                                x.tutee.user?.username,
                                t("unnamed"),
                              ),
                            )
                            .join(", ")}
                        </p>
                      </section>
                    );
                  })}
                  {groups.length === 0 && <p>{t("noGroups")}</p>}
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
                  <Button disabled={busy} onClick={() => setPhase("edit")}>
                    {t("back")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!active || busy || !!query.error}
                    onClick={() => {
                      // The retained dialog must use current participation, not
                      // eligibility from the earlier Manage click. Recovery of
                      // an accepted save remains read-only and independent.
                      if (!active || busy || query.error || admitted.current)
                        return;
                      admitted.current = true;
                      save.mutate({ snapshot: snapshot.snapshot, groups });
                    }}
                  >
                    {t("save")}
                  </Button>
                </>
              }
            />
          ) : (
            <FormSection
              title={t("title")}
              description={t("help")}
              busy={busy}
              actions={
                <>
                  <Button onClick={onClose}>{common("cancel")}</Button>
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
              {groups.map((group, index) => (
                <section
                  key={index}
                  className="space-y-3 rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">
                      {t("groupNumber", { number: index + 1 })}
                    </h3>
                    <Button
                      size="compact"
                      variant="danger"
                      onClick={() =>
                        setGroups((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      {t("split")}
                    </Button>
                  </div>
                  <fieldset>
                    <legend className="label">{t("members")}</legend>
                    {assignments.map((p) => (
                      <label
                        key={p.id}
                        className="flex min-h-11 items-center gap-2 text-sm lg:min-h-8"
                      >
                        <input
                          type="checkbox"
                          checked={group.pairingIds.includes(p.id)}
                          disabled={
                            !p.tutees.length ||
                            (!group.pairingIds.includes(p.id) &&
                              (selected.has(p.id) ||
                                group.pairingIds.length >= 6))
                          }
                          onChange={(e) =>
                            patch(index, {
                              pairingIds: e.target.checked
                                ? [...group.pairingIds, p.id]
                                : group.pairingIds.filter((id) => id !== p.id),
                            })
                          }
                        />
                        <span className="text-wrap">{p.subject}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="block">
                    <span className="label">{t("primary")}</span>
                    <select
                      className="select"
                      aria-label={t("primary")}
                      value={group.pairingIds[0] ?? ""}
                      onChange={(e) =>
                        patch(index, {
                          pairingIds: [
                            e.target.value,
                            ...group.pairingIds.filter(
                              (id) => id !== e.target.value,
                            ),
                          ],
                        })
                      }
                    >
                      <option value="" disabled>
                        {t("choosePrimary")}
                      </option>
                      {group.pairingIds.map((id) => (
                        <option key={id} value={id}>
                          {label(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label">{t("schedule")}</span>
                    <select
                      className="select"
                      aria-label={t("schedule")}
                      value={group.slotId}
                      onChange={(e) => patch(index, { slotId: e.target.value })}
                    >
                      <option value="">{t("chooseSlot")}</option>
                      {scheduleSlots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slotLabel(slot.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              ))}
              <Button
                size="compact"
                onClick={() =>
                  setGroups((current) => [
                    ...current,
                    { pairingIds: [], slotId: "" },
                  ])
                }
              >
                {t("add")}
              </Button>
              <p className="muted text-sm">{t("splitHelp")}</p>
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
                  onClick={async () => {
                    const fresh = await query.refetch();
                    if (fresh.data && !fresh.error) {
                      setSnapshot(fresh.data);
                      setGroups(
                        fresh.data.groups.map((g) => ({
                          ...g,
                          slotId: g.slotId ?? "",
                        })),
                      );
                      setPhase("edit");
                      save.reset();
                    }
                  }}
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

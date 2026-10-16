"use client";
import { pairingScheduleText } from "~/lib/pairing-schedule";
import { isAssignableTutor } from "~/lib/assignment-qualification";

import { useRef, useState } from "react";
import Link from "next/link";
import { RoomAllocationStatus } from "~/app/_components/room-allocation-status";
import {
  FilterToolbar,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { QualifiedTutorSelect } from "~/app/_components/qualified-tutor-select";
import { AssignmentConfirmation } from "~/app/_components/assignment-confirmation";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { RoomGrid } from "~/app/_components/room-grid";
import { useReadOnly } from "~/app/_components/read-only";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { ChoiceButton, Button } from "~/app/_components/ui/button";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { queuedApprovalId } from "~/lib/approval-outcome";

type PairingForm = {
  id: string | null;
  tutorId: string;
  roomId: string;
  roomMode: "AUTO" | "FIXED" | "NONE" | "LEGACY";
  expectedRoomVersion?: number;
  originalRoomMode?: string;
  releaseRoomToAuto: boolean;
  originalAssignment?: string;
  timeSlotId: string;
  subject: string;
  tuteeIds: string[];
};

const EMPTY: PairingForm = {
  id: null,
  tutorId: "",
  roomId: "",
  roomMode: "AUTO",
  releaseRoomToAuto: false,
  timeSlotId: "",
  subject: "",
  tuteeIds: [],
};

export default function PairingsPage() {
  const t = useTranslations();
  const a = useTranslations("roomAllocation");
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const pairings = api.admin.pairings.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const subjects = api.admin.subjects.useQuery();
  const tutees = api.admin.tutees.useQuery();
  const rooms = api.admin.rooms.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const timeSlots = api.admin.timeSlots.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });

  const create = api.admin.createPairing.useMutation();
  const update = api.admin.updatePairing.useMutation();
  const retryRoom = api.admin.retryRoomAllocation.useMutation();
  const setRoom = api.admin.setPairingRoom.useMutation();
  const del = api.admin.deletePairing.useMutation();
  const review = useActionReview();

  const [form, setForm] = useState<PairingForm>(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const [needsRoomOnly, setNeedsRoomOnly] = useState(false);
  const [working, setWorking] = useState(false);
  const [completed, setCompleted] = useState<{
    outcome?: string;
    queued?: string;
  } | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [writeError, setWriteError] = useState<string>();
  const admitted = useRef(false);
  // A transport failure may hide a committed create; retain its receipt key
  // until an explicit new draft so retry cannot create a second pairing.
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  // The complete authorized read group settles before unlocking. Recovery never
  // invokes a scheduling mutation or silently adopts a new draft version.
  const refresh = async () => {
    setWorking(true);
    setRefreshFailed(false);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.admin.pairings),
        () => invalidateAndReport(utils.admin.rooms),
        () => invalidateAndReport(utils.admin.timeSlots),
        () => invalidateAndReport(utils.notification.list),
        () => invalidateAndReport(utils.notification.unreadCount),
        () => invalidateAndReport(utils.tutor.myPairings),
        () => invalidateAndReport(utils.tutor.schedule),
        () => invalidateAndReport(utils.student.me),
        () => invalidateAndReport(utils.studentWorkflow.mine),
      ]);
      return true;
    } catch {
      setRefreshFailed(true);
      return false;
    } finally {
      setWorking(false);
    }
  };
  const locked =
    working ||
    !!completed ||
    refreshFailed ||
    !!pairings.error ||
    !!rooms.error ||
    !!timeSlots.error;
  const assignmentKey = (
    value: Pick<PairingForm, "tutorId" | "subject" | "timeSlotId" | "tuteeIds">,
  ) =>
    JSON.stringify([
      value.tutorId,
      value.subject,
      value.timeSlotId,
      [...value.tuteeIds].sort(),
    ]);
  const roomOnly = !!form.id && form.originalAssignment === assignmentKey(form);
  const loadForm = (
    p: NonNullable<typeof pairings.data>[number],
  ): PairingForm => {
    const value = {
      id: p.id,
      tutorId: p.tutorId,
      roomId: p.roomId ?? "",
      roomMode: p.roomMode,
      originalRoomMode: p.roomMode,
      expectedRoomVersion: p.roomVersion,
      releaseRoomToAuto: false,
      timeSlotId: p.timeSlotId ?? "",
      subject: p.subject,
      tuteeIds: p.tutees.map((entry) => entry.tuteeId),
    };
    return { ...value, originalAssignment: assignmentKey(value) };
  };
  const reloadDraft = async () => {
    if (working || !form.id) return;
    setWorking(true);
    try {
      const result = await pairings.refetch({ throwOnError: true });
      const row = result.data?.find((p) => p.id === form.id);
      if (!row) throw new Error(a("readFailed"));
      setForm(loadForm(row));
      setWriteError(undefined);
      admitted.current = false;
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };
  const resetEditor = () => {
    setConfirming(false);
    setForm(EMPTY);
    setCreateKey(crypto.randomUUID());
    setCompleted(null);
    setWriteError(undefined);
    admitted.current = false;
  };
  const editing = form.id !== null;
  const set = <K extends keyof PairingForm>(k: K, v: PairingForm[K]) => {
    setConfirming(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const activeSlots = (timeSlots.data ?? []).filter(
    (s) => s.active || s.id === form.timeSlotId,
  );

  const originalPairing = pairings.data?.find(
    (pairing) => pairing.id === form.id,
  );
  const retainsAssignment =
    !!originalPairing &&
    originalPairing.tutorId === form.tutorId &&
    originalPairing.subject === form.subject &&
    form.tuteeIds.every((id) =>
      originalPairing.tutees.some((row) => row.tuteeId === id),
    );
  const selectedSubject = subjects.data?.find(
    (subject) => subject.name === form.subject,
  );
  const base = {
    ...(form.id ? {} : { clientKey: createKey }),
    tutorId: form.tutorId,
    roomId: form.roomMode === "FIXED" ? form.roomId || undefined : undefined,
    roomMode: form.roomMode === "LEGACY" ? undefined : form.roomMode,
    releaseRoomToAuto: form.releaseRoomToAuto,
    timeSlotId: form.timeSlotId,
    subject: form.subject,
    subjectId: selectedSubject?.id,
    tuteeIds: form.tuteeIds,
  };
  const payload = form.id
    ? {
        ...base,
        id: form.id,
        expectedRoomVersion: form.expectedRoomVersion,
        roomId:
          form.roomMode === "LEGACY"
            ? undefined
            : form.roomMode === "FIXED"
              ? form.roomId || null
              : null,
      }
    : base;
  const submit = async (overrideTicket?: string) => {
    if (admitted.current || locked) return;
    admitted.current = true;
    setWorking(true);
    setWriteError(undefined);
    try {
      const result =
        roomOnly && form.id && form.roomMode !== "LEGACY"
          ? await setRoom.mutateAsync({
              id: form.id,
              roomMode: form.roomMode,
              roomId: form.roomMode === "FIXED" ? form.roomId : null,
              expectedRoomVersion: form.expectedRoomVersion!,
              releaseRoomToAuto: form.releaseRoomToAuto,
            })
          : form.id
            ? await update.mutateAsync({
                ...base,
                id: form.id,
                expectedRoomVersion: form.expectedRoomVersion,
                roomId:
                  form.roomMode === "LEGACY"
                    ? undefined
                    : form.roomMode === "FIXED"
                      ? form.roomId || null
                      : null,
                overrideTicket,
              })
            : await create.mutateAsync({ ...base, overrideTicket });
      setCompleted({ outcome: result.roomOutcome });
      setConfirming(false);
      await refresh();
    } catch (error) {
      const queued = queuedApprovalId(error);
      if (queued) {
        setCompleted({ queued });
        setConfirming(false);
        await refresh();
      } else {
        setWriteError(error instanceof Error ? error.message : String(error));
        admitted.current = false;
      }
    } finally {
      setWorking(false);
    }
  };
  const error = writeError;
  const rows = (pairings.data ?? []).filter(
    (p) => !needsRoomOnly || p.roomNeedsAssignment,
  );

  // Creation and row editing share the same fields, validation and confirmation ticket flow.
  const editor = (
    <fieldset
      disabled={locked}
      className={editing ? "min-w-0 space-y-3" : "card min-w-0 p-5"}
    >
      {!editing && (
        <h2 className="section-title">{t("admin.pairings.newPairing")}</h2>
      )}
      <p className="muted mt-1">{t("admin.pairings.slotHelp")}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label={t("admin.pairings.subject")}
          value={form.subject}
          onChange={(value) => set("subject", value)}
          options={[
            { value: "", label: "—" },
            ...(!selectedSubject && form.subject
              ? [{ value: form.subject, label: form.subject }]
              : []),
            ...(subjects.data ?? [])
              .filter(
                (subject) =>
                  (subject.active && subject.level?.active !== false) ||
                  subject.name === form.subject,
              )
              .map((subject) => ({
                value: subject.name,
                label: subject.name,
              })),
          ]}
        />
        <QualifiedTutorSelect
          label={t("admin.pairings.tutor")}
          value={form.tutorId}
          subjectId={selectedSubject?.id ?? ""}
          onChange={(value) => set("tutorId", value)}
          tutors={(tutors.data ?? []).filter(isAssignableTutor)}
          retainedTutor={originalPairing?.tutor}
        />
        <Select
          label={a("modeLabel")}
          value={form.roomMode}
          onChange={(v) => {
            set("roomMode", v as PairingForm["roomMode"]);
            set("releaseRoomToAuto", false);
          }}
          options={[
            ...(form.roomMode === "LEGACY"
              ? [{ value: "LEGACY", label: a("mode.LEGACY") }]
              : []),
            ...["AUTO", "FIXED", "NONE"].map((value) => ({
              value,
              label: a(`mode.${value}`),
            })),
          ]}
        />
        {form.roomMode === "FIXED" && (
          <Select
            label={a("room")}
            value={form.roomId}
            onChange={(v) => set("roomId", v)}
            options={[
              { value: "", label: "—" },
              ...(rooms.data ?? []).map((r) => ({
                value: r.id,
                label: r.name,
              })),
            ]}
          />
        )}
        <Select
          label={t("admin.pairings.timeSlot")}
          value={form.timeSlotId}
          onChange={(v) => set("timeSlotId", v)}
          options={[
            {
              value: "",
              label: editing
                ? t("scheduling.noLinkedSlot")
                : t("admin.pairings.selectSlot"),
            },
            ...activeSlots.map((s) => ({
              value: s.id,
              label: `${s.label} · ${DAY_NAMES[s.dayOfWeek]} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
            })),
          ]}
        />
      </div>

      <p className="muted mt-3">{a("modeHelp")}</p>
      {form.originalRoomMode === "FIXED" && form.roomMode === "AUTO" && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p>{a("releaseHelp")}</p>
          <label className="mt-2 flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={form.releaseRoomToAuto}
              onChange={(e) => set("releaseRoomToAuto", e.target.checked)}
            />
            {a("release")}
          </label>
        </div>
      )}
      <fieldset className="mt-3">
        <legend className="label">{t("admin.pairings.tutees")}</legend>
        <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {(tutees.data ?? []).map((t) => (
            <label
              key={t.id}
              className="flex min-h-11 items-center gap-2 text-sm lg:min-h-6"
            >
              <input
                type="checkbox"
                checked={form.tuteeIds.includes(t.id)}
                onChange={(e) =>
                  set(
                    "tuteeIds",
                    e.target.checked
                      ? [...form.tuteeIds, t.id]
                      : form.tuteeIds.filter((id) => id !== t.id),
                  )
                }
              />
              {t.englishName}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => {
            if (roomOnly && form.roomMode !== "LEGACY") void submit();
            else setConfirming(true);
          }}
          disabled={
            !form.tutorId ||
            (!retainsAssignment &&
              (!selectedSubject?.active ||
                selectedSubject.level?.active === false)) ||
            ((!roomOnly || form.roomMode === "LEGACY") && !form.timeSlotId) ||
            (form.roomMode === "FIXED" && !form.roomId) ||
            (form.originalRoomMode === "FIXED" &&
              form.roomMode === "AUTO" &&
              !form.releaseRoomToAuto) ||
            locked
          }
          className="btn-primary min-h-11 lg:min-h-10"
        >
          {editing
            ? t("admin.pairings.saveChanges")
            : t("admin.pairings.createPairing")}
        </button>

        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </fieldset>
  );

  const saveNotices = (
    <div className="space-y-3">
      {completed && (
        <InlineNotice
          tone={
            completed.queued || completed.outcome === "UNAVAILABLE"
              ? "warning"
              : "success"
          }
          announcement="status"
        >
          {completed.queued ? (
            <>
              {a("queued")}{" "}
              <Link
                className="link"
                href={`/admin/approvals?request=${encodeURIComponent(completed.queued)}`}
              >
                {a("review")}
              </Link>
            </>
          ) : (
            a(`outcome.${completed.outcome ?? "UNASSIGNED"}`)
          )}
        </InlineNotice>
      )}
      {refreshFailed && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={working} onClick={() => void refresh()}>
              {a("retryRefresh")}
            </Button>
          }
        >
          {completed ? a("savedRefreshFailed") : a("readFailed")}
        </InlineNotice>
      )}
      {(pairings.error ?? rooms.error ?? timeSlots.error) && !refreshFailed && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={working} onClick={() => void refresh()}>
              {a("retryRefresh")}
            </Button>
          }
        >
          {a("readFailed")}
        </InlineNotice>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.pairings.title")}</h1>
      {!editing && saveNotices}
      {completed && !editing && (
        <Button disabled={working || refreshFailed} onClick={resetEditor}>
          {t("admin.pairings.newPairing")}
        </Button>
      )}

      {/* Slot × room schedule grid */}
      <section>
        <h2 className="section-title mb-2">
          {t("admin.pairings.roomSchedule")}
        </h2>
        {pairings.data && rooms.data && timeSlots.data ? (
          <RoomGrid
            rooms={(rooms.data ?? []).map((r) => ({ id: r.id, name: r.name }))}
            slots={(timeSlots.data ?? []).filter((s) => s.active)}
            pairings={pairings.data ?? []}
            blocks={(rooms.data ?? []).flatMap((r) => r.unavailabilities)}
          />
        ) : (
          <StatePanel
            kind={
              (pairings.error ?? rooms.error ?? timeSlots.error)
                ? "error"
                : "loading"
            }
            title={a(
              (pairings.error ?? rooms.error ?? timeSlots.error)
                ? "readFailed"
                : "loading",
            )}
          />
        )}
      </section>

      {/* Create / edit form */}
      {!readOnly &&
        (editing ? (
          <ProfileDialog
            title={t("admin.pairings.editPairing")}
            pending={working}
            onClose={() => {
              if (!refreshFailed) resetEditor();
              else setForm(EMPTY);
            }}
          >
            {saveNotices}
            {editor}
            {error && !completed && (
              <div className="mt-3 space-y-2">
                <p className="muted">{a("reloadHelp")}</p>
                <Button disabled={working} onClick={() => void reloadDraft()}>
                  {a("reload")}
                </Button>
              </div>
            )}
            <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
              <Button
                disabled={working}
                onClick={() => {
                  if (!refreshFailed) resetEditor();
                  else setForm(EMPTY);
                }}
              >
                {t("admin.pairings.cancel")}
              </Button>
            </div>
          </ProfileDialog>
        ) : (
          editor
        ))}

      {confirming && (
        <AssignmentConfirmation
          operation={editing ? "admin.updatePairing" : "admin.createPairing"}
          payload={payload}
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
          busy={working}
          error={error}
        />
      )}
      <FilterToolbar
        label={a("filter")}
        actions={
          <Button
            size="compact"
            disabled={working}
            onClick={() => void refresh()}
          >
            {a("refresh")}
          </Button>
        }
      >
        <ChoiceButton
          selected={!needsRoomOnly}
          onClick={() => setNeedsRoomOnly(false)}
        >
          {a("all")}
        </ChoiceButton>
        <ChoiceButton
          selected={needsRoomOnly}
          onClick={() => setNeedsRoomOnly(true)}
        >
          {a("needsRoom")} (
          {pairings.data?.filter((p) => p.roomNeedsAssignment).length ?? "—"})
        </ChoiceButton>
      </FilterToolbar>
      {pairings.data && rows.length === 0 && (
        <StatePanel kind="empty" title={a("empty")} />
      )}
      {/* Table */}
      <div className="card overflow-hidden">
        <SummaryTable label={t("admin.pairings.title")}>
          <thead>
            <tr>
              <th>{t("admin.pairings.colTutor")}</th>
              <th>{t("admin.pairings.colSubject")}</th>
              <th>{t("admin.pairings.colWhen")}</th>
              <th>{t("admin.pairings.colRoom")}</th>
              <th>{t("admin.pairings.colTutees")}</th>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                id={p.id}
                className="scroll-mt-24 target:bg-amber-50 target:outline-2 target:outline-amber-600"
              >
                <td>{p.tutor.englishName}</td>
                <td>{p.subject}</td>
                <td>{pairingScheduleText(p, t("scheduling.awaiting"))}</td>
                <td>
                  <RoomAllocationStatus pairing={p} />
                </td>
                <td>{p.tutees.length}</td>
                <TableActions>
                  <TableDetails title={`${p.tutor.englishName} · ${p.subject}`}>
                    <dl className="space-y-3">
                      <div>
                        <dt className="label">{t("admin.pairings.colWhen")}</dt>
                        <dd>
                          {pairingScheduleText(p, t("scheduling.awaiting"))}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">{t("admin.pairings.colSlot")}</dt>
                        <dd>{p.timeSlot?.label ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="label">{t("admin.pairings.colRoom")}</dt>
                        <dd>
                          <RoomAllocationStatus pairing={p} />
                        </dd>
                      </div>
                    </dl>
                    <h3 className="font-semibold">
                      {t("admin.pairings.colTutees")}
                    </h3>
                    <ul className="list-inside list-disc">
                      {p.tutees.map((entry) => (
                        <li key={entry.tuteeId}>{entry.tutee.englishName}</li>
                      ))}
                    </ul>
                  </TableDetails>
                  {!readOnly && (
                    <>
                      <TableAction
                        aria-label={`${t("admin.pairings.edit")}: ${p.tutor.englishName} · ${p.subject}`}
                        disabled={working || refreshFailed}
                        onClick={() => {
                          resetEditor();
                          setForm(loadForm(p));
                        }}
                      >
                        {t("admin.pairings.edit")}
                      </TableAction>
                      {p.roomNeedsAssignment && (
                        <TableAction
                          disabled={
                            working ||
                            refreshFailed ||
                            review.blocked("room:" + p.id)
                          }
                          onClick={() =>
                            review.open({
                              key: "room:" + p.id,
                              title: a("retryAllocation"),
                              description: a("retryHelp"),
                              confirmLabel: a("retryAllocation"),
                              details: (
                                <p>
                                  {p.tutor.englishName} · {p.subject}
                                </p>
                              ),
                              commit: () =>
                                retryRoom.mutateAsync({
                                  id: p.id,
                                  expectedRoomVersion: p.roomVersion,
                                }),
                              refresh: async () => {
                                if (!(await refresh()))
                                  throw new Error(a("readFailed"));
                              },
                              approvalId: queuedApprovalId,
                              repeatAfterRefresh: true,
                            })
                          }
                        >
                          {a("retryAllocation")}
                        </TableAction>
                      )}
                      <TableAction
                        className="text-red-700"
                        disabled={
                          review.blocked(p.id) || working || refreshFailed
                        }
                        onClick={() =>
                          review.open({
                            key: p.id,
                            title: t("actionReview.pairingTitle"),
                            description: t("actionReview.pairingHelp"),
                            confirmLabel: t("admin.pairings.delete"),
                            details: (
                              <p>
                                {p.tutor.englishName} · {p.subject}
                                <br />
                                {p.tutees
                                  .map((entry) => entry.tutee.englishName)
                                  .join(", ")}
                              </p>
                            ),
                            commit: () => del.mutateAsync({ id: p.id }),
                            refresh: async () => {
                              if (!(await refresh()))
                                throw new Error(a("readFailed"));
                            },
                            approvalId: queuedApprovalId,
                          })
                        }
                      >
                        {t("admin.pairings.delete")}
                      </TableAction>
                    </>
                  )}
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      </div>
      {!readOnly && review.dialog}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="label">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select min-h-11 lg:min-h-10"
      >
        {!options.some((o) => o.value === "") && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

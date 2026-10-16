"use client";
import { pairingScheduleText } from "~/lib/pairing-schedule";
import { isAssignableTutor } from "~/lib/assignment-qualification";

import { useEffect, useState, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { QualifiedTutorSelect } from "~/app/_components/qualified-tutor-select";
import { AssignmentConfirmation } from "~/app/_components/assignment-confirmation";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { formatWeekday, minToHm } from "~/lib/time";
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
import { matchesPersonSearch } from "~/lib/person-search";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { queuedApprovalId } from "~/lib/approval-outcome";

type PairingForm = {
  id: string | null;
  tutorId: string;
  roomId: string;
  timeSlotId: string;
  subject: string;
  tuteeIds: string[];
};

const EMPTY: PairingForm = {
  id: null,
  tutorId: "",
  roomId: "",
  timeSlotId: "",
  subject: "",
  tuteeIds: [],
};
const accessDenied = (error: { data?: { code?: string } | null } | null) =>
  error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED";

export default function PairingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const pairings = api.admin.pairings.useQuery(undefined, { enabled: !denied });
  const tutors = api.admin.tutors.useQuery(undefined, { enabled: !denied });
  const subjects = api.admin.subjects.useQuery(undefined, { enabled: !denied });
  const tutees = api.admin.tutees.useQuery(undefined, { enabled: !denied });
  const rooms = api.admin.rooms.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
    enabled: !denied,
  });
  const timeSlots = api.admin.timeSlots.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
    enabled: !denied,
  });
  const reads = [
    { query: pairings, section: t("admin.pairings.title") },
    { query: tutors, section: t("admin.tutors.title") },
    { query: subjects, section: t("admin.courses.title") },
    { query: tutees, section: t("admin.tutees.title") },
    { query: rooms, section: t("admin.rooms.title") },
    { query: timeSlots, section: t("admin.timeslots.title") },
  ];
  const authorizationDenied = reads.some(({ query }) =>
    accessDenied(query.error),
  );
  const readsSucceeded = reads.every(
    ({ query }) => query.isSuccess && !query.isFetching,
  );
  useEffect(() => {
    if (authorizationDenied) {
      setDenied(true);
      // Conceal this feature on revoked authority, evicting only denied query families.
      if (accessDenied(pairings.error))
        queryClient.removeQueries({
          queryKey: getQueryKey(api.admin.pairings, undefined, "query"),
        });
      if (accessDenied(tutors.error))
        queryClient.removeQueries({
          queryKey: getQueryKey(api.admin.tutors, undefined, "query"),
        });
      if (accessDenied(subjects.error))
        queryClient.removeQueries({
          queryKey: getQueryKey(api.admin.subjects, undefined, "query"),
        });
      if (accessDenied(tutees.error))
        queryClient.removeQueries({
          queryKey: getQueryKey(api.admin.tutees, undefined, "query"),
        });
      if (accessDenied(rooms.error))
        queryClient.removeQueries({
          queryKey: getQueryKey(api.admin.rooms, undefined, "query"),
        });
      if (accessDenied(timeSlots.error))
        queryClient.removeQueries({
          queryKey: getQueryKey(api.admin.timeSlots, undefined, "query"),
        });
    } else if (readsSucceeded) setDenied(false);
  }, [
    authorizationDenied,
    readsSucceeded,
    pairings.error,
    tutors.error,
    subjects.error,
    tutees.error,
    rooms.error,
    timeSlots.error,
    queryClient,
  ]);
  const hasData = reads.every(({ query }) => query.data !== undefined);
  const readErrors = reads.filter(({ query }) => query.error);
  const readBlocked = !hasData || readErrors.length > 0;
  const section =
    (readErrors.length
      ? readErrors
      : reads.filter(({ query }) => query.data === undefined)
    )
      .map(({ section }) => section)
      .join(", ") || t("admin.pairings.title");
  const retry = () => {
    for (const { query } of reads)
      if (query.error || query.data === undefined || denied)
        void query.refetch();
  };
  const readFeedback = (
    <QueryFeedback
      hasData={hasData}
      loading={!hasData}
      error={readErrors.length > 0}
      retrying={reads.some(({ query }) => query.isFetching)}
      loadingTitle={t("managementRecovery.loading", { section })}
      errorTitle={t(
        hasData
          ? "managementRecovery.refreshFailed"
          : "managementRecovery.loadFailed",
        { section },
      )}
      retryLabel={t("managementRecovery.retry", { section })}
      onRetry={retry}
    />
  );

  const invalidate = () => utils.admin.pairings.invalidate();
  const create = api.admin.createPairing.useMutation({ onSuccess: invalidate });
  const update = api.admin.updatePairing.useMutation({ onSuccess: invalidate });
  const del = api.admin.deletePairing.useMutation();
  const review = useActionReview();

  // Creation and row editing have independent owners: opening an edit cannot overwrite a draft.
  const [createDraft, setCreateDraft] = useState<PairingForm>(EMPTY);
  const [editDraft, setEditDraft] = useState<PairingForm | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tuteeSearch, setTuteeSearch] = useState("");
  const form = editDraft ?? createDraft;
  const setForm = (next: SetStateAction<PairingForm>) => {
    if (editDraft)
      setEditDraft((current) =>
        typeof next === "function" ? next(current!) : next,
      );
    else setCreateDraft(next);
  };
  const [confirming, setConfirming] = useState(false);
  const editing = editDraft !== null;
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
    tutorId: form.tutorId,
    roomId: form.roomId || undefined,
    timeSlotId: form.timeSlotId,
    subject: form.subject,
    subjectId: selectedSubject?.id,
    tuteeIds: form.tuteeIds,
  };
  const payload = form.id
    ? { ...base, id: form.id, roomId: form.roomId || null }
    : base;
  const submit = (overrideTicket?: string) => {
    const onSuccess = () => {
      setConfirming(false);
      if (editing) setEditDraft(null);
      else {
        setCreateDraft(EMPTY);
        setCreateOpen(false);
      }
    };
    if (form.id)
      update.mutate(
        { ...base, id: form.id, roomId: form.roomId || null, overrideTicket },
        { onSuccess },
      );
    else create.mutate({ ...base, overrideTicket }, { onSuccess });
  };

  const error = create.error ?? update.error;

  // Creation and row editing share the same fields, validation and confirmation ticket flow.
  const editor = (
    <fieldset
      disabled={create.isPending || update.isPending}
      className="min-w-0 space-y-3"
    >
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
          label={t("admin.pairings.roomOptional")}
          value={form.roomId}
          onChange={(v) => set("roomId", v)}
          options={[
            { value: "", label: t("admin.pairings.none") },
            ...(rooms.data ?? []).map((r) => ({
              value: r.id,
              label: r.name,
            })),
          ]}
        />
        <Select
          label={t("admin.pairings.timeSlot")}
          value={form.timeSlotId}
          onChange={(v) => set("timeSlotId", v)}
          options={[
            { value: "", label: t("admin.pairings.selectSlot") },
            ...activeSlots.map((s) => ({
              value: s.id,
              label: `${s.label} · ${formatWeekday(s.dayOfWeek, locale)} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
            })),
          ]}
        />
      </div>

      <fieldset className="mt-3">
        <legend className="label">{t("admin.pairings.tutees")}</legend>
        <label className="mt-2 block">
          <span className="label">{t("admin.pairings.searchTutees")}</span>
          <input
            type="search"
            className="input w-full"
            value={tuteeSearch}
            onChange={(event) => setTuteeSearch(event.target.value)}
          />
        </label>
        <p className="muted mt-2 text-sm" role="status">
          {t("admin.pairings.selectedTutees", { count: form.tuteeIds.length })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {form.tuteeIds.map((id) => {
            const person =
              (tutees.data ?? []).find((row) => row.id === id) ??
              originalPairing?.tutees.find((row) => row.tuteeId === id)?.tutee;
            return (
              <Button
                key={id}
                size="compact"
                aria-label={t("admin.pairings.removeSelected", {
                  name: person?.englishName ?? id,
                })}
                onClick={() =>
                  set(
                    "tuteeIds",
                    form.tuteeIds.filter((selected) => selected !== id),
                  )
                }
              >
                {person?.englishName ?? id} ×
              </Button>
            );
          })}
        </div>
        {/* Filtering changes visibility, never selection. Keep long names readable in a bounded list. */}
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {(tutees.data ?? [])
            .filter((person) => matchesPersonSearch(person, tuteeSearch))
            .map((t) => (
              <label
                key={t.id}
                className="flex min-h-11 items-center gap-3 rounded px-2 py-2 text-sm [overflow-wrap:anywhere]"
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
            if (!readBlocked) setConfirming(true);
          }}
          disabled={
            readBlocked ||
            !form.tutorId ||
            (!retainsAssignment &&
              (!selectedSubject?.active ||
                selectedSubject.level?.active === false)) ||
            !form.timeSlotId ||
            create.isPending ||
            update.isPending
          }
          className="btn-primary min-h-11 lg:min-h-10"
        >
          {editing
            ? t("admin.pairings.saveChanges")
            : t("admin.pairings.createPairing")}
        </button>

        {error && <span className="text-sm text-red-600">{error.message}</span>}
      </div>
    </fieldset>
  );

  if (denied || authorizationDenied)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{t("admin.pairings.title")}</h1>
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.pairings.title"),
          })}
          action={
            <Button
              size="compact"
              disabled={reads.some(({ query }) => query.isFetching)}
              onClick={retry}
            >
              {t("managementRecovery.retry", {
                section: t("admin.pairings.title"),
              })}
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("admin.pairings.title")}</h1>
        {!readOnly && hasData && (
          <Button
            variant="primary"
            disabled={create.isPending || update.isPending}
            onClick={() => setCreateOpen(true)}
          >
            {t("admin.pairings.newPairing")}
          </Button>
        )}
      </div>
      {readFeedback}

      {/* Slot × room schedule grid */}
      <section>
        <h2 className="section-title mb-2">
          {t("admin.pairings.roomSchedule")}
        </h2>
        {rooms.data !== undefined &&
          timeSlots.data !== undefined &&
          pairings.data !== undefined && (
            <RoomGrid
              rooms={(rooms.data ?? []).map((r) => ({
                id: r.id,
                name: r.name,
              }))}
              slots={(timeSlots.data ?? []).filter((s) => s.active)}
              pairings={pairings.data ?? []}
              blocks={(rooms.data ?? []).flatMap((r) => r.unavailabilities)}
            />
          )}
      </section>

      {!readOnly && hasData && (editing || createOpen) && (
        <ProfileDialog
          title={t(
            editing
              ? "admin.pairings.editPairing"
              : "admin.pairings.newPairing",
          )}
          size="wide"
          pending={create.isPending || update.isPending}
          onClose={() => {
            if (create.isPending || update.isPending || confirming) return;
            if (editing) setEditDraft(null);
            else setCreateOpen(false);
          }}
        >
          {readFeedback}
          {editor}
        </ProfileDialog>
      )}
      {confirming && (
        <AssignmentConfirmation
          operation={editing ? "admin.updatePairing" : "admin.createPairing"}
          payload={payload}
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
          busy={create.isPending || update.isPending}
          error={error?.message}
        />
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
            {(pairings.data ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.tutor.englishName}</td>
                <td>{p.subject}</td>
                <td>
                  {pairingScheduleText(p, t("scheduling.awaiting"), locale)}
                </td>
                <td>{p.room?.name ?? "—"}</td>
                <td>{p.tutees.length}</td>
                <TableActions>
                  <TableDetails title={`${p.tutor.englishName} · ${p.subject}`}>
                    <dl className="space-y-3">
                      <div>
                        <dt className="label">{t("admin.pairings.colWhen")}</dt>
                        <dd>
                          {pairingScheduleText(
                            p,
                            t("scheduling.awaiting"),
                            locale,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">{t("admin.pairings.colSlot")}</dt>
                        <dd>{p.timeSlot?.label ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="label">{t("admin.pairings.colRoom")}</dt>
                        <dd>{p.room?.name ?? "—"}</dd>
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
                        disabled={
                          readBlocked || create.isPending || update.isPending
                        }
                        onClick={() => {
                          setConfirming(false);
                          setEditDraft({
                            id: p.id,
                            tutorId: p.tutorId,
                            roomId: p.roomId ?? "",
                            timeSlotId: p.timeSlotId ?? "",
                            subject: p.subject,
                            tuteeIds: p.tutees.map((entry) => entry.tuteeId),
                          });
                        }}
                      >
                        {t("admin.pairings.edit")}
                      </TableAction>
                      <TableAction
                        className="text-red-700"
                        disabled={
                          readBlocked ||
                          review.blocked(p.id) ||
                          update.isPending
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
                            refresh: () =>
                              invalidateAndReport(utils.admin.pairings),
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

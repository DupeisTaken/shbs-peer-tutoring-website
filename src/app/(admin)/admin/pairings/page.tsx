"use client";
import {
  useNotificationRecordReveal,
  type NotificationRecordArrival,
} from "~/app/_components/use-notification-record-reveal";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import { participantNameLabel } from "~/app/_components/participant-name";
import {
  pairingScheduleText,
  pairingScheduleSortValue,
} from "~/lib/pairing-schedule";
import {
  WorkloadAssignmentConfirmation,
  AssignmentWorkloadFeedback,
  useAssignmentWorkloads,
} from "~/app/_components/assignment-workload";
import type { WorkloadProposal } from "~/lib/tutor-workload";
import { invalidateWorkloads } from "~/lib/workload-cache";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { isAssignableTutor } from "~/lib/assignment-qualification";

import Link from "next/link";
import { RoomAllocationStatus } from "~/app/_components/room-allocation-status";
import { FilterToolbar, InlineNotice } from "~/app/_components/ui/patterns";

import { useEffect, useRef, useState, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { QualifiedTutorSelect } from "~/app/_components/qualified-tutor-select";
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
import { ChoiceButton, Button } from "~/app/_components/ui/button";
import { CreationRiskDialog } from "~/app/_components/creation-risk-dialog";
import { matchesPersonSearch } from "~/lib/person-search";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

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
const accessDenied = (error: { data?: { code?: string } | null } | null) =>
  error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED";

export default function PairingsPage() {
  const t = useTranslations();
  const a = useTranslations("roomAllocation");
  // Presentation reads already projected handles; selected IDs, raw search and writes remain authoritative.
  const personName = (
    person:
      | {
          englishName: string;
          username?: string | null;
          user?: { username?: string | null } | null;
          owner?: { username?: string | null } | null;
        }
      | undefined,
    missingId?: string,
  ) =>
    person
      ? participantNameLabel(
          person.englishName,
          person.owner?.username ?? person.user?.username ?? person.username,
          t("participantNames.unnamed"),
        )
      : (missingId ?? t("participantNames.unnamed"));
  const locale = useLocale();

  const readOnly = useReadOnly();
  const workloadText = useTranslations("tutorWorkload");
  const workloads = useAssignmentWorkloads(!readOnly);
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
  useSessionPageScroll({
    id: "pairings-v1",
    ready: hasData,
    enabled: !denied && !authorizationDenied,
  });
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

  const create = api.admin.createPairing.useMutation();
  const update = api.admin.updatePairing.useMutation();
  const retryRoom = api.admin.retryRoomAllocation.useMutation();
  const setRoom = api.admin.setPairingRoom.useMutation();

  const del = api.admin.deletePairing.useMutation();
  const review = useActionReview();

  // Creation and row editing have independent owners: opening an edit cannot overwrite a draft.
  const [createDraft, setCreateDraft] = useState<PairingForm>(EMPTY);
  const [editDraft, setEditDraft] = useState<PairingForm | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creationRiskOpen, setCreationRiskOpen] = useState(false);
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
  const [needsRoomOnly, setNeedsRoomOnly] = useState(false);
  const arrivalSequence = useRef(0);
  const [arrival, setArrival] = useState<NotificationRecordArrival | null>(
    null,
  );
  // Queue the validated location before reads settle so a user gesture can cancel
  // an unfinished arrival. Only the authorized matching row may reveal after commit.
  useEffect(() => {
    const resolve = () => {
      const hash = window.location.hash;
      setArrival(
        /^#[a-zA-Z0-9_-]{1,128}$/.test(hash)
          ? {
              hash,
              pathname: window.location.pathname,
              sequence: ++arrivalSequence.current,
            }
          : null,
      );
    };
    resolve();
    window.addEventListener("hashchange", resolve);
    return () => window.removeEventListener("hashchange", resolve);
  }, []);
  const arrivalKnown =
    !!arrival &&
    (pairings.data ?? []).some((row) => "#" + row.id === arrival.hash);
  useEffect(() => {
    if (denied || authorizationDenied) setArrival(null);
    else if (arrivalKnown) setNeedsRoomOnly(false);
  }, [denied, authorizationDenied, arrivalKnown]);
  useNotificationRecordReveal(
    arrival,
    hasData &&
      !readBlocked &&
      !denied &&
      !authorizationDenied &&
      arrivalKnown &&
      !needsRoomOnly,
    (cancelled) =>
      setArrival((current) =>
        current?.sequence === cancelled.sequence ? null : current,
      ),
  );

  const [working, setWorking] = useState(false);
  const [writing, setWriting] = useState(false);
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
        () => invalidateAndReport(utils.pairingGroups.mine),
        () => invalidateWorkloads(utils, true),
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
    readBlocked ||
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
  // Room operations on one explicit member affect its complete reservation unit.
  const groupSubjects = (p: NonNullable<typeof pairings.data>[number]) =>
    p.groupId
      ? (pairings.data ?? [])
          .filter((member) => member.groupId === p.groupId)
          .map((member) => member.subject)
          .join(" + ")
      : undefined;
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
    if (editDraft) setEditDraft(null);
    else {
      setCreateDraft(EMPTY);
      setCreateOpen(false);
      setCreateKey(crypto.randomUUID());
    }
    setCompleted(null);
    setWriteError(undefined);
    admitted.current = false;
  };
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
  const selectedSlot = timeSlots.data?.find(
    (slot) => slot.id === form.timeSlotId,
  );
  const hasCurrentRoster = form.tuteeIds.some((id) => {
    const row =
      (tutees.data ?? []).find((person) => person.id === id) ??
      originalPairing?.tutees.find((entry) => entry.tuteeId === id)?.tutee;
    return !!row && row.status !== "INACTIVE";
  });
  const proposals: WorkloadProposal[] = [
    {
      replacingPairingId: form.id ?? undefined,
      block:
        selectedSlot &&
        hasCurrentRoster &&
        (originalPairing?.termId ?? workloads.data?.termId)
          ? {
              id: form.id ?? "proposed-pairing",
              termId: originalPairing?.termId ?? workloads.data!.termId!,
              scheduleConfirmed: true,
              dayOfWeek: selectedSlot.dayOfWeek,
              startMin: selectedSlot.startMin,
              endMin: selectedSlot.endMin,
            }
          : undefined,
    },
  ];
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
  const submit = async (overrideTicket?: string, prepared = false) => {
    // A background reference read cannot revoke an already prepared domain review.
    // New room-only saves stay read-gated; current authority, duplicate admission
    // and accepted-write synchronization locks apply to both paths.
    const preparedReview = prepared && confirming;
    if (
      readOnly ||
      denied ||
      authorizationDenied ||
      admitted.current ||
      working ||
      !!completed ||
      refreshFailed ||
      (!preparedReview && locked)
    )
      return;
    admitted.current = true;
    setWorking(true);
    setWriting(true);
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
        throw error; // Timed review may retry the same failed write; accepted outcomes never replay.
      }
    } finally {
      setWriting(false);
      setWorking(false);
    }
  };
  const needsRoomReservations = new Set(
    (pairings.data ?? [])
      .filter((p) => p.roomNeedsAssignment)
      .map((p) => (p.groupId ? "group:" + p.groupId : "pairing:" + p.id)),
  ).size;
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
      {originalPairing && groupSubjects(originalPairing) && (
        <InlineNotice>
          {a("groupScope", { subjects: groupSubjects(originalPairing)! })}
        </InlineNotice>
      )}
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
              label: `${s.label} · ${formatWeekday(s.dayOfWeek, locale)} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
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
                  name: personName(person, id),
                })}
                onClick={() =>
                  set(
                    "tuteeIds",
                    form.tuteeIds.filter((selected) => selected !== id),
                  )
                }
              >
                {personName(person, id)} ×
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
                {personName(t)}
              </label>
            ))}
        </div>
      </fieldset>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => {
            if (roomOnly && form.roomMode !== "LEGACY")
              void submit().catch(() => undefined);
            else setConfirming(true);
          }}
          disabled={
            readBlocked ||
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
            aria-haspopup="dialog"
            disabled={working || refreshFailed || readBlocked}
            onClick={() => {
              if (working || refreshFailed || readBlocked) return;
              if (completed) resetEditor();
              setCreationRiskOpen(true);
            }}
          >
            {t("admin.pairings.newPairing")}
          </Button>
        )}
      </div>
      {readFeedback}
      {!editing && !createOpen && saveNotices}
      {!readOnly && (
        <>
          <p className="muted text-sm">{workloadText("staffHelp")}</p>
          <AssignmentWorkloadFeedback />
        </>
      )}

      {/* Entry consent never replaces the assignment review or its server ticket. */}
      {!readOnly && hasData && creationRiskOpen && (
        <CreationRiskDialog
          kind="pairing"
          continueDisabled={locked}
          onCancel={() => setCreationRiskOpen(false)}
          onContinue={() => {
            if (locked) return false;
            setCreationRiskOpen(false);
            setCreateOpen(true);
          }}
        />
      )}

      {/* Slot × room schedule grid */}
      <section>
        <h2 className="section-title mb-2">
          {t("admin.pairings.roomSchedule")}
        </h2>
        {rooms.data !== undefined &&
          timeSlots.data !== undefined &&
          pairings.data !== undefined && (
            <RoomGrid
              catalogReady={hasData}
              viewEnabled={!denied && !authorizationDenied}
              viewScope={[
                ...new Set(
                  (pairings.data ?? []).map((pairing) => pairing.termId),
                ),
              ]
                .sort()
                .join(",")}
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
          pending={writing}
          onClose={() => {
            if (writing || confirming) return;
            if (completed && !refreshFailed) {
              resetEditor();
              return;
            }
            if (editing) setEditDraft(null);
            else setCreateOpen(false);
          }}
        >
          {readFeedback}
          {saveNotices}
          {editor}
          {error && !completed && editing && (
            <Button disabled={working} onClick={() => void reloadDraft()}>
              {a("reload")}
            </Button>
          )}
        </ProfileDialog>
      )}

      {confirming && (
        <WorkloadAssignmentConfirmation
          operation={editing ? "admin.updatePairing" : "admin.createPairing"}
          payload={payload}
          onConfirm={(ticket) => submit(ticket, true)}
          onCancel={() => setConfirming(false)}
          busy={working}
          error={error}
          tutorId={form.tutorId}
          proposals={proposals}
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
          {a("needsRoomReservations", { count: needsRoomReservations })}
        </ChoiceButton>
      </FilterToolbar>
      {pairings.data && rows.length === 0 && (
        <StatePanel kind="empty" title={a("empty")} />
      )}
      {/* Table */}
      <div className="card overflow-hidden">
        <SummaryTable sortable label={t("admin.pairings.title")}>
          <thead>
            <tr>
              <th>{t("admin.pairings.colTutor")}</th>
              <th>{t("admin.pairings.colSubject")}</th>
              <th>{t("admin.pairings.colWhen")}</th>
              <th>{t("admin.pairings.colRoom")}</th>
              <th>{t("admin.pairings.colTutees")}</th>
              {!readOnly && (
                <>
                  <th>{workloadText("countHeading")}</th>
                  <th>{workloadText("preferenceHeading")}</th>
                </>
              )}
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
                <td>{personName(p.tutor)}</td>
                <td>{p.subject}</td>
                <td data-sort-value={pairingScheduleSortValue(p)}>
                  {pairingScheduleText(p, t("scheduling.awaiting"), locale)}
                </td>
                <td
                  data-sort-value={
                    p.scheduleConfirmed ? (p.room?.name ?? "") : ""
                  }
                >
                  <RoomAllocationStatus pairing={p} />
                </td>

                <td>{p.tutees.length}</td>
                {!readOnly && (
                  <>
                    <td
                      data-sort-value={
                        !workloads.error && !workloads.isFetching
                          ? (workloads.data?.tutors?.find(
                              (row) => row.id === p.tutorId,
                            )?.count ?? "")
                          : ""
                      }
                    >
                      {(() => {
                        const workload = workloads.data?.tutors?.find(
                          (row) => row.id === p.tutorId,
                        );
                        return workload &&
                          !workloads.error &&
                          !workloads.isFetching
                          ? workload.count
                          : workloadText(
                              workloads.error || workloads.unavailable
                                ? "unavailable"
                                : "checking",
                            );
                      })()}
                    </td>
                    <td
                      data-sort-value={
                        !workloads.error && !workloads.isFetching
                          ? (workloads.data?.tutors?.find(
                              (row) => row.id === p.tutorId,
                            )?.preferredMaximum ?? "")
                          : ""
                      }
                    >
                      {(() => {
                        const workload = workloads.data?.tutors?.find(
                          (row) => row.id === p.tutorId,
                        );
                        return workload &&
                          !workloads.error &&
                          !workloads.isFetching
                          ? (workload.preferredMaximum ?? workloadText("unset"))
                          : workloadText(
                              workloads.error || workloads.unavailable
                                ? "unavailable"
                                : "checking",
                            );
                      })()}
                    </td>
                  </>
                )}
                <TableActions>
                  <TableDetails title={`${personName(p.tutor)} · ${p.subject}`}>
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
                        <li key={entry.tuteeId}>{personName(entry.tutee)}</li>
                      ))}
                    </ul>
                  </TableDetails>
                  {!readOnly && (
                    <>
                      <TableAction
                        aria-label={`${t("admin.pairings.edit")}: ${personName(p.tutor)} · ${p.subject}`}
                        disabled={locked}
                        onClick={() => {
                          setConfirming(false);
                          setEditDraft(loadForm(p));
                        }}
                      >
                        {t("admin.pairings.edit")}
                      </TableAction>
                      {p.roomNeedsAssignment && (
                        <TableAction
                          disabled={
                            readBlocked ||
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
                                  {personName(p.tutor)} · {p.subject}
                                  {groupSubjects(p) && (
                                    <span className="mt-2 block">
                                      {a("groupScope", {
                                        subjects: groupSubjects(p)!,
                                      })}
                                    </span>
                                  )}
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
                          readBlocked ||
                          review.blocked(p.id) ||
                          working ||
                          refreshFailed
                        }
                        onClick={() =>
                          review.open({
                            key: p.id,
                            title: t("actionReview.pairingTitle"),
                            description: t("actionReview.pairingHelp"),
                            confirmLabel: t("admin.pairings.delete"),
                            details: (
                              <p>
                                {personName(p.tutor)} · {p.subject}
                                <br />
                                {p.tutees
                                  .map((entry) => personName(entry.tutee))
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

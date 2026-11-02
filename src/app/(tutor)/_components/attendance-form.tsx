"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations, useTimeZone } from "next-intl";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api } from "~/trpc/react";
import { hmToMin, minToHm } from "~/lib/time";
import { programDateTimeInput } from "~/lib/program-time";
import { useDialog } from "~/app/_components/confirm-dialog";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { DisciplineSlots } from "~/app/_components/discipline-slots";
import { FieldRequirement } from "~/app/_components/field-requirement";
import {
  ParticipantName,
  participantNameLabel,
} from "~/app/_components/participant-name";
import type { AgendaCohort } from "~/app/_components/session-agenda";

const TUTOR_STATUS_VALUES = ["PRESENT", "TUTOR_ABSENT"] as const;
const LIKERT_VALUES = [1, 2, 3, 4, 5] as const;
const TUTEE_STATUS_VALUES = [
  "PRESENT",
  "EXCUSED_ABSENT",
  "UNEXCUSED_ABSENT",
] as const;
type TuteeStatus = (typeof TUTEE_STATUS_VALUES)[number];
const RATING_FIELDS = [
  "ratingPreparedness",
  "ratingParticipation",
  "ratingUnderstanding",
  "ratingBehavior",
  "ratingProgress",
] as const;
const ratingField = z.coerce.number().int().min(1).max(5).optional();
const formSchema = z.object({
  pairingId: z.string().min(1),
  date: z.string().min(1),
  tutorStatus: z.enum(TUTOR_STATUS_VALUES),
  tutorAbsentReason: z.string().optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  ratingPreparedness: ratingField,
  ratingParticipation: ratingField,
  ratingUnderstanding: ratingField,
  ratingBehavior: ratingField,
  ratingProgress: ratingField,
  comments: z.string().min(1),
});
type FormValues = z.infer<typeof formSchema>;
type FormInputs = z.input<typeof formSchema>;
type CardColor = "" | "YELLOW" | "RED";
type CardEntry = { color: CardColor; reason: string };
type TuteeEntry = { status: TuteeStatus; reason: string };

/** The component remains mounted when its dialog closes. Its captured occurrence,
 * roster, actual fields and accepted receipt change only after explicit discard. */
export function AttendanceForm({
  occurrence,
  open,
  onClose,
  onBusyChange,
  onRetry,
  onReload,
  readBlocked = false,
}: {
  occurrence: AgendaCohort;
  open: boolean;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onRetry?: () => void;
  onReload?: () => void;
  readBlocked?: boolean;
}) {
  const t = useTranslations();
  const planning = useTranslations("sessionPlanning");
  const timeZone = useTimeZone();
  const nowHm = () => programDateTimeInput(new Date(), timeZone).slice(11);
  const router = useRouter();
  const utils = api.useUtils();
  const [snapshot] = useState(occurrence);
  const disciplineQuery = api.tutor.myTuteeDiscipline.useQuery();
  const roomsQuery = api.tutor.rooms.useQuery();
  const schedule = api.tutor.schedule.useQuery();
  const { confirm, dialog } = useDialog();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const submissionState = useRef<"idle" | "pending" | "saved">("idle");
  const features = api.program.features.useQuery().data;
  const refreshSavedTotals = async () => {
    const results = await Promise.allSettled([
      utils.tutor.myMonthlyTotal.fetch(undefined, { staleTime: 0 }),
      utils.tutor.mySessions.invalidate(
        undefined,
        { refetchType: "all" },
        { throwOnError: true },
      ),
      utils.sessionPlanning.agenda.invalidate(
        undefined,
        { refetchType: "all" },
        { throwOnError: true },
      ),
    ]);
    setRefreshFailed(results.some((result) => result.status === "rejected"));
    router.refresh();
  };
  const submit = api.tutor.submitAttendance.useMutation({
    onSuccess: async () => {
      submissionState.current = "saved";
      await refreshSavedTotals();
    },
    onError: () => {
      if (submissionState.current === "pending")
        submissionState.current = "idle";
    },
  });
  useEffect(() => {
    onBusyChange?.(submit.isPending);
    return () => onBusyChange?.(false);
  }, [submit.isPending, onBusyChange]);
  const [tuteeState, setTuteeState] = useState<Record<string, TuteeEntry>>({});
  const [cards, setCards] = useState<Record<string, CardEntry>>({});
  const [online, setOnline] = useState(snapshot.online);
  const [actualRoomId, setActualRoomId] = useState(snapshot.roomId ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const setTutee = (id: string, patch: Partial<TuteeEntry>) =>
    setTuteeState((current) => ({
      ...current,
      [id]: { status: "PRESENT", reason: "", ...current[id], ...patch },
    }));
  const setCard = (id: string, patch: Partial<CardEntry>) =>
    setCards((current) => ({
      ...current,
      [id]: { color: "", reason: "", ...current[id], ...patch },
    }));
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormInputs, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pairingId: snapshot.primaryPairingId ?? "",
      date: snapshot.date,
      tutorStatus: "PRESENT",
      comments: "",
      startTime: minToHm(snapshot.startMin),
      endTime: minToHm(snapshot.endMin % 1440),
    },
  });
  const tutorStatus = watch("tutorStatus");
  const comments = watch("comments");
  const startTime = watch("startTime");
  const endTime = watch("endTime");
  const incomplete = !comments?.trim() || !startTime || !endTime;
  const held = tutorStatus !== "TUTOR_ABSENT";
  const mergeIds = snapshot.pairingIds.filter(
    (id) => id !== snapshot.primaryPairingId,
  );
  const selectedPairing = { id: snapshot.primaryPairingId };
  const unionTutees = snapshot.tutees.map((learner) => ({
    tuteeId: learner.id,
    tutee: {
      englishName: learner.name,
      user: null as { username: string | null } | null,
    },
  }));
  const standingByTutee = new Map(
    (disciplineQuery.data ?? []).map((item) => [item.tuteeId, item]),
  );
  const onSubmit = (values: FormValues) => {
    if (
      submissionState.current !== "idle" ||
      submit.isPending ||
      submit.isSuccess ||
      readBlocked ||
      !snapshot.canRecordAttendance ||
      !snapshot.primaryPairingId
    )
      return;
    const status = values.tutorStatus;
    const tutees = unionTutees.map((learner) => {
      const entry = tuteeState[learner.tuteeId] ?? {
        status: "PRESENT" as TuteeStatus,
        reason: "",
      };
      return {
        tuteeId: learner.tuteeId,
        status: entry.status,
        absenceReason:
          entry.status === "EXCUSED_ABSENT"
            ? entry.reason.trim() || undefined
            : undefined,
      };
    });
    if (status === "TUTOR_ABSENT" && !values.tutorAbsentReason?.trim()) {
      setFormError(t("tutor.attendance.errors.absenceReason"));
      return;
    }
    if (
      tutees.some(
        (learner) =>
          learner.status === "EXCUSED_ABSENT" && !learner.absenceReason,
      )
    ) {
      setFormError(t("tutor.attendance.errors.excusedReason"));
      return;
    }
    const sessionHeld =
      status !== "TUTOR_ABSENT" &&
      tutees.some((learner) => learner.status === "PRESENT");
    if (sessionHeld && RATING_FIELDS.some((name) => values[name] == null)) {
      setFormError(t("tutor.attendance.errors.ratingsRequired"));
      return;
    }
    const unionIds = new Set(unionTutees.map((learner) => learner.tuteeId));
    const cardList = Object.entries(cards)
      .filter(
        ([id, card]) =>
          unionIds.has(id) && (card.color === "YELLOW" || card.color === "RED"),
      )
      .map(([tuteeId, card]) => ({
        tuteeId,
        color: card.color as "YELLOW" | "RED",
        reason: card.reason.trim(),
      }));
    if (cardList.some((card) => !card.reason)) {
      setFormError(t("tutor.attendance.errors.cardReason"));
      return;
    }
    setFormError(null);
    submissionState.current = "pending";
    submit.mutate({
      cohortId: snapshot.id,
      expectedCohortVersion: snapshot.version,
      pairingId: snapshot.primaryPairingId,
      date: new Date(snapshot.date),
      tutorStatus: status,
      tutorAbsentReason:
        status === "TUTOR_ABSENT"
          ? values.tutorAbsentReason?.trim()
          : undefined,
      tutees,
      startMin: hmToMin(values.startTime),
      endMin:
        values.endTime === "00:00" && hmToMin(values.startTime) > 0
          ? 1440
          : hmToMin(values.endTime),
      ratingPreparedness: values.ratingPreparedness,
      ratingParticipation: values.ratingParticipation,
      ratingUnderstanding: values.ratingUnderstanding,
      ratingBehavior: values.ratingBehavior,
      ratingProgress: values.ratingProgress,
      comments: values.comments.trim(),
      actualRoomId: online ? null : actualRoomId || null,
      online,
      cards: cardList.length ? cardList : undefined,
    });
  };
  if (!open) return null;
  return (
    <ProfileDialog
      size="wide"
      title={planning("attendanceTitle", {
        subjects: snapshot.subjects.join(" + "),
      })}
      pending={submit.isPending}
      onClose={() => {
        if (submissionState.current !== "pending" && !submit.isPending)
          onClose();
      }}
    >
      {readBlocked && (
        <p role="alert" className="mb-3 text-amber-900">
          {planning("refreshFailed")}{" "}
          {onRetry && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={onRetry}
            >
              {planning("retry")}
            </button>
          )}
        </p>
      )}
      <p className="muted mb-3 text-sm">{planning("attendanceContext")}</p>
      <p className="mb-3 font-medium">
        {snapshot.subjects.join(" + ")} · {snapshot.date} ·{" "}
        {minToHm(snapshot.startMin)}–{minToHm(snapshot.endMin)}
      </p>
      <p className="mb-4 flex flex-wrap gap-2">
        <span className="badge-slate">
          {planning(snapshot.kind === "EXTRA" ? "extra" : "regular")}
        </span>
        {snapshot.rescheduled && (
          <span className="badge">{planning("rescheduled")}</span>
        )}
      </p>
      <p className="muted mb-5 text-sm">{planning("actualHelp")}</p>
      <form onSubmit={handleSubmit(onSubmit)}>
        <input type="hidden" {...register("pairingId")} />
        <input type="hidden" {...register("date")} />
        {[roomsQuery, schedule].some((query) => query.error) && (
          <div role="alert" className="mb-3 text-sm text-red-700">
            <p>{t("tutor.tasks.loadError")}</p>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                for (const query of [roomsQuery, schedule])
                  if (query.error) void query.refetch();
              }}
            >
              {t("tutor.tasks.retry")}
            </button>
          </div>
        )}
        <fieldset
          disabled={submit.isPending || submit.isSuccess || readBlocked}
          aria-busy={submit.isPending}
          className="min-w-0 space-y-6"
        >
          <label className="block space-y-1">
            <span className="label">{t("tutor.attendance.tutorStatus")}</span>
            <select {...register("tutorStatus")} className="select">
              {TUTOR_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {planning(status === "PRESENT" ? "held" : "absence")}
                </option>
              ))}
            </select>
          </label>
          {tutorStatus === "TUTOR_ABSENT" && (
            <label className="block space-y-1">
              <span className="label">
                {t("tutor.attendance.tutorAbsentReason")}
              </span>
              <input {...register("tutorAbsentReason")} className="input" />
            </label>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="label">{t("tutor.attendance.start")}</span>
              <div className="flex gap-2">
                <input
                  type="time"
                  {...register("startTime")}
                  className="input min-w-0 flex-1"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setValue("startTime", nowHm())}
                >
                  {t("tutor.attendance.now")}
                </button>
              </div>
            </label>
            <label className="space-y-1">
              <span className="label">{t("tutor.attendance.end")}</span>
              <div className="flex gap-2">
                <input
                  type="time"
                  {...register("endTime")}
                  className="input min-w-0 flex-1"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setValue("endTime", nowHm())}
                >
                  {t("tutor.attendance.now")}
                </button>
              </div>
            </label>
          </div>
          {dialog}
          {/* Where the session ran — the room used (or online). Lets the crew validate attendance. */}
          {selectedPairing && held && (
            <div className="space-y-1">
              <label className="label" htmlFor="attendance-room-used">
                {t("tutor.attendance.roomUsed")}
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  id="attendance-room-used"
                  value={actualRoomId}
                  onChange={async (e) => {
                    const roomId = e.target.value;
                    const day = new Date(watch("date")).getUTCDay() || 7;
                    const occupied =
                      !!schedule.data?.pairings.some(
                        (p) =>
                          p.id !== selectedPairing.id &&
                          !mergeIds.includes(p.id) &&
                          p.roomId === roomId &&
                          p.dayOfWeek === day &&
                          p.startMin < hmToMin(endTime || "00:00") &&
                          p.endMin > hmToMin(startTime || "24:00"),
                      ) ||
                      schedule.data?.blocks.some(
                        (b) =>
                          b.roomId === roomId &&
                          b.dayOfWeek === day &&
                          b.startMin < hmToMin(endTime || "00:00") &&
                          b.endMin > hmToMin(startTime || "24:00"),
                      );
                    if (
                      occupied &&
                      !(await confirm({
                        title: t("workflows.roomWarning"),
                        message: t("workflows.roomWarningBody"),
                        confirmLabel: t("workflows.reportActual"),
                        cancelLabel: t("workflows.cancel"),
                      }))
                    )
                      return;
                    setActualRoomId(roomId);
                  }}
                  disabled={online || !schedule.data}
                  className="select field-auto min-w-44"
                >
                  <option value="">{t("tutor.attendance.roomUnset")}</option>
                  {(roomsQuery.data ?? []).map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      {rm.name}
                    </option>
                  ))}
                </select>
                <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-10">
                  <input
                    type="checkbox"
                    checked={online}
                    onChange={(e) => setOnline(e.target.checked)}
                    className="accent-accent-600"
                  />
                  <span>{t("tutor.attendance.online")}</span>
                </label>
              </div>
              <p className="muted text-xs">{t("tutor.attendance.roomHelp")}</p>
            </div>
          )}

          {/* Per-tutee attendance (only when the tutor held the session) */}
          {selectedPairing && held && (
            <fieldset>
              <legend className="label">
                {t("tutor.attendance.tuteeAttendance")}
              </legend>
              <div className="mt-1 space-y-2">
                {unionTutees.map((t2) => {
                  const entry = tuteeState[t2.tuteeId];
                  const status = entry?.status ?? "PRESENT";
                  const standing = standingByTutee.get(t2.tuteeId);
                  return (
                    <div
                      key={t2.tuteeId}
                      className="grid gap-2 rounded-md border border-slate-100 bg-slate-50/60 p-2 sm:flex sm:flex-wrap sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
                    >
                      <span className="min-w-0 truncate text-sm text-slate-700 sm:w-40">
                        <ParticipantName
                          name={t2.tutee.englishName}
                          username={t2.tutee.user?.username}
                        />
                      </span>
                      {/* Card standing at a glance — meter only, no reasons. */}
                      {standing && (
                        <span
                          className="flex items-center gap-1"
                          title={
                            standing.removalPending
                              ? t("tutor.discipline.removalPending")
                              : t("tutor.discipline.standingTitle", {
                                  red: standing.validRed,
                                  yellow: standing.validYellow,
                                })
                          }
                        >
                          <DisciplineSlots
                            validRed={standing.validRed}
                            validYellow={standing.validYellow}
                            size="sm"
                          />
                          {standing.removalPending && (
                            <span className="badge-red">
                              {t("tutor.discipline.removalBadge")}
                            </span>
                          )}
                        </span>
                      )}
                      <select
                        aria-label={`${participantNameLabel(t2.tutee.englishName, t2.tutee.user?.username, t("participantNames.unnamed"))} ${t("tutor.attendance.tuteeAttendance")}`}
                        className="select sm:field-auto min-w-0 sm:min-w-40"
                        value={status}
                        onChange={(e) =>
                          setTutee(t2.tuteeId, {
                            status: e.target.value as TuteeStatus,
                          })
                        }
                      >
                        {TUTEE_STATUS_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {t(`tutor.attendance.tuteeStatusOpt.${s}`)}
                          </option>
                        ))}
                      </select>
                      {status === "EXCUSED_ABSENT" && (
                        <input
                          className="input min-w-0 flex-1"
                          placeholder={t("tutor.attendance.reasonRequired")}
                          value={entry?.reason ?? ""}
                          onChange={(e) =>
                            setTutee(t2.tuteeId, { reason: e.target.value })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* Ratings (required when a session was held) — likert scales */}
          {held && (
            <fieldset className="space-y-3">
              <legend className="label">
                {t("tutor.attendance.ratings")}{" "}
                <FieldRequirement state="required" />
              </legend>
              {RATING_FIELDS.map((name) => (
                <div key={name}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="text-xs font-medium text-slate-600">
                      {t(`tutor.attendance.rating.${name}`)}
                    </p>
                    {/* All five meanings stay visible beside the criterion, while
                      the numeric choices keep one compact row and touch targets. */}
                    <p className="muted flex flex-wrap gap-x-2 text-xs">
                      {LIKERT_VALUES.map((value) => (
                        <span key={value} className="whitespace-nowrap">
                          {value} · {t(`tutor.attendance.likert.${value}`)}
                        </span>
                      ))}
                    </p>
                  </div>
                  <div className="mt-1 grid grid-cols-5 gap-1">
                    {/* The label provides the touch target; native radio artwork stays compact. */}
                    {LIKERT_VALUES.map((value) => (
                      <label
                        key={value}
                        title={t(`tutor.attendance.likert.${value}`)}
                        className="has-[:checked]:border-accent-500 has-[:checked]:bg-accent-50 has-[:checked]:text-accent-700 flex min-h-11 cursor-pointer flex-wrap items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-600 lg:min-h-8"
                      >
                        <input
                          type="radio"
                          value={value}
                          {...register(name)}
                          aria-label={`${t(`tutor.attendance.rating.${name}`)}: ${value} · ${t(`tutor.attendance.likert.${value}`)}`}
                          className="accent-accent-600"
                        />
                        {value}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          )}

          {/* Comments (required) */}
          <div className="space-y-1">
            <label className="label" htmlFor="attendance-comments">
              {t("tutor.attendance.comments")}
            </label>
            <textarea
              {...register("comments")}
              id="attendance-comments"
              rows={3}
              className="textarea"
            />
            {errors.comments && (
              <p className="text-sm text-red-600">{errors.comments.message}</p>
            )}
          </div>

          {/* Disciplinary cards (optional; hidden when the discipline module is off) */}
          {selectedPairing && held && features?.DISCIPLINE && (
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="label px-1">
                {t("tutor.attendance.cardsTitle")}
              </legend>
              <p className="muted mb-2 text-xs">
                {t("tutor.attendance.cardsHelp")}
              </p>
              <div className="space-y-2">
                {unionTutees.map((t2) => {
                  const color = cards[t2.tuteeId]?.color ?? "";
                  return (
                    <div
                      key={t2.tuteeId}
                      className="grid gap-2 rounded-md border border-slate-100 bg-slate-50/60 p-2 sm:flex sm:flex-wrap sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
                    >
                      <span className="min-w-0 truncate text-sm text-slate-700 sm:w-40">
                        <ParticipantName
                          name={t2.tutee.englishName}
                          username={t2.tutee.user?.username}
                        />
                      </span>
                      <select
                        aria-label={`${participantNameLabel(t2.tutee.englishName, t2.tutee.user?.username, t("participantNames.unnamed"))} ${t("tutor.attendance.cardsTitle")}`}
                        className="select sm:field-auto min-w-0 sm:min-w-32"
                        value={color}
                        onChange={(e) =>
                          setCard(t2.tuteeId, {
                            color: e.target.value as CardColor,
                          })
                        }
                      >
                        <option value="">{t("tutor.attendance.noCard")}</option>
                        <option value="YELLOW">
                          🟨 {t("tutor.attendance.yellow")}
                        </option>
                        <option value="RED">
                          🟥 {t("tutor.attendance.red")}
                        </option>
                      </select>
                      {(color === "YELLOW" || color === "RED") && (
                        <input
                          className="input min-w-0 flex-1"
                          placeholder={t("tutor.attendance.reasonRequired")}
                          value={cards[t2.tuteeId]?.reason ?? ""}
                          onChange={(e) =>
                            setCard(t2.tuteeId, { reason: e.target.value })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <button
              type="submit"
              disabled={submit.isPending || incomplete || readBlocked}
              className="btn-primary"
            >
              {submit.isPending
                ? t("tutor.attendance.submitting")
                : t("tutor.attendance.submit")}
            </button>
            {submit.isSuccess && (
              <span role="status" className="text-sm text-green-600">
                {t("tutor.attendance.saved")}
              </span>
            )}
            {(formError ?? submit.error) && (
              <span role="alert" className="text-sm text-red-600">
                {formError ?? submit.error?.message}
              </span>
            )}
          </div>
        </fieldset>
        {refreshFailed && (
          <p role="alert" className="mt-3 text-sm text-amber-800">
            {t("tutor.tasks.savedRefreshError")}{" "}
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void refreshSavedTotals()}
            >
              {t("tutor.tasks.retry")}
            </button>
          </p>
        )}
        {submit.error && onReload && (
          <button
            type="button"
            className="btn-secondary mt-3"
            disabled={submit.isPending}
            onClick={onReload}
          >
            {planning("reload")}
          </button>
        )}
      </form>
    </ProfileDialog>
  );
}

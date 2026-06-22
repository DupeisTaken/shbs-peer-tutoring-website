"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { api } from "~/trpc/react";
import { hmToMin, minToHm } from "~/lib/time";
import { useMerge } from "~/app/(tutor)/_components/merge-context";

const TUTOR_STATUS_VALUES = ["PRESENT", "RESCHEDULED", "EXTRA", "TUTOR_ABSENT"] as const;
const LIKERT_VALUES = [1, 2, 3, 4, 5] as const;
const TUTEE_STATUS_VALUES = ["PRESENT", "EXCUSED_ABSENT", "UNEXCUSED_ABSENT"] as const;

type TutorStatus = (typeof TUTOR_STATUS_VALUES)[number];
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
  pairingId: z.string().min(1, "Select a pairing"),
  date: z.string().min(1, "Pick a date"),
  tutorStatus: z.enum(TUTOR_STATUS_VALUES as unknown as [string, ...string[]]),
  tutorAbsentReason: z.string().optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  ratingPreparedness: ratingField,
  ratingParticipation: ratingField,
  ratingUnderstanding: ratingField,
  ratingBehavior: ratingField,
  ratingProgress: ratingField,
  comments: z.string().min(1, "Comments are required"),
});

type FormValues = z.infer<typeof formSchema>;

type CardColor = "" | "YELLOW" | "RED";
type CardEntry = { color: CardColor; reason: string };
type TuteeEntry = { status: TuteeStatus; reason: string };

/** Current local time as "HH:MM" and today's date as "YYYY-MM-DD". */
const nowHm = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

export function AttendanceForm() {
  const t = useTranslations();
  const utils = api.useUtils();
  const pairingsQuery = api.tutor.myPairings.useQuery();
  const submit = api.tutor.submitAttendance.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tutor.myMonthlyTotal.invalidate(),
        utils.tutor.mySessions.invalidate(),
      ]);
    },
  });

  // Per-tutee attendance + per-tutee card requests, keyed by tuteeId.
  const [tuteeState, setTuteeState] = useState<Record<string, TuteeEntry>>({});
  const [cards, setCards] = useState<Record<string, CardEntry>>({});
  // Which other pairings are merged into this block is chosen under "My pairings" (shared state).
  const { setPrimaryPairingId, mergeIds, setMergeIds } = useMerge();
  const [formError, setFormError] = useState<string | null>(null);
  const setTutee = (id: string, patch: Partial<TuteeEntry>) =>
    setTuteeState((s) => ({ ...s, [id]: { status: "PRESENT", reason: "", ...s[id], ...patch } }));
  const setCard = (id: string, patch: Partial<CardEntry>) =>
    setCards((c) => ({ ...c, [id]: { color: "", reason: "", ...c[id], ...patch } }));

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { date: todayIso(), tutorStatus: "PRESENT", comments: "" },
  });

  const selectedPairingId = watch("pairingId");
  const tutorStatus = watch("tutorStatus") as TutorStatus;
  const comments = watch("comments");
  // The always-required fields — gray the submit until they're filled (the rest is
  // validated on submit with inline messages).
  const incomplete = !selectedPairingId || !comments?.trim();
  const pairings = pairingsQuery.data ?? [];
  const selectedPairing = pairings.find((p) => p.id === selectedPairingId);
  // Tutee attendance is tracked for any held session (present / rescheduled / extra).
  const held = tutorStatus !== "TUTOR_ABSENT";

  const mergedPairings = pairings.filter(
    (p) => mergeIds.includes(p.id) && p.id !== selectedPairingId,
  );
  // The block's combined roster — the primary plus every merged course, de-duplicated.
  const unionTutees = selectedPairing
    ? [
        ...new Map(
          [...selectedPairing.tutees, ...mergedPairings.flatMap((p) => p.tutees)].map((t) => [
            t.tuteeId,
            t,
          ]),
        ).values(),
      ]
    : [];

  // When the primary pairing changes, default the time fields and clear merge/per-tutee state.
  useEffect(() => {
    // Tell "My pairings" which pairing is primary so it can offer eligible merges.
    setPrimaryPairingId(selectedPairingId ?? "");
    if (!selectedPairing) return;
    setValue("startTime", minToHm(selectedPairing.startMin));
    setValue("endTime", minToHm(selectedPairing.endMin));
    setMergeIds([]);
    setTuteeState(
      Object.fromEntries(
        selectedPairing.tutees.map((t) => [t.tuteeId, { status: "PRESENT", reason: "" }]),
      ),
    );
    setCards({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPairingId]);

  const onSubmit = (values: FormValues) => {
    if (!selectedPairing) return;
    const status = values.tutorStatus as TutorStatus;

    // Per-tutee attendance across the whole block (default present).
    const tutees = unionTutees.map((t) => {
      const entry = tuteeState[t.tuteeId] ?? { status: "PRESENT" as TuteeStatus, reason: "" };
      return {
        tuteeId: t.tuteeId,
        status: entry.status,
        absenceReason:
          entry.status === "EXCUSED_ABSENT" ? entry.reason.trim() || undefined : undefined,
      };
    });

    // Cross-field validation mirroring the server.
    if (status === "TUTOR_ABSENT" && !values.tutorAbsentReason?.trim()) {
      setFormError(t("tutor.attendance.errors.absenceReason"));
      return;
    }
    if (tutees.some((t) => t.status === "EXCUSED_ABSENT" && !t.absenceReason)) {
      setFormError(t("tutor.attendance.errors.excusedReason"));
      return;
    }
    const sessionHeld =
      status !== "TUTOR_ABSENT" && tutees.some((t) => t.status === "PRESENT");
    if (
      sessionHeld &&
      [
        values.ratingPreparedness,
        values.ratingParticipation,
        values.ratingUnderstanding,
        values.ratingBehavior,
        values.ratingProgress,
      ].some((r) => r == null)
    ) {
      setFormError(t("tutor.attendance.errors.ratingsRequired"));
      return;
    }

    const unionIds = new Set(unionTutees.map((t) => t.tuteeId));
    const cardList = Object.entries(cards)
      .filter(([id, c]) => unionIds.has(id) && (c.color === "YELLOW" || c.color === "RED"))
      .map(([tuteeId, c]) => ({ tuteeId, color: c.color as "YELLOW" | "RED", reason: c.reason.trim() }));
    if (cardList.some((c) => !c.reason)) {
      setFormError(t("tutor.attendance.errors.cardReason"));
      return;
    }
    setFormError(null);

    submit.mutate({
      pairingId: values.pairingId,
      mergePairingIds: mergeIds.length > 0 ? mergeIds : undefined,
      date: new Date(values.date),
      tutorStatus: status,
      tutorAbsentReason:
        status === "TUTOR_ABSENT" ? values.tutorAbsentReason?.trim() : undefined,
      tutees,
      startMin: hmToMin(values.startTime),
      endMin: hmToMin(values.endTime),
      ratingPreparedness: values.ratingPreparedness,
      ratingParticipation: values.ratingParticipation,
      ratingUnderstanding: values.ratingUnderstanding,
      ratingBehavior: values.ratingBehavior,
      ratingProgress: values.ratingProgress,
      comments: values.comments.trim(),
      cards: cardList.length > 0 ? cardList : undefined,
    });
  };

  if (pairingsQuery.isLoading) return <p className="muted">{t("tutor.attendance.loading")}</p>;
  if (pairings.length === 0) {
    return <p className="muted">{t("tutor.attendance.noPairings")}</p>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Pairing */}
      <div className="space-y-1">
        <label className="label">{t("tutor.attendance.pairing")}</label>
        <select {...register("pairingId")} className="select" defaultValue="">
          <option value="" disabled>
            {t("tutor.attendance.selectPairing")}
          </option>
          {pairings.map((p) => (
            <option key={p.id} value={p.id}>
              {p.subject} · {minToHm(p.startMin)}–{minToHm(p.endMin)}
              {p.room ? ` · ${p.room.name}` : ""}
            </option>
          ))}
        </select>
        {errors.pairingId && <p className="text-sm text-red-600">{errors.pairingId.message}</p>}
      </div>

      {/* Merging several sessions into one block is chosen under "My pairings". */}
      {mergedPairings.length > 0 && (
        <p className="muted text-xs">
          {t("tutor.attendance.mergedCount", { count: mergedPairings.length })}
        </p>
      )}

      {/* Date + tutor status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="label">{t("tutor.attendance.date")}</label>
          <div className="flex gap-2">
            <input type="date" {...register("date")} className="input" />
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              onClick={() => setValue("date", todayIso())}
            >
              {t("tutor.attendance.today")}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="label">{t("tutor.attendance.tutorStatus")}</label>
          <select {...register("tutorStatus")} className="select">
            {TUTOR_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {t(`tutor.attendance.tutorStatusOpt.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tutor absence reason */}
      {tutorStatus === "TUTOR_ABSENT" && (
        <div className="space-y-1">
          <label className="label">{t("tutor.attendance.tutorAbsentReason")}</label>
          <input {...register("tutorAbsentReason")} className="input" />
        </div>
      )}

      {/* Time (with "now") */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="label">{t("tutor.attendance.start")}</label>
          <div className="flex gap-2">
            <input type="time" {...register("startTime")} className="input" />
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              onClick={() => setValue("startTime", nowHm())}
            >
              {t("tutor.attendance.now")}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="label">{t("tutor.attendance.end")}</label>
          <div className="flex gap-2">
            <input type="time" {...register("endTime")} className="input" />
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              onClick={() => setValue("endTime", nowHm())}
            >
              {t("tutor.attendance.now")}
            </button>
          </div>
        </div>
      </div>

      {/* Per-tutee attendance (only when the tutor held the session) */}
      {selectedPairing && held && (
        <fieldset>
          <legend className="label">{t("tutor.attendance.tuteeAttendance")}</legend>
          <div className="mt-1 space-y-2">
            {unionTutees.map((t2) => {
              const entry = tuteeState[t2.tuteeId];
              const status = entry?.status ?? "PRESENT";
              return (
                <div key={t2.tuteeId} className="flex flex-wrap items-center gap-2">
                  <span className="w-40 truncate text-sm text-slate-700">
                    {t2.tutee.englishName}
                  </span>
                  <select
                    className="select field-auto min-w-40"
                    value={status}
                    onChange={(e) => setTutee(t2.tuteeId, { status: e.target.value as TuteeStatus })}
                  >
                    {TUTEE_STATUS_VALUES.map((s) => (
                      <option key={s} value={s}>
                        {t(`tutor.attendance.tuteeStatusOpt.${s}`)}
                      </option>
                    ))}
                  </select>
                  {status === "EXCUSED_ABSENT" && (
                    <input
                      className="input min-w-[10rem] flex-1"
                      placeholder={t("tutor.attendance.reasonRequired")}
                      value={entry?.reason ?? ""}
                      onChange={(e) => setTutee(t2.tuteeId, { reason: e.target.value })}
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
          <legend className="label">{t("tutor.attendance.ratings")}</legend>
          {RATING_FIELDS.map((name) => (
            <div key={name}>
              <p className="text-xs font-medium text-slate-600">
                {t(`tutor.attendance.rating.${name}`)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {LIKERT_VALUES.map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 has-[:checked]:border-accent-500 has-[:checked]:bg-accent-50 has-[:checked]:text-accent-700"
                  >
                    <input
                      type="radio"
                      value={value}
                      {...register(name)}
                      className="accent-accent-600"
                    />
                    {value} · {t(`tutor.attendance.likert.${value}`)}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}

      {/* Comments (required) */}
      <div className="space-y-1">
        <label className="label">{t("tutor.attendance.comments")}</label>
        <textarea {...register("comments")} rows={3} className="textarea" />
        {errors.comments && <p className="text-sm text-red-600">{errors.comments.message}</p>}
      </div>

      {/* Disciplinary cards (optional) */}
      {selectedPairing && held && (
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="label px-1">{t("tutor.attendance.cardsTitle")}</legend>
          <p className="muted mb-2 text-xs">{t("tutor.attendance.cardsHelp")}</p>
          <div className="space-y-2">
            {unionTutees.map((t2) => {
              const color = cards[t2.tuteeId]?.color ?? "";
              return (
                <div key={t2.tuteeId} className="flex flex-wrap items-center gap-2">
                  <span className="w-40 truncate text-sm text-slate-700">
                    {t2.tutee.englishName}
                  </span>
                  <select
                    className="select field-auto min-w-32"
                    value={color}
                    onChange={(e) => setCard(t2.tuteeId, { color: e.target.value as CardColor })}
                  >
                    <option value="">{t("tutor.attendance.noCard")}</option>
                    <option value="YELLOW">🟨 {t("tutor.attendance.yellow")}</option>
                    <option value="RED">🟥 {t("tutor.attendance.red")}</option>
                  </select>
                  {(color === "YELLOW" || color === "RED") && (
                    <input
                      className="input min-w-[12rem] flex-1"
                      placeholder={t("tutor.attendance.reasonRequired")}
                      value={cards[t2.tuteeId]?.reason ?? ""}
                      onChange={(e) => setCard(t2.tuteeId, { reason: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submit.isPending || incomplete} className="btn-primary">
          {submit.isPending ? t("tutor.attendance.submitting") : t("tutor.attendance.submit")}
        </button>
        {submit.isSuccess && <span className="text-sm text-green-600">{t("tutor.attendance.saved")}</span>}
        {(formError ?? submit.error) && (
          <span className="text-sm text-red-600">
            {formError ?? submit.error?.message}
          </span>
        )}
      </div>

      {submit.isSuccess && (
        <button
          type="button"
          onClick={() => {
            reset();
            setTuteeState({});
            setCards({});
            setMergeIds([]);
            setFormError(null);
          }}
          className="link text-sm"
        >
          {t("tutor.attendance.submitAnother")}
        </button>
      )}
    </form>
  );
}

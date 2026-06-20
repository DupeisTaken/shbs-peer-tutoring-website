"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "~/trpc/react";
import { hmToMin, minToHm } from "~/lib/time";

const TUTOR_STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "RESCHEDULED", label: "Rescheduled" },
  { value: "EXTRA", label: "Extra session" },
  { value: "TUTOR_ABSENT", label: "Tutor absent" },
] as const;

/** Likert anchors shown under each 1–5 rating scale. */
const LIKERT = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Fair" },
  { value: 3, label: "Good" },
  { value: 4, label: "Great" },
  { value: 5, label: "Excellent" },
] as const;

const TUTEE_STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "EXCUSED_ABSENT", label: "Excused absent" },
  { value: "UNEXCUSED_ABSENT", label: "Unexcused absent" },
] as const;

type TutorStatus = (typeof TUTOR_STATUSES)[number]["value"];
type TuteeStatus = (typeof TUTEE_STATUSES)[number]["value"];

const RATING_FIELDS = [
  ["ratingPreparedness", "Preparedness"],
  ["ratingParticipation", "Participation"],
  ["ratingUnderstanding", "Understanding"],
  ["ratingBehavior", "Behavior"],
  ["ratingProgress", "Progress"],
] as const;

const ratingField = z.coerce.number().int().min(1).max(5).optional();

const formSchema = z.object({
  pairingId: z.string().min(1, "Select a pairing"),
  date: z.string().min(1, "Pick a date"),
  tutorStatus: z.enum(TUTOR_STATUSES.map((s) => s.value) as [string, ...string[]]),
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
  const pairings = pairingsQuery.data ?? [];
  const selectedPairing = pairings.find((p) => p.id === selectedPairingId);
  // Tutee attendance is tracked for any held session (present / rescheduled / extra).
  const held = tutorStatus !== "TUTOR_ABSENT";

  // When the pairing changes, default the time fields, reset per-tutee state + cards.
  useEffect(() => {
    if (!selectedPairing) return;
    setValue("startTime", minToHm(selectedPairing.startMin));
    setValue("endTime", minToHm(selectedPairing.endMin));
    setTuteeState(
      Object.fromEntries(
        selectedPairing.tutees.map((t) => [t.tuteeId, { status: "PRESENT", reason: "" }]),
      ),
    );
    setCards({});
    setFormError(null);
  }, [selectedPairingId, selectedPairing, setValue]);

  const onSubmit = (values: FormValues) => {
    if (!selectedPairing) return;
    const status = values.tutorStatus as TutorStatus;

    // Per-tutee attendance for the whole roster (default present).
    const tutees = selectedPairing.tutees.map((t) => {
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
      setFormError("Give a reason for the tutor absence.");
      return;
    }
    if (tutees.some((t) => t.status === "EXCUSED_ABSENT" && !t.absenceReason)) {
      setFormError("Give a reason for each excused absence.");
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
      setFormError("Ratings are required for a held session.");
      return;
    }

    const cardList = Object.entries(cards)
      .filter(([, c]) => c.color === "YELLOW" || c.color === "RED")
      .map(([tuteeId, c]) => ({ tuteeId, color: c.color as "YELLOW" | "RED", reason: c.reason.trim() }));
    if (cardList.some((c) => !c.reason)) {
      setFormError("Add a reason for each card you assign.");
      return;
    }
    setFormError(null);

    submit.mutate({
      pairingId: values.pairingId,
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

  if (pairingsQuery.isLoading) return <p className="muted">Loading your pairings…</p>;
  if (pairings.length === 0) {
    return <p className="muted">You have no pairings yet. Ask an admin to set one up.</p>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Pairing */}
      <div className="space-y-1">
        <label className="label">Pairing</label>
        <select {...register("pairingId")} className="select" defaultValue="">
          <option value="" disabled>
            Select a pairing…
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

      {/* Date + tutor status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="label">Date</label>
          <div className="flex gap-2">
            <input type="date" {...register("date")} className="input" />
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              onClick={() => setValue("date", todayIso())}
            >
              Today
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="label">Tutor status</label>
          <select {...register("tutorStatus")} className="select">
            {TUTOR_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tutor absence reason */}
      {tutorStatus === "TUTOR_ABSENT" && (
        <div className="space-y-1">
          <label className="label">Reason for tutor absence *</label>
          <input {...register("tutorAbsentReason")} className="input" />
        </div>
      )}

      {/* Time (with "now") */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="label">Start</label>
          <div className="flex gap-2">
            <input type="time" {...register("startTime")} className="input" />
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              onClick={() => setValue("startTime", nowHm())}
            >
              Now
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="label">End</label>
          <div className="flex gap-2">
            <input type="time" {...register("endTime")} className="input" />
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              onClick={() => setValue("endTime", nowHm())}
            >
              Now
            </button>
          </div>
        </div>
      </div>

      {/* Per-tutee attendance (only when the tutor held the session) */}
      {selectedPairing && held && (
        <fieldset>
          <legend className="label">Tutee attendance</legend>
          <div className="mt-1 space-y-2">
            {selectedPairing.tutees.map((t) => {
              const entry = tuteeState[t.tuteeId];
              const status = entry?.status ?? "PRESENT";
              return (
                <div key={t.tuteeId} className="flex flex-wrap items-center gap-2">
                  <span className="w-40 truncate text-sm text-slate-700">
                    {t.tutee.englishName}
                  </span>
                  <select
                    className="select w-44"
                    value={status}
                    onChange={(e) => setTutee(t.tuteeId, { status: e.target.value as TuteeStatus })}
                  >
                    {TUTEE_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {status === "EXCUSED_ABSENT" && (
                    <input
                      className="input min-w-[10rem] flex-1"
                      placeholder="Reason (required)"
                      value={entry?.reason ?? ""}
                      onChange={(e) => setTutee(t.tuteeId, { reason: e.target.value })}
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
          <legend className="label">Ratings *</legend>
          {RATING_FIELDS.map(([name, label]) => (
            <div key={name}>
              <p className="text-xs font-medium text-slate-600">{label}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {LIKERT.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700"
                  >
                    <input
                      type="radio"
                      value={opt.value}
                      {...register(name)}
                      className="accent-indigo-600"
                    />
                    {opt.value} · {opt.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}

      {/* Comments (required) */}
      <div className="space-y-1">
        <label className="label">Comments *</label>
        <textarea {...register("comments")} rows={3} className="textarea" />
        {errors.comments && <p className="text-sm text-red-600">{errors.comments.message}</p>}
      </div>

      {/* Disciplinary cards (optional) */}
      {selectedPairing && held && (
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="label px-1">Disciplinary cards (optional)</legend>
          <p className="muted mb-2 text-xs">
            Assign a yellow or red card with a brief reason. The team rechecks each before it
            counts. (An unexcused absence above auto-issues a red card.)
          </p>
          <div className="space-y-2">
            {selectedPairing.tutees.map((t) => {
              const color = cards[t.tuteeId]?.color ?? "";
              return (
                <div key={t.tuteeId} className="flex flex-wrap items-center gap-2">
                  <span className="w-40 truncate text-sm text-slate-700">
                    {t.tutee.englishName}
                  </span>
                  <select
                    className="select w-28"
                    value={color}
                    onChange={(e) => setCard(t.tuteeId, { color: e.target.value as CardColor })}
                  >
                    <option value="">No card</option>
                    <option value="YELLOW">🟨 Yellow</option>
                    <option value="RED">🟥 Red</option>
                  </select>
                  {(color === "YELLOW" || color === "RED") && (
                    <input
                      className="input min-w-[12rem] flex-1"
                      placeholder="Reason (required)"
                      value={cards[t.tuteeId]?.reason ?? ""}
                      onChange={(e) => setCard(t.tuteeId, { reason: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submit.isPending} className="btn-primary">
          {submit.isPending ? "Submitting…" : "Submit attendance"}
        </button>
        {submit.isSuccess && <span className="text-sm text-green-600">Saved.</span>}
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
            setFormError(null);
          }}
          className="link text-sm"
        >
          Submit another
        </button>
      )}
    </form>
  );
}

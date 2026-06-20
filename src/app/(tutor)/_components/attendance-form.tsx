"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "~/trpc/react";
import { hmToMin, minToHm } from "~/lib/time";

const STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "RESCHEDULED", label: "Rescheduled" },
  { value: "EXTRA_SESSION", label: "Extra session" },
  { value: "TUTOR_ABSENT", label: "Tutor absent" },
  { value: "TUTEE_ABSENT_EXCUSED", label: "Tutee absent (excused)" },
  { value: "TUTEE_ABSENT_UNEXCUSED", label: "Tutee absent (unexcused)" },
] as const;

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
  status: z.enum(STATUSES.map((s) => s.value) as [string, ...string[]]),
  tuteeIds: z.array(z.string()).min(1, "Select at least one tutee"),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  ratingPreparedness: ratingField,
  ratingParticipation: ratingField,
  ratingUnderstanding: ratingField,
  ratingBehavior: ratingField,
  ratingProgress: ratingField,
  comments: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

type CardColor = "" | "YELLOW" | "RED";
type CardEntry = { color: CardColor; reason: string };

export function AttendanceForm() {
  const utils = api.useUtils();
  // Per-tutee disciplinary card requests, keyed by tuteeId. Reset when the pairing changes.
  const [cards, setCards] = useState<Record<string, CardEntry>>({});
  const [cardError, setCardError] = useState<string | null>(null);
  const setCard = (tuteeId: string, patch: Partial<CardEntry>) =>
    setCards((c) => ({
      ...c,
      [tuteeId]: { color: "", reason: "", ...c[tuteeId], ...patch },
    }));
  const pairingsQuery = api.tutor.myPairings.useQuery();
  const submit = api.tutor.submitAttendance.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tutor.myMonthlyTotal.invalidate(),
        utils.tutor.mySessions.invalidate(),
      ]);
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      status: "PRESENT",
      tuteeIds: [],
    },
  });

  const selectedPairingId = watch("pairingId");
  const pairings = pairingsQuery.data ?? [];
  const selectedPairing = pairings.find((p) => p.id === selectedPairingId);

  // When the pairing changes, default the time fields, select the whole roster, clear cards.
  useEffect(() => {
    if (!selectedPairing) return;
    setValue("startTime", minToHm(selectedPairing.startMin));
    setValue("endTime", minToHm(selectedPairing.endMin));
    setValue(
      "tuteeIds",
      selectedPairing.tutees.map((t) => t.tuteeId),
    );
    setCards({});
    setCardError(null);
  }, [selectedPairingId, selectedPairing, setValue]);

  const onSubmit = (values: FormValues) => {
    // Assemble card requests; each carded tutee needs a reason (policy §V.5).
    const cardList = Object.entries(cards)
      .filter(([, c]) => c.color === "YELLOW" || c.color === "RED")
      .map(([tuteeId, c]) => ({
        tuteeId,
        color: c.color as "YELLOW" | "RED",
        reason: c.reason.trim(),
      }));
    if (cardList.some((c) => !c.reason)) {
      setCardError("Add a reason for each card you assign.");
      return;
    }
    setCardError(null);

    submit.mutate({
      pairingId: values.pairingId,
      date: new Date(values.date),
      status: values.status as (typeof STATUSES)[number]["value"],
      tuteeIds: values.tuteeIds,
      startMin: hmToMin(values.startTime),
      endMin: hmToMin(values.endTime),
      ratingPreparedness: values.ratingPreparedness,
      ratingParticipation: values.ratingParticipation,
      ratingUnderstanding: values.ratingUnderstanding,
      ratingBehavior: values.ratingBehavior,
      ratingProgress: values.ratingProgress,
      comments: values.comments?.trim() ? values.comments.trim() : undefined,
      cards: cardList.length > 0 ? cardList : undefined,
    });
  };

  if (pairingsQuery.isLoading) {
    return <p className="muted">Loading your pairings…</p>;
  }
  if (pairings.length === 0) {
    return (
      <p className="muted">You have no pairings yet. Ask an admin to set one up.</p>
    );
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
        {errors.pairingId && (
          <p className="text-sm text-red-600">{errors.pairingId.message}</p>
        )}
      </div>

      {/* Tutees (from the pairing roster only — not free text) */}
      {selectedPairing && (
        <fieldset>
          <legend className="label">Tutees present</legend>
          <div className="mt-1 space-y-1">
            {selectedPairing.tutees.map((t) => (
              <label key={t.tuteeId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" value={t.tuteeId} {...register("tuteeIds")} />
                {t.tutee.englishName}
              </label>
            ))}
          </div>
          {errors.tuteeIds && (
            <p className="text-sm text-red-600">{errors.tuteeIds.message}</p>
          )}
        </fieldset>
      )}

      {/* Date + status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="label">Date</label>
          <input type="date" {...register("date")} className="input" />
        </div>
        <div className="space-y-1">
          <label className="label">Status</label>
          <select {...register("status")} className="select">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Time */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="label">Start</label>
          <input type="time" {...register("startTime")} className="input" />
        </div>
        <div className="space-y-1">
          <label className="label">End</label>
          <input type="time" {...register("endTime")} className="input" />
        </div>
      </div>

      {/* Ratings */}
      <fieldset>
        <legend className="label">Ratings (1–5, optional)</legend>
        <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {RATING_FIELDS.map(([name, label]) => (
            <div key={name} className="space-y-1">
              <label className="block text-xs text-slate-500">{label}</label>
              <select {...register(name)} className="select" defaultValue="">
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      {/* Comments */}
      <div className="space-y-1">
        <label className="label">Comments</label>
        <textarea {...register("comments")} rows={3} className="textarea" />
      </div>

      {/* Disciplinary cards (optional) — sent to the team for recheck. */}
      {selectedPairing && (
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="label px-1">Disciplinary cards (optional)</legend>
          <p className="muted mb-2 text-xs">
            Assign a yellow or red card with a brief reason. The team rechecks each before it
            counts. (An unexcused absence auto-issues a red card.)
          </p>
          <div className="space-y-2">
            {selectedPairing.tutees.map((t) => {
              const entry = cards[t.tuteeId];
              const color = entry?.color ?? "";
              return (
                <div key={t.tuteeId} className="flex flex-wrap items-center gap-2">
                  <span className="w-40 truncate text-sm text-slate-700">
                    {t.tutee.englishName}
                  </span>
                  <select
                    className="select w-28"
                    value={color}
                    onChange={(e) =>
                      setCard(t.tuteeId, { color: e.target.value as CardColor })
                    }
                  >
                    <option value="">No card</option>
                    <option value="YELLOW">🟨 Yellow</option>
                    <option value="RED">🟥 Red</option>
                  </select>
                  {(color === "YELLOW" || color === "RED") && (
                    <input
                      className="input min-w-[12rem] flex-1"
                      placeholder="Reason (required)"
                      value={entry?.reason ?? ""}
                      onChange={(e) => setCard(t.tuteeId, { reason: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {cardError && <p className="mt-2 text-sm text-red-600">{cardError}</p>}
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submit.isPending} className="btn-primary">
          {submit.isPending ? "Submitting…" : "Submit attendance"}
        </button>
        {submit.isSuccess && <span className="text-sm text-green-600">Saved.</span>}
        {submit.error && (
          <span className="text-sm text-red-600">{submit.error.message}</span>
        )}
      </div>

      {submit.isSuccess && (
        <button
          type="button"
          onClick={() => {
            reset();
            setCards({});
            setCardError(null);
          }}
          className="link text-sm"
        >
          Submit another
        </button>
      )}
    </form>
  );
}

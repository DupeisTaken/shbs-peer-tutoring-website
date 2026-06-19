"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "~/trpc/react";

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

function hmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

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

  // When the pairing changes, default the time fields and select the whole roster.
  useEffect(() => {
    if (!selectedPairing) return;
    setValue("startTime", minToHm(selectedPairing.startMin));
    setValue("endTime", minToHm(selectedPairing.endMin));
    setValue(
      "tuteeIds",
      selectedPairing.tutees.map((t) => t.tuteeId),
    );
  }, [selectedPairingId, selectedPairing, setValue]);

  const onSubmit = (values: FormValues) => {
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
    });
  };

  if (pairingsQuery.isLoading) {
    return <p className="text-gray-500">Loading your pairings…</p>;
  }
  if (pairings.length === 0) {
    return (
      <p className="text-gray-500">
        You have no pairings yet. Ask an admin to set one up.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Pairing */}
      <div>
        <label className="block text-sm font-medium">Pairing</label>
        <select
          {...register("pairingId")}
          className="mt-1 w-full rounded border px-3 py-2"
          defaultValue=""
        >
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
          <p className="mt-1 text-sm text-red-600">{errors.pairingId.message}</p>
        )}
      </div>

      {/* Tutees (from the pairing roster only — not free text) */}
      {selectedPairing && (
        <fieldset>
          <legend className="text-sm font-medium">Tutees present</legend>
          <div className="mt-1 space-y-1">
            {selectedPairing.tutees.map((t) => (
              <label key={t.tuteeId} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  value={t.tuteeId}
                  {...register("tuteeIds")}
                />
                {t.tutee.englishName}
              </label>
            ))}
          </div>
          {errors.tuteeIds && (
            <p className="mt-1 text-sm text-red-600">{errors.tuteeIds.message}</p>
          )}
        </fieldset>
      )}

      {/* Date + status */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">Date</label>
          <input
            type="date"
            {...register("date")}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Status</label>
          <select
            {...register("status")}
            className="mt-1 w-full rounded border px-3 py-2"
          >
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
        <div>
          <label className="block text-sm font-medium">Start</label>
          <input
            type="time"
            {...register("startTime")}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">End</label>
          <input
            type="time"
            {...register("endTime")}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </div>
      </div>

      {/* Ratings */}
      <fieldset>
        <legend className="text-sm font-medium">Ratings (1–5, optional)</legend>
        <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {RATING_FIELDS.map(([name, label]) => (
            <div key={name}>
              <label className="block text-xs text-gray-600">{label}</label>
              <select
                {...register(name)}
                className="mt-1 w-full rounded border px-2 py-1"
                defaultValue=""
              >
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
      <div>
        <label className="block text-sm font-medium">Comments</label>
        <textarea
          {...register("comments")}
          rows={3}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submit.isPending}
          className="rounded bg-indigo-600 px-5 py-2 font-semibold text-white disabled:opacity-50"
        >
          {submit.isPending ? "Submitting…" : "Submit attendance"}
        </button>
        {submit.isSuccess && (
          <span className="text-sm text-green-600">Saved.</span>
        )}
        {submit.error && (
          <span className="text-sm text-red-600">{submit.error.message}</span>
        )}
      </div>

      {submit.isSuccess && (
        <button
          type="button"
          onClick={() => reset()}
          className="text-sm text-indigo-600 underline"
        >
          Submit another
        </button>
      )}
    </form>
  );
}

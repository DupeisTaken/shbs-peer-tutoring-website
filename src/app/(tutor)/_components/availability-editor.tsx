"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";

/**
 * Lets a tutor mark which catalog time slots they can teach. Slots are reference-only;
 * admins use availability when assigning tutees and building pairings.
 */
export function AvailabilityEditor() {
  const utils = api.useUtils();
  const query = api.tutor.myAvailability.useQuery();
  const save = api.tutor.setAvailability.useMutation({
    onSuccess: () => utils.tutor.myAvailability.invalidate(),
  });

  const slots = useMemo(() => query.data?.slots ?? [], [query.data]);
  const [selected, setSelected] = useState<string[]>([]);

  // Seed local selection once the server data arrives.
  useEffect(() => {
    if (query.data) setSelected(query.data.selectedSlotIds);
  }, [query.data]);

  const slotsByDay = useMemo(() => {
    const map = new Map<number, typeof slots>();
    for (const s of slots) {
      const arr = map.get(s.dayOfWeek) ?? [];
      arr.push(s);
      map.set(s.dayOfWeek, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [slots]);

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id],
    );

  if (query.isLoading) return <p className="muted">Loading time slots…</p>;
  if (slots.length === 0)
    return <p className="muted">No time slots have been published yet.</p>;

  return (
    <div className="space-y-3">
      {slotsByDay.map(([day, daySlots]) => (
        <div key={day}>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
            {DAY_NAMES[day]}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {daySlots.map((s) => {
              const checked = selected.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition ${
                    checked
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggle(s.id)}
                  />
                  {s.label}{" "}
                  <span className="text-slate-400">
                    ({minToHm(s.startMin)}–{minToHm(s.endMin)})
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <button
          className="btn-primary btn-sm"
          onClick={() => save.mutate({ slotIds: selected })}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save availability"}
        </button>
        {save.isSuccess && <span className="text-sm text-green-600">Saved.</span>}
      </div>
    </div>
  );
}

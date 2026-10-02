"use client";

import { useMemo, useState } from "react";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { Button, ChoiceButton } from "~/app/_components/ui/button";
import { FormActions } from "~/app/_components/ui/patterns";

/**
 * Lets a tutor mark which catalog time slots they can teach. Slots are reference-only;
 * admins use availability when assigning tutees and building pairings.
 */
export function AvailabilityEditor() {
  const t = useTranslations();
  const query = api.tutor.myAvailability.useQuery();
  // Follow live server data until editing starts; background refetches must not
  // replace an unsaved selection or a draft retained after a failed request.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [sync, setSync] = useState<
    { status: "idle" | "refreshing" } | { status: "failed"; message: string }
  >({ status: "idle" });
  const selected = draft ?? query.data?.selectedSlotIds ?? [];

  const refreshSavedSelection = async () => {
    setSync({ status: "refreshing" });
    try {
      // The mutation returns a count and may filter inactive slots. Only a fresh
      // GET can tell us the accepted IDs; invalidation alone can swallow failure.
      await query.refetch({ throwOnError: true });
      setDraft(null);
      setSync({ status: "idle" });
    } catch (error) {
      setSync({
        status: "failed",
        message:
          error instanceof Error ? error.message : t("uiPatterns.loadFailed"),
      });
    }
  };
  const save = api.tutor.setAvailability.useMutation({
    onSuccess: refreshSavedSelection,
  });
  // After a successful write, keep the submitted selection visible but prevent
  // another write or Cancel from restoring a stale cache until refresh succeeds.
  const locked = save.isPending || sync.status !== "idle";

  const slots = useMemo(() => query.data?.slots ?? [], [query.data]);

  const slotsByDay = useMemo(() => {
    const map = new Map<number, typeof slots>();
    for (const s of slots) {
      const arr = map.get(s.dayOfWeek) ?? [];
      arr.push(s);
      map.set(s.dayOfWeek, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [slots]);

  const toggle = (id: string) => {
    if (locked) return;
    setDraft((current) => {
      const selection = current ?? query.data?.selectedSlotIds ?? [];
      return selection.includes(id)
        ? selection.filter((slotId) => slotId !== id)
        : [...selection, id];
    });
    save.reset();
  };

  if (query.isLoading)
    return <p className="muted">{t("tutor.availability.loading")}</p>;
  if (slots.length === 0)
    return <p className="muted">{t("tutor.availability.empty")}</p>;

  return (
    <div
      className="space-y-3"
      aria-busy={save.isPending || sync.status === "refreshing"}
    >
      {slotsByDay.map(([day, daySlots]) => (
        <div key={day}>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
            {DAY_NAMES[day]}
          </p>
          <div
            role="group"
            aria-label={DAY_NAMES[day]}
            className="mt-1 flex flex-wrap gap-2"
          >
            {daySlots.map((s) => {
              const checked = selected.includes(s.id);
              return (
                // The visible control owns focus and pressed state, including keyboard selection.
                <ChoiceButton
                  key={s.id}
                  selected={checked}
                  disabled={locked}
                  onClick={() => toggle(s.id)}
                >
                  {s.label}{" "}
                  <span className="text-slate-500">
                    ({minToHm(s.startMin)}–{minToHm(s.endMin)})
                  </span>
                </ChoiceButton>
              );
            })}
          </div>
        </div>
      ))}

      <FormActions>
        <Button
          variant="primary"
          onClick={() => {
            if (!locked) save.mutate({ slotIds: selected });
          }}
          disabled={locked}
        >
          {save.isPending || sync.status === "refreshing"
            ? t("tutor.availability.saving")
            : t("tutor.availability.save")}
        </Button>
        <Button
          disabled={locked}
          onClick={() => {
            setDraft(null);
            save.reset();
          }}
        >
          {t("uiPatterns.cancel")}
        </Button>
        {save.isSuccess && sync.status === "idle" && (
          <span role="status" className="text-sm text-green-700">
            {t("tutor.availability.saved")}
          </span>
        )}
        {save.error && (
          <span role="alert" className="text-sm text-red-700">
            {save.error.message}
          </span>
        )}
      </FormActions>
      {sync.status === "failed" && (
        <div role="alert" className="space-y-2 text-sm text-red-700">
          <p>{t("tutor.availability.refreshFailed")}</p>
          <p>{sync.message}</p>
          <Button onClick={refreshSavedSelection}>
            {t("uiPatterns.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

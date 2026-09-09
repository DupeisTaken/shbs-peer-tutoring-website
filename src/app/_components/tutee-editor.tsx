"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api, type RouterOutputs } from "~/trpc/react";

/** Profile correction stays separate from assignment/removal, while the version protects both. */
export function TuteeEditor({
  row,
}: {
  row: RouterOutputs["admin"]["tutees"][number];
}) {
  const t = useTranslations("profileCorrection");
  const [open, setOpen] = useState(true);
  const utils = api.useUtils();
  const subjects = api.admin.subjects.useQuery(undefined, { enabled: open });
  const slots = api.admin.timeSlots.useQuery(undefined, { enabled: open });
  const save = api.admin.updateTutee.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.tutees.invalidate(),
        utils.admin.pairings.invalidate(),
        utils.admin.tuteeStats.invalidate(),
      ]);
      setOpen(false);
    },
  });
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="mt-2 text-left"
    >
      <summary className="link cursor-pointer">{t("edit")}</summary>
      {open && subjects.data && slots.data && (
        <form
          className="mt-3 grid max-w-3xl gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const value = (key: string) =>
              (typeof data.get(key) === "string"
                ? (data.get(key) as string)
                : ""
              ).trim() || null;
            save.mutate({
              id: row.id,
              expectedUpdatedAt: row.updatedAt,
              englishName: value("name")!,
              status: row.status,
              email: value("email"),
              phone: value("phone"),
              preferredContact: value("preferredContact"),
              gradeLevel: value("grade"),
              notes: value("notes"),
              firstChoiceId: value("firstChoice"),
              secondChoiceId: value("secondChoice"),
              slotIds: data.getAll("slot").map(String),
            });
          }}
        >
          {(
            [
              ["name", t("name"), row.englishName],
              ["grade", t("grade"), row.gradeLevel],
              ["email", t("email"), row.email],
              ["phone", t("phone"), row.phone],
              ["preferredContact", t("contact"), row.preferredContact],
            ] as const
          ).map(([name, label, value]) => (
            <label key={name} className="block">
              <span className="label">{label}</span>
              <input
                className="input w-full"
                name={name}
                defaultValue={value ?? ""}
                type={name === "email" ? "email" : "text"}
                required={name === "name"}
              />
            </label>
          ))}
          {(
            [
              ["firstChoice", t("first"), row.firstChoiceId],
              ["secondChoice", t("second"), row.secondChoiceId],
            ] as const
          ).map(([name, label, id]) => (
            <label key={name} className="block">
              <span className="label">{label}</span>
              <select
                className="select w-full"
                name={name}
                defaultValue={id ?? ""}
              >
                <option value="">{t("none")}</option>
                {subjects.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.active ? "" : t("inactive")}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <fieldset>
            <legend className="label">{t("availability")}</legend>
            {slots.data
              ?.filter((s) => s.active)
              .map((s) => (
                <label className="flex items-center gap-2" key={s.id}>
                  <input
                    type="checkbox"
                    name="slot"
                    value={s.id}
                    defaultChecked={row.availabilities.some(
                      (a) => a.slot.id === s.id,
                    )}
                  />
                  {s.label}
                </label>
              ))}
          </fieldset>
          <label className="block">
            <span className="label">{t("notes")}</span>
            <textarea
              className="input w-full"
              name="notes"
              defaultValue={row.notes ?? ""}
            />
          </label>
          <button
            className="btn-primary self-end justify-self-start"
            disabled={save.isPending || subjects.isLoading || slots.isLoading}
          >
            {t("save")}
          </button>
          {save.error && (
            <p role="alert" className="text-sm text-red-600">
              {save.error.message}
            </p>
          )}
        </form>
      )}
    </details>
  );
}

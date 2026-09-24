"use client";
import { useTranslations } from "next-intl";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { api, type RouterOutputs } from "~/trpc/react";

/** Profile correction stays separate from assignment/removal, while the version protects both. */
export function TuteeEditor({
  row,
  onClose,
}: {
  row: RouterOutputs["admin"]["tutees"][number];
  onClose: () => void;
}) {
  const t = useTranslations("profileCorrection");
  const profileText = useTranslations("accountProfile");
  const utils = api.useUtils();
  const subjects = api.admin.subjects.useQuery();
  const slots = api.admin.timeSlots.useQuery();
  const save = api.admin.updateTutee.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.tutees.invalidate(),
        utils.admin.pairings.invalidate(),
        utils.admin.tuteeStats.invalidate(),
        utils.admin.accounts.invalidate(),
        utils.admin.tutors.invalidate(),
      ]);
      onClose();
    },
  });
  return (
    <ProfileDialog title={profileText("editProfile")} onClose={onClose}>
      <p className="muted text-sm">
        {row.user ? profileText("canonicalHelp") : profileText("setupRequired")}
      </p>
      {subjects.data && slots.data && (
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
              alternativeNames: value("alternativeNames"),
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
              [
                "alternativeNames",
                profileText("alternativeNames"),
                row.alternativeNames,
              ],
              ["grade", t("grade"), row.gradeLevel],
              ["email", t("email"), row.user?.email ?? row.email],
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
                readOnly={name === "email" && !!row.user}
              />
              {name === "email" && row.user && (
                <span className="muted text-xs">
                  {profileText("emailProtected")}
                </span>
              )}
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
    </ProfileDialog>
  );
}

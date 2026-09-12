"use client";

import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";

/** One deliberate save avoids racing field-by-field corrections of the same person. */
export function TutorProfileEditor({
  row,
  onClose,
}: {
  row: RouterOutputs["admin"]["tutors"][number];
  onClose: () => void;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const save = api.admin.updateTutor.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.tutors.invalidate(),
        utils.admin.tutees.invalidate(),
        utils.admin.accounts.invalidate(),
      ]);
      onClose();
    },
  });
  return (
    <ProfileDialog title={t("accountProfile.editProfile")} onClose={onClose}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const value = (key: string) => {
            const field = data.get(key);
            return typeof field === "string" ? field.trim() : "";
          };
          const [firstName, ...rest] = value("name").split(/\s+/);
          save.mutate({
            id: row.id,
            expectedUpdatedAt: row.updatedAt,
            firstName: firstName!,
            lastName: rest.join(" "),
            alternativeNames: value("alternativeNames") || null,
            username: value("username"),
            email: value("email") || null,
            gradeLevel: value("grade") ? Number(value("grade")) : null,
            status: value("status") as typeof row.status,
          });
        }}
      >
        <p className="muted text-sm sm:col-span-2">
          {t(
            row.user
              ? "accountProfile.canonicalHelp"
              : "accountProfile.setupRequired",
          )}
        </p>
        {(
          [
            ["name", t("accountProfile.name"), row.englishName],
            [
              "alternativeNames",
              t("accountProfile.alternativeNames"),
              row.alternativeNames,
            ],
            ["username", t("admin.tutors.colUsername"), row.username],
            ["email", t("admin.tutors.colEmail"), row.user?.email ?? row.email],
            ["grade", t("admin.tutors.colGrade"), row.gradeLevel],
          ] as const
        ).map(([key, label, value]) => (
          <label key={key} className="block">
            <span className="label">{label}</span>
            <input
              className="input w-full"
              name={key}
              defaultValue={value ?? ""}
              required={key === "name"}
              type={
                key === "email" ? "email" : key === "grade" ? "number" : "text"
              }
              min={key === "grade" ? 6 : undefined}
              max={key === "grade" ? 12 : undefined}
              readOnly={key === "email" && !!row.user}
            />
            {key === "email" && row.user && (
              <span className="muted text-xs">
                {t("accountProfile.emailProtected")}
              </span>
            )}
          </label>
        ))}
        <label className="block">
          <span className="label">{t("admin.tutors.colStatus")}</span>
          <select
            className="select w-full"
            name="status"
            defaultValue={row.status}
          >
            {(
              [
                "ACTIVE",
                "PENDING",
                "GRADUATED",
                "OPTED_OUT",
                "ARCHIVED",
              ] as const
            ).map((status) => (
              <option key={status} value={status}>
                {t(`admin.tutorStatus.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-primary justify-self-start"
          disabled={save.isPending}
        >
          {t("accountProfile.save")}
        </button>
        {save.error && (
          <p role="alert" className="text-sm text-red-600 sm:col-span-2">
            {save.error.message}
          </p>
        )}
      </form>
    </ProfileDialog>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { AcademicPanel } from "./academic-profile";
import { AcademicError } from "./academic-error";
import {
  useProfilePolicy,
  ProfilePolicyHint,
  OfferedGradeSelect,
} from "./profile-policy";
import { useState } from "react";

/** One deliberate save avoids racing field-by-field corrections of the same person. */
export function TutorProfileEditor({
  row,
  onClose,
}: {
  row: RouterOutputs["admin"]["tutors"][number];
  onClose: () => void;
}) {
  const t = useTranslations();
  const [expectedUpdatedAt] = useState(row.updatedAt);
  const policy = useProfilePolicy();
  const [grade, setGrade] = useState(row.gradeLevel?.toString() ?? "");
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
            expectedUpdatedAt,
            firstName: firstName!,
            lastName: rest.join(" "),
            alternativeNames: value("alternativeNames") || null,
            email: value("email") || null,
            ...(row.user
              ? {}
              : { gradeLevel: value("grade") ? Number(value("grade")) : null }),
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
            ["email", t("admin.tutors.colEmail"), row.user?.email ?? row.email],
            ["grade", t("academics.legacyGrade"), row.gradeLevel],
          ] as const
        )
          .filter(([key]) => key !== "grade" || !row.user)
          .map(([key, label, value]) => (
            <label key={key} className="block">
              <span className="label">{label}</span>
              {key === "grade" ? (
                <OfferedGradeSelect
                  name="grade"
                  value={grade}
                  onChange={setGrade}
                  offeredGrades={policy.offeredGrades}
                  preserveLegacy
                />
              ) : (
                <input
                  className="input w-full"
                  name={key}
                  defaultValue={value ?? ""}
                  required={key === "name"}
                  type={key === "email" ? "email" : "text"}
                  readOnly={key === "email" && !!row.user}
                />
              )}

              {key === "email" && row.user && (
                <span className="muted text-xs">
                  {t("accountProfile.emailProtected")}
                </span>
              )}
            </label>
          ))}
        <div className="sm:col-span-2">
          <ProfilePolicyHint />
        </div>
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
            <AcademicError message={save.error.message} />
          </p>
        )}
      </form>
      {row.user && (
        <div className="mt-5">
          <AcademicPanel userId={row.user.id} />
        </div>
      )}
    </ProfileDialog>
  );
}

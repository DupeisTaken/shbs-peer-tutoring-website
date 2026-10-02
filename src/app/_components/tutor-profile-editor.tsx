"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, personNameEdit } from "~/lib/person-name";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { ProfileEditSection } from "./profile-edit-section";

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
import { useRef, useState, type ComponentProps } from "react";
import { useDialogPending } from "./ui/modal";
import { GRADUATED_GRADE } from "~/lib/academics";

/** One deliberate save avoids racing field-by-field corrections of the same person. */
export function TutorProfileEditor({
  row,
  onClose,
  isHead = false,
}: {
  row: RouterOutputs["admin"]["tutors"][number];
  onClose: () => void;
  isHead?: boolean;
}) {
  const t = useTranslations();
  return (
    <ProfileDialog title={t("accountProfile.editProfile")} onClose={onClose}>
      <TutorProfileForm row={row} isHead={isHead} />
    </ProfileDialog>
  );
}

/** Keep this independent form inside the dialog's pending context. */
function TutorProfileForm({
  row,
  isHead = false,
}: Omit<ComponentProps<typeof TutorProfileEditor>, "onClose">) {
  const t = useTranslations();
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const committed = useRef(false);
  const [expectedUpdatedAt] = useState(row.updatedAt);
  const [names, setNames] = useState(() => nameDraft(row));
  const [originalNames] = useState(() => nameDraft(row));
  const [legacyName] = useState(row.legacyName ?? row.englishName);
  const identity = personNameEdit(names, originalNames, legacyName);
  const policy = useProfilePolicy();
  const [grade, setGrade] = useState(
    row.academicallyGraduated
      ? GRADUATED_GRADE
      : (row.gradeLevel?.toString() ?? ""),
  );
  const utils = api.useUtils();
  const submitting = useRef(false);
  const save = api.admin.updateTutor.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      // Only deliberate Close dismisses independently editable sections and their outcomes.
      committed.current = true;
      setSaved(true);
      try {
        await settleRefreshes([
          () => invalidateAndReport(utils.admin.tutors),
          () => invalidateAndReport(utils.admin.tutees),
          () => invalidateAndReport(utils.admin.accounts),
        ]);
      } catch {
        setRefreshFailed(true);
      }
    },
  });
  const busy = useDialogPending(save.isPending);
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || submitting.current || committed.current) return;
          const data = new FormData(event.currentTarget);
          const value = (key: string) => {
            const field = data.get(key);
            return typeof field === "string" ? field.trim() : "";
          };

          submitting.current = true;
          save.mutate({
            id: row.id,
            expectedUpdatedAt,
            ...identity.fields,
            email: value("email") || null,
            // Unlinked handles still share the login namespace and Head-only authority.
            ...(!row.user &&
            isHead &&
            value("username") !== (row.username ?? "")
              ? { username: value("username") }
              : {}),
            ...(row.user
              ? {}
              : {
                  gradeLevel:
                    value("grade") && value("grade") !== GRADUATED_GRADE
                      ? Number(value("grade"))
                      : null,
                  academicallyGraduated: value("grade") === GRADUATED_GRADE,
                }),
            status: value("status") as typeof row.status,
          });
        }}
      >
        <ProfileEditSection
          busy={save.isPending}
          saved={saved}
          refreshFailed={refreshFailed}
          className="grid gap-4 sm:grid-cols-2"
        >
          <p className="muted text-sm sm:col-span-2">
            {t(
              row.user
                ? "accountProfile.canonicalHelp"
                : "tuteeHistory.noAccountHelp",
            )}
          </p>
          {!row.user && (
            <label className="block">
              <span className="label">{t("accountProfile.username")}</span>
              <input
                className="input w-full"
                name="username"
                defaultValue={row.username ?? ""}
                readOnly={!isHead}
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={64}
              />
            </label>
          )}
          <div className="sm:col-span-2">
            <PersonNameFields
              value={names}
              onChange={setNames}
              legacyName={legacyName}
              originalValue={originalNames}
            />
          </div>
          {(
            [
              [
                "email",
                t("admin.tutors.colEmail"),
                row.user?.email ?? row.email,
              ],
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
                    includeGraduated
                  />
                ) : (
                  <input
                    className="input w-full"
                    name={key}
                    defaultValue={value ?? ""}
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
            <ProfilePolicyHint field="legal" />
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
                  "TRANSFERRED",
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
        </ProfileEditSection>
      </form>
      {row.user && (
        <div className="mt-5">
          <AcademicPanel userId={row.user.id} />
        </div>
      )}
    </>
  );
}

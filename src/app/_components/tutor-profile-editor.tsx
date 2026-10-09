"use client";
import { useProfileReloadFocus } from "./use-profile-reload-focus";
import { ProfileEditSection } from "./profile-edit-section";
import { Button } from "./ui/button";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, personNameEdit } from "~/lib/person-name";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { invalidateAndReport } from "~/lib/invalidate-refresh";

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
import { isHistoricalTutor } from "~/lib/historical-academics";
import { TutorHistorySection } from "./tutor-history-link";

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
  row: initialRow,
  isHead = false,
}: Omit<ComponentProps<typeof TutorProfileEditor>, "onClose">) {
  const t = useTranslations();
  const [row, setRow] = useState(initialRow);
  // Independent editors keep their original lifetime and version ownership.
  const [siblingRow] = useState(initialRow);
  const [draftKey, setDraftKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reloadFocus = useProfileReloadFocus(formRef, reloading);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const reloadPending = useRef(false);
  const [saved, setSaved] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const committed = useRef(false);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(row.updatedAt);
  const [names, setNames] = useState(() => nameDraft(row));
  const [originalNames, setOriginalNames] = useState(() => nameDraft(row));
  const [legacyName, setLegacyName] = useState(
    row.legacyName ?? row.englishName,
  );
  const identity = personNameEdit(names, originalNames, legacyName);
  const policy = useProfilePolicy();
  const [grade, setGrade] = useState(
    row.academicallyGraduated
      ? GRADUATED_GRADE
      : (row.gradeLevel?.toString() ?? ""),
  );
  const utils = api.useUtils();
  // Guard the interval before mutation state renders, so one request owns this draft.
  const submitting = useRef(false);
  /** A committed write is never replayed: recovery reads and replaces only this form. */
  const refreshProfile = async () => {
    reloadPending.current = true;
    setReloading(true);
    setReloadError(null);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.admin.tutors),
        () => invalidateAndReport(utils.admin.tutees),
        () => invalidateAndReport(utils.admin.accounts),
      ]);
      // Account mirrors may advance the fence after the initial roster write.
      const rows = await utils.admin.tutors.fetch(undefined, { staleTime: 0 });
      const latest = rows.find((item) => item.id === row.id);
      if (!latest) throw new Error(t("uiPatterns.loadFailed"));
      setRow(latest);
      setExpectedUpdatedAt(latest.updatedAt);
      setNames(nameDraft(latest));
      setOriginalNames(nameDraft(latest));
      setLegacyName(latest.legacyName ?? latest.englishName);
      setGrade(
        latest.academicallyGraduated
          ? GRADUATED_GRADE
          : (latest.gradeLevel?.toString() ?? ""),
      );
      // Only primary uncontrolled fields remount; sibling drafts retain their lifetime.
      setDraftKey((key) => key + 1);
      setRefreshFailed(false);
      setNeedsRefresh(false);
      committed.current = false;
      return true;
    } catch (error) {
      setRefreshFailed(true);
      setReloadError(
        error instanceof Error ? error.message : t("uiPatterns.loadFailed"),
      );
      return false;
    } finally {
      reloadPending.current = false;
      setReloading(false);
    }
  };
  const save = api.admin.updateTutor.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      // Preserve sibling outcomes; only deliberate Close dismisses the editor.
      committed.current = true;
      setSaved(true);
      setNeedsRefresh(true);
      await refreshProfile();
    },
  });
  const busy = useDialogPending(save.isPending);
  return (
    <>
      <form
        ref={formRef}
        key={draftKey}
        onChangeCapture={() => {
          if (!committed.current) setSaved(false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            busy ||
            submitting.current ||
            committed.current ||
            reloadPending.current
          )
            return;
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
            ...(row.user || row.historicalGrade
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
          title={t("uiPatterns.profile")}
          busy={save.isPending || reloading}
          saved={saved}
          refreshFailed={refreshFailed}
          readOnly={needsRefresh}
          refreshBusy={reloading}
          refreshError={reloadError}
          onRefresh={() => {
            if (busy || submitting.current || reloadPending.current) return;
            reloadFocus.beginReload();
            void refreshProfile().then((refreshed) => {
              reloadFocus.finishReload(refreshed);
              if (refreshed) save.reset();
            });
          }}
          className="grid gap-4 sm:grid-cols-2"
          actions={
            <Button
              type="submit"
              variant="primary"
              disabled={busy || reloading || needsRefresh}
            >
              {t("accountProfile.save")}
            </Button>
          }
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
            .filter(
              ([key]) => key !== "grade" || (!row.user && !row.historicalGrade),
            )
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
          {save.error && (
            <p role="alert" className="text-sm text-red-600 sm:col-span-2">
              <AcademicError message={save.error.message} />
            </p>
          )}
        </ProfileEditSection>
      </form>
      {siblingRow.user && (
        <div className="mt-5">
          <AcademicPanel userId={siblingRow.user.id} />
        </div>
      )}
      {siblingRow.historicalGrade && (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          {t("historicalAcademics.HISTORICAL_EDITOR_REQUIRED")}
        </p>
      )}
      {isHistoricalTutor(siblingRow) && (
        <TutorHistorySection tutorId={siblingRow.id} />
      )}
    </>
  );
}

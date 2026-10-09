"use client";
import { useProfileReloadFocus } from "./use-profile-reload-focus";
import { ProfileEditSection } from "./profile-edit-section";
import { StatePanel } from "./ui/patterns";
import { Button } from "./ui/button";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, personNameEdit } from "~/lib/person-name";

import { useTranslations } from "next-intl";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { api, type RouterOutputs } from "~/trpc/react";
import { AcademicPanel } from "./academic-profile";
import { InlineNotice } from "./ui/patterns";
import { AcademicError } from "./academic-error";
import {
  useProfilePolicy,
  ProfilePolicyHint,
  OfferedGradeSelect,
} from "./profile-policy";
import { useRef, useState, type ComponentProps } from "react";
import { useDialogPending } from "./ui/modal";
import { TuteeHistoryLinkForm } from "./tutee-history";
import { invalidateTuteeViews } from "~/lib/tutee-cache";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { GRADUATED_GRADE } from "~/lib/academics";

/** Profile correction stays separate from assignment/removal, while the version protects both. */
export function TuteeEditor({
  row,
  onClose,
  canApply = true,
  historyPermissions,
}: {
  row: RouterOutputs["admin"]["tutees"][number];
  onClose: () => void;
  canApply?: boolean;
  historyPermissions?: { canLink: boolean; isHead: boolean };
}) {
  const profileText = useTranslations("accountProfile");
  return (
    <ProfileDialog title={profileText("editProfile")} onClose={onClose}>
      <TuteeProfileForm row={row} historyPermissions={historyPermissions} canApply={canApply} />
    </ProfileDialog>
  );
}

/** Keep this independent form inside the dialog's pending context. */
function TuteeProfileForm({
  row: initialRow,
  canApply = true,
  historyPermissions,
}: Omit<ComponentProps<typeof TuteeEditor>, "onClose">) {
  const [row, setRow] = useState(initialRow);
  // Profile refresh must not remount independent academic or historical drafts.
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
  const common = useTranslations();
  const t = useTranslations("profileCorrection");
  const history = useTranslations("tuteeHistory");
  const profileText = useTranslations("accountProfile");
  const academicText = useTranslations("academics");
  const correctionText = useTranslations("historicalAcademics");
  const historicalGrade =
    row.historicalGrade || row.historical || !!row.enrollmentCorrection;
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(row.updatedAt);
  // Keep explicit name drafts mounted while historical linking refreshes roster data.
  const historySection = useRef<HTMLDetailsElement>(null);
  const [historyLinked, setHistoryLinked] = useState(false);
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
  const subjects = api.admin.subjects.useQuery();
  const slots = api.admin.timeSlots.useQuery();
  // Guard the interval before mutation state renders, so one request owns this draft.
  const submitting = useRef(false);
  /** Recover committed saves with reads only, preserving independent sibling drafts. */
  const refreshProfile = async () => {
    reloadPending.current = true;
    setReloading(true);
    setReloadError(null);
    try {
      await settleRefreshes([
        async () => {
          await invalidateTuteeViews(utils, { reportErrors: true });
        },
        () => invalidateAndReport(utils.admin.tutors),
      ]);
      // Adopt the final authorized roster fence, including linked-account mirrors.
      const rows = await utils.admin.tutees.fetch(undefined, { staleTime: 0 });
      const latest = rows.find((item) => item.id === row.id);
      if (!latest) throw new Error(common("uiPatterns.loadFailed"));
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
      // Reset only this form's uncontrolled contacts, choices and availability.
      setDraftKey((key) => key + 1);
      setRefreshFailed(false);
      setNeedsRefresh(false);
      committed.current = false;
      return true;
    } catch (error) {
      setRefreshFailed(true);
      setReloadError(
        error instanceof Error
          ? error.message
          : common("uiPatterns.loadFailed"),
      );
      return false;
    } finally {
      reloadPending.current = false;
      setReloading(false);
    }
  };
  const save = api.admin.updateTutee.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      // A completed profile must not discard an independent academic/link error or draft.
      committed.current = true;
      setSaved(true);
      setNeedsRefresh(true);
      await refreshProfile();
    },
  });
  const busy = useDialogPending(save.isPending);
  return (
    <>
      <p className="muted text-sm">
        {row.user ? profileText("canonicalHelp") : history("noAccountHelp")}
      </p>
      {/* Cached dependencies keep the mounted draft intact during retries. */}
      {(Boolean(subjects.error) || Boolean(slots.error)) && (
        <StatePanel
          kind="error"
          title={common("uiPatterns.loadFailed")}
          action={
            <Button
              size="compact"
              disabled={subjects.isFetching || slots.isFetching}
              onClick={() =>
                void Promise.all([subjects.refetch(), slots.refetch()])
              }
            >
              {common("uiPatterns.retry")}
            </Button>
          }
        />
      )}
      {(!subjects.data || !slots.data) && !subjects.error && !slots.error && (
        <StatePanel kind="loading" title={common("common.loading")} />
      )}
      {subjects.data && slots.data && (
        <form
          ref={formRef}
          key={draftKey}
          className="mt-3 max-w-3xl"
          onChangeCapture={() => {
            if (!committed.current) setSaved(false);
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (
              busy ||
              submitting.current ||
              committed.current ||
              reloadPending.current ||
              subjects.isLoading ||
              slots.isLoading
            )
              return;
            const data = new FormData(e.currentTarget);
            const value = (key: string) =>
              (typeof data.get(key) === "string"
                ? (data.get(key) as string)
                : ""
              ).trim() || null;
            submitting.current = true;
            save.mutate({
              id: row.id,
              expectedUpdatedAt,
              ...identity.fields,
              englishName: identity.name,
              status: row.status,
              email: value("email"),
              phone: value("phone"),
              preferredContact: value("preferredContact"),
              ...(row.user || historicalGrade
                ? {}
                : {
                    gradeLevel:
                      value("grade") === GRADUATED_GRADE
                        ? null
                        : value("grade"),
                    academicallyGraduated: value("grade") === GRADUATED_GRADE,
                  }),
              notes: value("notes"),
              firstChoiceId: value("firstChoice"),
              secondChoiceId: value("secondChoice"),
              slotIds: data.getAll("slot").map(String),
            });
          }}
        >
          <ProfileEditSection
            title={common("uiPatterns.profile")}
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
                disabled={
                  busy ||
                  reloading ||
                  needsRefresh ||
                  subjects.isLoading ||
                  slots.isLoading
                }
              >
                {canApply ? t("save") : common("approvals.requestHead")}
              </Button>
            }
          >
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
                ["grade", academicText("legacyGrade"), row.gradeLevel],
                ["email", t("email"), row.user?.email ?? row.email],
                ["phone", t("phone"), row.phone],
                ["preferredContact", t("contact"), row.preferredContact],
              ] as const
            )
              .filter(
                ([name]) => name !== "grade" || (!row.user && !historicalGrade),
              )
              .map(([name, label, value]) => (
                <label key={name} className="block">
                  <span className="label">{label}</span>
                  {name === "grade" ? (
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
                      name={name}
                      defaultValue={value ?? ""}
                      type={name === "email" ? "email" : "text"}
                      readOnly={name === "email" && !!row.user}
                    />
                  )}

                  {name === "email" && row.user && (
                    <span className="muted text-xs">
                      {profileText("emailProtected")}
                    </span>
                  )}
                </label>
              ))}
            <div className="sm:col-span-2">
              {!row.historical && (
                <>
                  <ProfilePolicyHint />
                  <ProfilePolicyHint field="legal" />
                </>
              )}
            </div>
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
            {save.error?.data?.approvalId && <InlineNotice tone="warning" announcement="status">{common("approvals.queuedBody")}</InlineNotice>}
          {save.error && !save.error.data?.approvalId && (
              <p role="alert" className="text-sm text-red-600">
                <AcademicError message={save.error.message} />
              </p>
            )}
          </ProfileEditSection>
        </form>
      )}
      {siblingRow.user && (
        <div className="mt-5">
          <AcademicPanel userId={siblingRow.user.id} canApply={canApply} />
        </div>
      )}
      {historicalGrade && (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          {correctionText("HISTORICAL_EDITOR_REQUIRED")}
        </p>
      )}
      {siblingRow.historical && historyPermissions?.canLink && (
        <section className="mt-5 border-t border-slate-200 pt-4">
          {/* Separate forms preserve unsaved profile edits and avoid nested dialogs/forms. */}
          <details ref={historySection}>
            <summary className="link flex min-h-11 cursor-pointer items-center text-sm font-medium lg:min-h-8">
              {history("linkTitle")}
            </summary>
            <div className="pt-4">
              <TuteeHistoryLinkForm
                row={siblingRow}
                isHead={historyPermissions.isHead}
                onLinked={() => {
                  setHistoryLinked(true);
                  if (historySection.current) {
                    historySection.current.open = false;
                    historySection.current.querySelector("summary")?.focus();
                  }
                }}
              />
            </div>
          </details>
          {historyLinked && (
            <p role="status" className="mt-2 text-sm text-green-800">
              {history("linkSaved")}
            </p>
          )}
        </section>
      )}
    </>
  );
}

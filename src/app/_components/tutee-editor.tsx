"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft, personNameEdit } from "~/lib/person-name";

import { useTranslations } from "next-intl";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { api, type RouterOutputs } from "~/trpc/react";
import { AcademicPanel } from "./academic-profile";
import { AcademicError } from "./academic-error";
import {
  useProfilePolicy,
  ProfilePolicyHint,
  OfferedGradeSelect,
} from "./profile-policy";
import { useRef, useState } from "react";
import { TuteeHistoryLinkForm } from "./tutee-history";
import { invalidateTuteeViews } from "~/lib/tutee-cache";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { GRADUATED_GRADE } from "~/lib/academics";
import { useDialogPending } from "./ui/modal";

type TuteeEditorProps = {
  row: RouterOutputs["admin"]["tutees"][number];
  onClose: () => void;
  historyPermissions?: { canLink: boolean; isHead: boolean };
};

/** Mount every independently versioned form inside the same pending-work context. */
export function TuteeEditor(props: TuteeEditorProps) {
  const profileText = useTranslations("accountProfile");
  return (
    <ProfileDialog title={profileText("editProfile")} onClose={props.onClose}>
      <TuteeEditorContents
        row={props.row}
        historyPermissions={props.historyPermissions}
      />
    </ProfileDialog>
  );
}

/** Profile correction stays separate from assignment/removal, while the version protects both. */
function TuteeEditorContents({
  row,
  historyPermissions,
}: Omit<TuteeEditorProps, "onClose">) {
  const t = useTranslations("profileCorrection");
  const history = useTranslations("tuteeHistory");
  const profileText = useTranslations("accountProfile");
  const academicText = useTranslations("academics");
  const [expectedUpdatedAt] = useState(row.updatedAt);
  // Keep explicit name drafts mounted while historical linking refreshes roster data.
  const historySection = useRef<HTMLDetailsElement>(null);
  const [historyLinked, setHistoryLinked] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const committed = useRef(false);
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
  const subjects = api.admin.subjects.useQuery();
  const slots = api.admin.timeSlots.useQuery();
  // Own the draft immediately, before mutation state can render a second submit.
  const submitting = useRef(false);
  const save = api.admin.updateTutee.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      // A successful profile write must not discard an independent failed draft.
      // Freeze this committed section even if refreshing its views later fails.
      committed.current = true;
      setSaved(true);
      try {
        await settleRefreshes([
          async () => {
            await invalidateTuteeViews(utils, { throwOnError: true });
          },
          () =>
            utils.admin.tutors.invalidate(undefined, undefined, {
              throwOnError: true,
            }),
        ]);
      } catch {
        setRefreshFailed(true);
      }
    },
  });
  // Register owned work only; the returned state also guards against academic
  // writes in this dialog, without feeding sibling work back into the registry.
  const pending = useDialogPending(save.isPending || historyPending);
  // Only deliberate Close dismisses the editor. Idle alone says nothing about
  // whether another section failed and still needs its mounted draft/error.
  return (
    <>
      <p className="muted text-sm">
        {row.user ? profileText("canonicalHelp") : history("noAccountHelp")}
      </p>
      {subjects.data && slots.data && (
        <form
          className="mt-3 max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              pending ||
              submitting.current ||
              committed.current ||
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
              ...(row.user
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
          <fieldset
            disabled={pending || saved}
            aria-busy={pending}
            className="grid min-w-0 gap-4 sm:grid-cols-2"
          >
            <legend className="sr-only">{profileText("editProfile")}</legend>
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
              .filter(([name]) => name !== "grade" || !row.user)
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
            <button
              className="btn-primary self-end justify-self-start"
              disabled={
                pending || saved || subjects.isLoading || slots.isLoading
              }
            >
              {t("save")}
            </button>
            {save.error && (
              <p role="alert" className="text-sm text-red-600">
                <AcademicError message={save.error.message} />
              </p>
            )}
          </fieldset>
          {saved && (
            <p role="status" className="mt-3 text-sm text-green-800">
              {profileText("sectionSaved")}
            </p>
          )}
          {refreshFailed && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {profileText("sectionRefreshFailed")}
            </p>
          )}
        </form>
      )}
      {row.user && (
        <div className="mt-5">
          <AcademicPanel userId={row.user.id} />
        </div>
      )}
      {row.historical && historyPermissions?.canLink && (
        <section className="mt-5 border-t border-slate-200 pt-4">
          {/* Separate forms preserve unsaved profile edits and avoid nested dialogs/forms. */}
          <details ref={historySection}>
            <summary className="link flex min-h-11 cursor-pointer items-center text-sm font-medium lg:min-h-8">
              {history("linkTitle")}
            </summary>
            <div className="pt-4">
              <TuteeHistoryLinkForm
                row={row}
                isHead={historyPermissions.isHead}
                onPendingChange={setHistoryPending}
                parentPending={save.isPending}
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

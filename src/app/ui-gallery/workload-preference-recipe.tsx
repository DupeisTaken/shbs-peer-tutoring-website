"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { WorkloadPreferenceChoices } from "~/app/_components/workload-preference-choices";
import { Button, ChoiceButton } from "~/app/_components/ui/button";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { FormActions, FormSection } from "~/app/_components/ui/patterns";
import { assignedBlocks, workloadWarning } from "~/lib/tutor-workload";
import { formatWeekday } from "~/lib/time";

/** Synthetic-only composition uses the production entrance-card -> retained-draft
 * ProfileDialog pattern (matching TimeAvailability / SubjectWillingness /
 * QualificationRequests) and shared workload/warning controls without API access. */
export function WorkloadPreferenceRecipe() {
  const t = useTranslations("tutorWorkload");
  const labels = useTranslations();
  const locale = useLocale();
  const [editorOpen, setEditorOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  // Draft states live above the dialog toggle so closing and reopening preserves
  // independent unsaved edits, mirroring TimeAvailability's retained forms.
  const [available, setAvailable] = useState(false);
  const [savedAvailability, setSavedAvailability] = useState(false);
  const [draft, setDraft] = useState<number | null>(1);
  const [reviewing, setReviewing] = useState(false);
  const [saved, setSaved] = useState<number | null>(1);

  useEffect(() => {
    if (!editorOpen && restoreFocus.current) {
      triggerRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [editorOpen]);

  const closeEditor = () => {
    restoreFocus.current = true;
    setEditorOpen(false);
  };

  const count = assignedBlocks(
    ["subject-a", "subject-b"].map((id) => ({
      id,
      tutorId: "synthetic",
      termId: "quarter",
      // Only explicit group membership combines these synthetic subject rows.
      groupId: "synthetic-teaching-group",
      scheduleConfirmed: true,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    })),
  ).length;
  const warning = workloadWarning(count, count + 1, saved);

  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="section-title">{t("title")}</h3>
          <p className="muted max-w-xl text-sm leading-relaxed">
            {t("staffHelp")}
          </p>
          <p className="text-sm">
            {t("current", { count })} ·{" "}
            {saved === null
              ? t("unset")
              : t("savedPreference", { count: saved })}
          </p>
          <code className="block text-xs break-words text-slate-500">
            Entrance card · ProfileDialog (retained drafts) · ChoiceButton ·
            WorkloadPreferenceChoices
          </code>
        </div>
        <button
          ref={triggerRef}
          type="button"
          className="btn-secondary min-h-11 shrink-0 gap-3 whitespace-normal lg:min-h-10"
          onClick={() => setEditorOpen(true)}
        >
          {labels("dashboard.availability.edit")}
          <span aria-hidden="true">↗</span>
        </button>
      </div>

      {editorOpen && (
        <ProfileDialog
          title={labels("dashboard.availability.title")}
          size="wide"
          onClose={closeEditor}
        >
          <div className="space-y-5">
            <div
              role="group"
              aria-label={labels("dashboard.availability.title")}
              className="space-y-3"
            >
              <p className="text-xs font-semibold text-slate-600">
                {formatWeekday(1, locale)}
              </p>
              <ChoiceButton
                selected={available}
                onClick={() => setAvailable(!available)}
              >
                15:00–16:00
              </ChoiceButton>
              <FormActions>
                <Button onClick={() => setSavedAvailability(available)}>
                  {labels("tutor.availability.save")}
                </Button>
                <Button onClick={() => setAvailable(savedAvailability)}>
                  {labels("uiPatterns.cancel")}
                </Button>
              </FormActions>
            </div>
            <div className="border-t border-slate-200 pt-5">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setSaved(draft);
                }}
              >
                <FormSection
                  title={t("editPreference")}
                  actions={
                    <>
                      <Button type="submit" variant="primary">
                        {t("save")}
                      </Button>
                      <Button onClick={() => setDraft(saved)}>
                        {t("cancel")}
                      </Button>
                    </>
                  }
                >
                  <WorkloadPreferenceChoices
                    value={draft}
                    onChange={setDraft}
                  />
                </FormSection>
              </form>
            </div>
          </div>
        </ProfileDialog>
      )}

      <div className="border-t border-slate-100 pt-3">
        <Button onClick={() => setReviewing(Boolean(warning))}>
          {t("reviewAssignment")}
        </Button>
      </div>
      {reviewing && warning && (
        <ProfileDialog
          title={t("confirmTitle")}
          onClose={() => setReviewing(false)}
        >
          <p>
            {t("proposedOver", { count, proposed: count + 1, maximum: saved! })}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => setReviewing(false)}>{t("cancel")}</Button>
            <Button variant="primary" onClick={() => setReviewing(false)}>
              {t("continue")}
            </Button>
          </div>
        </ProfileDialog>
      )}
    </section>
  );
}

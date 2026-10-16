"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { Button } from "~/app/_components/ui/button";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { FormSection } from "~/app/_components/ui/patterns";
import { assignedBlocks, workloadWarning } from "~/lib/tutor-workload";

/** Synthetic-only composition uses the production block identity and shared
 * field/form/notice patterns; it never mounts a private query or mutation. */
export function WorkloadPreferenceRecipe() {
  const t = useTranslations("tutorWorkload");
  const [draft, setDraft] = useState<number | null>(1);
  const [reviewing, setReviewing] = useState(false);
  const [saved, setSaved] = useState<number | null>(1);
  const count = assignedBlocks(
    ["subject-a", "subject-b"].map((id) => ({
      id,
      tutorId: "synthetic",
      termId: "quarter",
      scheduleConfirmed: true,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    })),
  ).length;
  const warning = workloadWarning(count, count + 1, saved);
  return (
    <section className="card space-y-4 p-5">
      <h3 className="section-title">{t("title")}</h3>
      <p className="muted text-sm">{t("staffHelp")}</p>
      <p className="text-sm">
        {t("current", { count })} ·{" "}
        {saved === null ? t("unset") : t("savedPreference", { count: saved })}
      </p>
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
              <Button onClick={() => setDraft(saved)}>{t("cancel")}</Button>
            </>
          }
        >
          <label className="block text-sm">
            <span className="label">
              {t("preference")}
              <FieldRequirement state="optional" />
            </span>
            <select
              className="select min-h-11 w-full lg:min-h-10"
              value={draft ?? ""}
              onChange={(event) =>
                setDraft(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
            >
              <option value="">{t("unset")}</option>
              {[0, 1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </FormSection>
      </form>
      <Button onClick={() => setReviewing(Boolean(warning))}>
        {t("reviewAssignment")}
      </Button>
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

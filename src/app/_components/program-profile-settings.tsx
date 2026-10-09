"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ALL_GRADES, type ProfilePolicy } from "~/lib/profile-policy";
import { ProfilePolicyError } from "./profile-policy";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";

export function ProgramProfileSettings() {
  const t = useTranslations("profilePolicy");
  const query = api.program.profilePolicySettings.useQuery();
  const [generation, setGeneration] = useState(0);
  const loadError = query.error ? (
    <StatePanel
      kind="error"
      title={t("loadFailed")}
      action={
        <Button
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("retry")}
        </Button>
      }
    >
      <ProfilePolicyError message={query.error.message} />
    </StatePanel>
  ) : null;
  if (!query.data)
    return (
      <section className="card space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="section-title">{t("title")}</h2>
          <p className="muted mt-1 text-sm">{t("help")}</p>
        </div>
        {loadError ?? <StatePanel kind="loading" title={t("loading")} />}
      </section>
    );
  return (
    <div className="space-y-4">
      {loadError}
      {/* Cached-query failures must not unmount the editor or discard its draft.
          Only an explicit, successful conflict reload replaces its snapshot. */}
      <ProfilePolicyEditor
        key={generation}
        policy={query.data}
        canEdit={query.data.canEdit}
        canApply={query.data.canApply}
        onReload={async () => {
          const result = await query.refetch();
          if (result.isSuccess) setGeneration((value) => value + 1);
        }}
      />
    </div>
  );
}

/** Freeze the original policy while editing; refetches never authorize a stale draft. */
export function ProfilePolicyEditor({
  policy,
  canEdit,
  canApply = true,
  onReload,
}: {
  policy: ProfilePolicy;
  canEdit: boolean;
  canApply?: boolean;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations("profilePolicy");
  const approvals = useTranslations("approvals");
  const utils = api.useUtils();
  const router = useRouter();
  const [expectedPolicy, setExpectedPolicy] = useState<ProfilePolicy>(() => ({
    requireLatinNames: true,
    requireLatinLegalNames: false,
    usePreferredNames: policy.usePreferredNames,
    showAlternateNames: policy.showAlternateNames,
    offeredGrades: [...policy.offeredGrades],
  }));
  const [usePreferredNames, setUsePreferredNames] = useState(
    policy.usePreferredNames,
  );
  const [offeredGrades, setOfferedGrades] = useState(policy.offeredGrades);
  const [showAlternateNames, setShowAlternateNames] = useState(
    policy.showAlternateNames,
  );
  const [saved, setSaved] = useState(false);
  const save = api.program.setProfilePolicy.useMutation({
    onSuccess: async (result) => {
      setExpectedPolicy(result);
      setSaved(true);
      // Display settings affect every current roster and profile query.
      await utils.invalidate();
      router.refresh();
    },
  });
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      {canEdit && !canApply && <p className="muted text-sm">{approvals("sensitiveHelp")}</p>}
      {!canEdit && <p className="muted text-sm">{t("readOnly")}</p>}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canEdit && offeredGrades.length && !save.isPending)
            save.mutate({
              requireLatinNames: true,
              requireLatinLegalNames: false,
              usePreferredNames,
              showAlternateNames,
              offeredGrades,
              expectedPolicy,
            });
        }}
      >
        <fieldset
          disabled={!canEdit || save.isPending}
          className="min-w-0 space-y-4"
        >
          <legend className="sr-only">{t("title")}</legend>
          <div>
            <label className="flex min-h-11 items-center gap-3 lg:min-h-10">
              <input
                type="checkbox"
                checked={usePreferredNames}
                onChange={(event) => {
                  setUsePreferredNames(event.target.checked);
                  setSaved(false);
                }}
              />
              <span className="font-medium">{t("usePreferredNames")}</span>
            </label>
            <p className="muted text-sm">{t("preferredDisplayHint")}</p>
          </div>
          <div>
            <label className="flex min-h-11 items-center gap-3 lg:min-h-10">
              <input
                type="checkbox"
                checked={showAlternateNames}
                onChange={(event) => {
                  setShowAlternateNames(event.target.checked);
                  setSaved(false);
                }}
              />
              <span className="font-medium">{t("showAlternateNames")}</span>
            </label>
            <p className="muted text-sm">{t("alternateDisplayHint")}</p>
          </div>
          <div
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            aria-live="polite"
          >
            <p className="muted text-xs font-medium">{t("displayPreview")}</p>
            <p className="mt-1 font-semibold text-slate-900">
              {usePreferredNames ? "Alex Chen" : "Alexander Chen"}
              {showAlternateNames ? " · 陈晓明" : ""}
            </p>
          </div>
          <p className="muted text-sm">{t("latinRule")}</p>
          <p className="muted text-sm">{t("existingNames")}</p>
          <fieldset>
            <legend className="label">{t("offeredGrades")}</legend>
            <p className="muted mb-2 text-sm">{t("gradesHelp")}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {ALL_GRADES.map((grade) => (
                <label
                  key={grade}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 lg:min-h-10"
                >
                  <input
                    type="checkbox"
                    checked={offeredGrades.includes(grade)}
                    onChange={(event) => {
                      setOfferedGrades((values) =>
                        event.target.checked
                          ? [...values, grade].sort((a, b) => a - b)
                          : values.filter((value) => value !== grade),
                      );
                      setSaved(false);
                    }}
                  />
                  <span>{t("grade", { grade })}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {!offeredGrades.length && (
            <p role="alert" className="text-sm text-red-700">
              {t("atLeastOne")}
            </p>
          )}
          {canEdit && (
            <button
              className="btn-primary min-h-11 lg:min-h-10"
              disabled={!offeredGrades.length}
            >
              {save.isPending ? t("saving") : canApply ? t("save") : approvals("requestHead")}
            </button>
          )}
        </fieldset>
        {save.error?.data?.approvalId && <InlineNotice tone="warning" announcement="status">{approvals("queuedBody")}</InlineNotice>}
        {save.error && !save.error.data?.approvalId && (
          <p role="alert" className="text-sm text-red-700">
            <ProfilePolicyError message={save.error.message} />
          </p>
        )}
        {save.error?.data?.code === "CONFLICT" && (
          <button
            type="button"
            className="btn-secondary min-h-11 lg:min-h-10"
            onClick={() => void onReload()}
          >
            {t("reload")}
          </button>
        )}
        {saved && (
          <p role="status" className="text-sm text-green-700">
            {t("saved")}
          </p>
        )}
      </form>
    </section>
  );
}

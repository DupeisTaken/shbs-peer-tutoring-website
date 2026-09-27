"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ALL_GRADES, type ProfilePolicy } from "~/lib/profile-policy";
import { ProfilePolicyError } from "./profile-policy";

export function ProgramProfileSettings() {
  const t = useTranslations("profilePolicy");
  const query = api.program.profilePolicySettings.useQuery();
  const [generation, setGeneration] = useState(0);
  if (query.error)
    return (
      <p role="alert">
        <ProfilePolicyError message={query.error.message} />
      </p>
    );
  if (!query.data)
    return (
      <p role="status" className="muted">
        {t("loading")}
      </p>
    );
  return (
    <ProfilePolicyEditor
      key={generation}
      policy={query.data}
      canEdit={query.data.canEdit}
      onReload={async () => {
        const result = await query.refetch();
        if (result.data) setGeneration((value) => value + 1);
      }}
    />
  );
}

/** Freeze the original policy while editing; refetches never authorize a stale draft. */
export function ProfilePolicyEditor({
  policy,
  canEdit,
  onReload,
}: {
  policy: ProfilePolicy;
  canEdit: boolean;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations("profilePolicy");
  const utils = api.useUtils();
  const [expectedPolicy, setExpectedPolicy] = useState<ProfilePolicy>(() => ({
    requireLatinNames: policy.requireLatinNames,
    offeredGrades: [...policy.offeredGrades],
  }));
  const [requireLatinNames, setRequireLatinNames] = useState(
    policy.requireLatinNames,
  );
  const [offeredGrades, setOfferedGrades] = useState(policy.offeredGrades);
  const [saved, setSaved] = useState(false);
  const save = api.program.setProfilePolicy.useMutation({
    onSuccess: async (result) => {
      setExpectedPolicy(result);
      setSaved(true);
      await Promise.all([
        utils.program.profilePolicy.invalidate(),
        utils.program.profilePolicySettings.invalidate(),
      ]);
    },
  });
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      {!canEdit && <p className="muted text-sm">{t("readOnly")}</p>}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canEdit && offeredGrades.length && !save.isPending)
            save.mutate({ requireLatinNames, offeredGrades, expectedPolicy });
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
                checked={requireLatinNames}
                onChange={(event) => {
                  setRequireLatinNames(event.target.checked);
                  setSaved(false);
                }}
              />
              <span className="font-medium">{t("requireLatinNames")}</span>
            </label>
            <p className="muted text-sm">{t("nameHint")}</p>
            <p className="muted mt-1 text-sm">{t("existingNames")}</p>
          </div>
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
              {t(save.isPending ? "saving" : "save")}
            </button>
          )}
        </fieldset>
        {save.error && (
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

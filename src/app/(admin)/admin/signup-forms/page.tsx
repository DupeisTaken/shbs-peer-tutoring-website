"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FieldDialog } from "~/app/_components/signup-field-dialog";
import { api } from "~/trpc/react";
import { InlineNotice } from "~/app/_components/ui/patterns";
import {
  SIGNUP_FIELDS,
  type SignupFormKind,
  type FieldState,
} from "~/lib/signup-fields";

export default function SignupFormsPage() {
  const t = useTranslations("signupFields");
  const approvals = useTranslations("approvals");
  const query = api.program.signupFieldSettings.useQuery();
  const utils = api.useUtils();
  const [form, setForm] = useState<SignupFormKind>("tutee");
  const [edit, setEdit] = useState<{ field: string; state: FieldState } | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const [editGeneration, setEditGeneration] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const save = api.program.setSignupField.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.program.signupFieldSettings.invalidate(),
        utils.tutee.signupOptions.invalidate(),
        utils.application.options.invalidate(),
      ]);
      setEdit(null);
      setSaved(true);
    },
  });
  if (query.isLoading) return <p role="status">{t("loading")}</p>;
  if (!query.data)
    return (
      <div className="card space-y-3 p-5">
        <p role="alert">{query.error?.message ?? t("loadFailed")}</p>
        <button
          className="btn-secondary min-h-11 lg:min-h-10"
          onClick={() => void query.refetch()}
        >
          {t("reload")}
        </button>
      </div>
    );
  const { fields, canEdit, secondaryEmailBindingEnabled } = query.data;
  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-2">{t("help")}</p>
      </header>
      {/* Retain cached settings and the dialog draft beside background recovery. */}
      {query.error && <InlineNotice tone="error" announcement="alert" action={<button type="button" className="btn-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("reload")}</button>}>{query.error.message}</InlineNotice>}
      <div className="card border-l-accent-500 space-y-2 border-l-4 p-5">
        <p className="text-sm font-medium">{t("lockedHelp")}</p>
        <p className="muted text-sm">{t("conditionalHelp")}</p>
        <p className="muted text-sm">
          {t(secondaryEmailBindingEnabled ? "emailEnabled" : "emailDisabled")}
        </p>
      </div>
      {canEdit && query.data.canApply === false && <p className="muted text-sm">{approvals("sensitiveHelp")}</p>}
      {!canEdit && (
        <p role="status" className="muted">
          {t("readOnly")}
        </p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("form")}>
        {(["tutee", "tutor"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={form === kind}
            className={`${form === kind ? "btn-primary" : "btn-secondary"} min-h-11 lg:min-h-10`}
            onClick={() => {
              setForm(kind);
              setSaved(false);
            }}
          >
            {t(kind)}
          </button>
        ))}
      </div>
      <section className="card overflow-hidden" aria-label={t(form)}>
        <ol className="divide-y divide-slate-200">
          {SIGNUP_FIELDS[form].map((field) => (
            <li
              key={field.key}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{t(`labels.${field.label}`)}</p>
                <p className="muted mt-1 text-sm">
                  {t(field.locked ? "locked" : fields[form][field.key]!)}
                </p>
              </div>
              {!field.locked && canEdit && (
                <button
                  type="button"
                  className="btn-secondary min-h-11 lg:min-h-8 lg:py-0"
                  aria-label={t("configureField", {
                    field: t(`labels.${field.label}`),
                  })}
                  onClick={() => {
                    save.reset();
                    setReloadError(null);
                    setSaved(false);
                    setEdit({
                      field: field.key,
                      state: fields[form][field.key]!,
                    });
                  }}
                >
                  {t("configure")}
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>
      {saved && <p role="status">{t("saved")}</p>}
      {edit && (
        <FieldDialog
          key={editGeneration}
          label={t(`labels.${edit.field}`)}
          initial={edit.state}
          pending={save.isPending || reloading}
          error={reloadError ?? (save.error?.data?.approvalId ? undefined : save.error?.message)}
          approvalId={save.error?.data?.approvalId ?? undefined}
          canApply={query.data.canApply}
          onClose={() => setEdit(null)}
          onReload={async () => {
            if (save.isPending || reloading) return;
            setReloading(true);
            setReloadError(null);
            try {
              const result = await query.refetch();
              if (!result.isSuccess) {
                setReloadError(result.error?.message ?? t("loadFailed"));
                return;
              }
              setEdit({ field: edit.field, state: result.data.fields[form][edit.field]! });
              setEditGeneration((value) => value + 1);
              save.reset();
            } catch (error) {
              setReloadError(error instanceof Error ? error.message : t("loadFailed"));
            } finally { setReloading(false); }
          }}
          onSave={(state) => {
            if (!canEdit || save.isPending || reloading) return;
            save.mutate({
              form,
              field: edit.field,
              state,
              expectedState: edit.state,
            });
          }}
        />
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FieldDialog } from "~/app/_components/signup-field-dialog";
import { api } from "~/trpc/react";
import { SIGNUP_FIELDS, type SignupFormKind, type FieldState } from "~/lib/signup-fields";

export default function SignupFormsPage() {
  const t = useTranslations("signupFields");
  const query = api.program.signupFieldSettings.useQuery();
  const utils = api.useUtils();
  const [form, setForm] = useState<SignupFormKind>("tutee");
  const [edit, setEdit] = useState<{ field: string; state: FieldState } | null>(null);
  const [saved, setSaved] = useState(false);
  const save = api.program.setSignupField.useMutation({ onSuccess: async () => {
    await Promise.all([utils.program.signupFieldSettings.invalidate(), utils.tutee.signupOptions.invalidate(), utils.application.options.invalidate()]);
    setEdit(null); setSaved(true);
  } });
  if (query.isLoading) return <p role="status">{t("loading")}</p>;
  if (!query.data || query.error) return <div className="card space-y-3 p-5"><p role="alert">{query.error?.message ?? t("loadFailed")}</p><button className="btn-secondary min-h-11 lg:min-h-10" onClick={() => void query.refetch()}>{t("reload")}</button></div>;
  const { fields, canEdit, secondaryEmailBindingEnabled } = query.data;
  return <div className="max-w-3xl space-y-5">
    <header><h1 className="page-title">{t("title")}</h1><p className="muted mt-2">{t("help")}</p></header>
    <div className="card space-y-2 border-l-4 border-l-accent-500 p-5"><p className="text-sm font-medium">{t("lockedHelp")}</p><p className="muted text-sm">{t("conditionalHelp")}</p><p className="muted text-sm">{t(secondaryEmailBindingEnabled ? "emailEnabled" : "emailDisabled")}</p></div>
    {!canEdit && <p role="status" className="muted">{t("readOnly")}</p>}
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("form")}>
      {(["tutee", "tutor"] as const).map(kind => <button key={kind} type="button" aria-pressed={form === kind} className={`${form === kind ? "btn-primary" : "btn-secondary"} min-h-11 lg:min-h-10`} onClick={() => { setForm(kind); setSaved(false); }}>{t(kind)}</button>)}
    </div>
    <section className="card overflow-hidden" aria-label={t(form)}>
      <ol className="divide-y divide-slate-200">
        {SIGNUP_FIELDS[form].map(field => <li key={field.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0"><p className="font-medium">{t(`labels.${field.label}`)}</p><p className="muted mt-1 text-sm">{t(field.locked ? "locked" : fields[form][field.key]!)}</p></div>
          {!field.locked && canEdit && <button type="button" className="btn-secondary min-h-11 lg:min-h-8" aria-label={t("configureField", { field: t(`labels.${field.label}`) })} onClick={() => { save.reset(); setSaved(false); setEdit({ field: field.key, state: fields[form][field.key]! }); }}>{t("configure")}</button>}
        </li>)}
      </ol>
    </section>
    {saved && <p role="status">{t("saved")}</p>}
    {edit && <FieldDialog label={t(`labels.${edit.field}`)} initial={edit.state} pending={save.isPending} error={save.error?.message}
      onClose={() => setEdit(null)} onReload={() => { setEdit(null); void query.refetch(); }}
      onSave={state => save.mutate({ form, field: edit.field, state, expectedState: edit.state })} />}
  </div>;
}


"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { membershipSchema, type AccountMembership } from "~/lib/account-membership";

/** The same complete badge draft serves staff editing and self-service requests.
 * Neither optimistic state nor a queued request is treated as a permission grant. */
export function MembershipEditor({ userId, initial, isHead = false, selfService = false }: {
  userId: string;
  initial: AccountMembership;
  isHead?: boolean;
  selfService?: boolean;
}) {
  const t = useTranslations("membership");
  const labels = useTranslations("admin.users.roles");
  const [value, setValue] = useState(initial);
  const [password, setPassword] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [transfer, setTransfer] = useState(false);
  const utils = api.useUtils();
  const router = useRouter();
  const refresh = async () => {
    await Promise.all([utils.admin.accounts.invalidate(), utils.account.me.invalidate()]);
    setPassword("");
    setOutcome(t("saved"));
    router.refresh();
  };
  const save = api.admin.setMemberships.useMutation({
    onSuccess: refresh,
    onError: (error) => { if (error.data?.approvalId) setOutcome(t("requested")); },
  });
  const request = api.account.requestMemberships.useMutation({ onSuccess: () => setOutcome(t("requested")) });
  const makeHead = api.admin.transferHead.useMutation({ onSuccess: refresh });
  const parsed = membershipSchema.safeParse(value);
  const pending = save.isPending || request.isPending || makeHead.isPending;
  const error = (save.error?.data?.approvalId ? null : save.error) ?? request.error ?? makeHead.error;
  return <section className="mt-5 space-y-4 border-t border-slate-200 pt-5">
    <h3 className="section-title">{t("title")}</h3>
    <p className="muted text-sm">{t(isHead && !selfService ? "headHelp" : "requestHelp")}</p>
    <label className="block">
      <span className="label">{t("rank")}</span>
      <select className="select min-h-11 w-full lg:min-h-10" value={value.rank}
        disabled={initial.rank === "HEAD" || pending}
        onChange={(event) => setValue({ ...value, rank: event.target.value as AccountMembership["rank"] })}>
        <option value="NONE">{t("none")}</option>
        {(["COORDINATOR", "ADMIN", ...(initial.rank === "HEAD" ? ["HEAD"] : [])] as const).map(rank =>
          <option key={rank} value={rank}>{labels(rank)}</option>)}
      </select>
    </label>
    <div className="grid grid-cols-2 gap-2">
      {(["tutor", "tutee", "viewer", "translator", "crew"] as const).map(key =>
        <label key={key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <input type="checkbox" checked={value[key]} disabled={pending}
            onChange={event => setValue({ ...value, [key]: event.target.checked })} />
          {t(key)}
        </label>)}
    </div>
    <p className="muted text-xs">{t("policyHelp")}</p>
    {!parsed.success && <p role="alert" className="text-sm text-red-600">{t("viewerExclusive")}</p>}
    {isHead && !selfService && <label className="block">
      <span className="label">{t("password")}</span>
      <input className="input min-h-11 w-full lg:min-h-10" type="password" autoComplete="current-password"
        value={password} onChange={event => setPassword(event.target.value)} />
    </label>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-primary min-h-11 lg:min-h-10"
        disabled={pending || !parsed.success || (isHead && !selfService && !password)}
        onClick={() => {
          setOutcome(null);
          if (selfService) request.mutate(value);
          else save.mutate({ userId, membership: value, ...(isHead ? { confirmPassword: password } : {}) });
        }}>{t(isHead && !selfService ? "save" : "request")}</button>
      {isHead && !selfService && (initial.rank === "ADMIN" || initial.rank === "COORDINATOR") &&
        <button type="button" className="btn-secondary min-h-11 lg:min-h-10" disabled={pending}
          onClick={() => setTransfer(!transfer)}>{t("makeHead")}</button>}
    </div>
    {transfer && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm">{t("transferHelp")}</p>
      <button type="button" className="btn-primary min-h-11 lg:min-h-10" disabled={pending || !password}
        onClick={() => makeHead.mutate({ userId, confirmPassword: password })}>{t("confirmTransfer")}</button>
    </div>}
    {outcome && <p role="status" className="text-sm">{outcome}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error.message}</p>}
  </section>;
}

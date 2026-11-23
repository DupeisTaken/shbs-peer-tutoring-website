"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CodeDisplay, CodeInput } from "~/app/_components/ui/code-field";
import { Button } from "~/app/_components/ui/button";

/** Synthetic purpose examples reuse the real controls without issuing secrets. */
export function CodeRecipe({ locale }: { locale: "en" | "zh" }) {
  const t = useTranslations("codes");
  const reg = useTranslations("admin.registrationCodes");
  const zh = locale === "zh";
  const [invitation, setInvitation] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<
    "interview" | "application" | "crewApplication"
  >("interview");
  const [lifecycle, setLifecycle] = useState<
    "active" | "attemptsExhausted" | "applicationInvalid" | "applicationInactive"
  >("active");
  return (
    <section className="card space-y-5 p-5" id="code-purpose">
      <header className="space-y-2 border-b border-slate-100 pb-4">
        <h2 className="section-title">
          {zh ? "邀请码与邮箱验证码" : "Invitation and email codes"}
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          {zh
            ? "绿色底用于邀请码，蓝色底用于邮箱验证码；管理列表展示来源标签、绑定邮箱及不可用原因。"
            : "Green tint identifies invitation codes and blue tint identifies email verification codes; management rows show source badges, bound email and unavailable reasons."}
        </p>
        <code className="block text-xs break-words text-slate-500">
          CodeInput · CodeDisplay · badge · registration-codes lifecycle
        </code>
      </header>
      <fieldset disabled={pending} className="space-y-5">
        <CodeInput
          purpose="invitation"
          value={invitation}
          onValueChange={setInvitation}
          aria-invalid={failed}
          aria-describedby={failed ? "code-example-error" : undefined}
        />
        <CodeInput purpose="email" value={email} onValueChange={setEmail} />
        <CodeDisplay code="A2B3C" />
        <CodeDisplay purpose="email" code="0123" />
      </fieldset>
      {failed && (
        <p
          id="code-example-error"
          role="alert"
          className="text-sm text-red-700"
        >
          {zh
            ? "示例验证码不正确。请更正后重试。"
            : "The example code was incorrect. Correct it and retry."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setPending(!pending)}>
          {zh ? "切换待处理状态" : "Toggle pending"}
        </Button>
        <Button onClick={() => setFailed(!failed)}>
          {zh ? "切换错误状态" : "Toggle error"}
        </Button>
        <Button onClick={() => setInvitation("A1B2C3D4E5F6")}>
          {zh ? "旧格式示例" : "Legacy example"}
        </Button>
      </div>
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <p className="eyebrow">
          {zh ? "邀请码状态与来源示例" : "Invitation status and source example"}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            {zh ? "签发来源" : "Issue source"}
            <select
              className="select control-compact block"
              value={source}
              onChange={(event) =>
                setSource(event.target.value as typeof source)
              }
            >
              {(["interview", "application", "crewApplication"] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {reg(`source.${value}`)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            {zh ? "可用状态" : "Lifecycle state"}
            <select
              className="select control-compact block"
              value={lifecycle}
              onChange={(event) =>
                setLifecycle(event.target.value as typeof lifecycle)
              }
            >
              <option value="active">{zh ? "可用" : "Active"}</option>
              {(
                [
                  "attemptsExhausted",
                  "applicationInvalid",
                  "applicationInactive",
                ] as const
              ).map((reason) => (
                <option key={reason} value={reason}>
                  {reg(`unavailableReason.${reason}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-900">
              A2B3C
            </span>
            <span
              className={
                lifecycle === "active" ? "badge-green" : "badge-amber"
              }
            >
              {lifecycle === "active"
                ? zh
                  ? "可用"
                  : "Active"
                : zh
                  ? "不可用"
                  : "Unavailable"}
            </span>
            <span className="badge bg-accent-100 text-accent-700">
              {reg(`source.${source}`)}
            </span>
          </div>
          <p className="mt-1 text-xs break-all text-slate-500">
            {reg("boundEmail", { email: "alex.chen@example.edu" })}
          </p>
          {lifecycle !== "active" && (
            <p className="mt-1 text-xs text-amber-800">
              {reg(`unavailableReason.${lifecycle}`)}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-600">{t("invitationHelp")}</p>
    </section>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CodeDisplay, CodeInput } from "~/app/_components/ui/code-field";
import { Button } from "~/app/_components/ui/button";

/** Synthetic purpose examples reuse the real controls without issuing secrets. */
export function CodeRecipe({ locale }: { locale: "en" | "zh" }) {
  const t = useTranslations("codes");
  const [invitation, setInvitation] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <section className="card space-y-5 p-5" id="code-purpose">
      <h2 className="section-title">
        {locale === "zh" ? "邀请码与邮箱验证码" : "Invitation and email codes"}
      </h2>
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
          {locale === "zh"
            ? "示例验证码不正确。请更正后重试。"
            : "The example code was incorrect. Correct it and retry."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setPending(!pending)}>
          {locale === "zh" ? "切换待处理状态" : "Toggle pending"}
        </Button>
        <Button onClick={() => setFailed(!failed)}>
          {locale === "zh" ? "切换错误状态" : "Toggle error"}
        </Button>
        <Button onClick={() => setInvitation("A1B2C3D4E5F6")}>
          {locale === "zh" ? "旧格式示例" : "Legacy example"}
        </Button>
      </div>
      <p className="text-xs text-slate-600">{t("invitationHelp")}</p>
    </section>
  );
}

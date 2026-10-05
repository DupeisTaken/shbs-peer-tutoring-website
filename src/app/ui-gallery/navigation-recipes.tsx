"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { PublicHeaderFrame } from "~/app/_components/public-header";
import { useBranding } from "~/app/_components/branding-provider";
import { SectionLinks } from "~/app/_components/section-links";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import { Button } from "~/app/_components/ui/button";
import { FormActions } from "~/app/_components/ui/patterns";

/** Navigation has real destinations; the local step demo never submits identity
 * data. Feature flows own proof invalidation, retained fields and server validation. */
export function NavigationRecipes({ locale }: { locale: "en" | "zh" }) {
  const t = useTranslations("registrationFlow");
  const { APP_TITLE } = useBranding();
  const [alternateTheme, setAlternateTheme] = useState(false);
  const [current, setCurrent] = useState(0);
  const steps = [t("identityTitle"), t("verifyTitle"), t("passwordTitle")];
  const zh = locale === "zh";
  return (
    <section
      data-theme={alternateTheme ? "emerald" : undefined}
      className="card min-w-0 space-y-5 overflow-hidden p-5 sm:p-6"
    >
      <h2 className="section-title">
        {zh ? "导航与注册步骤" : "Navigation and registration steps"}
      </h2>
      <p className="muted">
        {zh
          ? "页面链接保留浏览器历史；步骤变化时聚焦标题。标题栏偏好控件为本地示例；上方语言选择器翻译整个示例。"
          : "Page links preserve browser history; step changes focus the heading. Header preferences are local examples; the gallery language selector translates this preview."}
      </p>
      <code className="text-xs">
        PublicHeaderFrame · SectionLinks · RegistrationProgress
      </code>
      <PublicHeaderFrame
        title={APP_TITLE}
        sticky={false}
        language={
          <select
            key={locale}
            aria-label={zh ? "示例标题栏语言" : "Example header language"}
            defaultValue={locale}
            className="select h-11 py-0 lg:h-8"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        }
        theme={
          <Button
            size="compact"
            aria-pressed={alternateTheme}
            onClick={() => setAlternateTheme((value) => !value)}
          >
            {zh ? "示例主题" : "Example theme"}
          </Button>
        }
        navigation={
          <Link className="public-form-link" href="/">
            {zh ? "返回主页" : "Back to main page"}
          </Link>
        }
      />
      <SectionLinks
        label={zh ? "导航示例" : "Navigation example"}
        currentHref="/ui-gallery"
        items={[
          { href: "/ui-gallery", label: zh ? "组件展示" : "UI gallery" },
          {
            href: "/register",
            label: zh ? "邀请注册" : "Invitation registration",
          },
        ]}
      />
      <RegistrationProgress
        steps={steps}
        current={current}
        title={steps[current]!}
        busy={false}
      />
      <FormActions>
        <Button
          disabled={current === 0}
          onClick={() => setCurrent((step) => step - 1)}
        >
          {t("back")}
        </Button>
        <Button
          variant="primary"
          disabled={current === steps.length - 1}
          onClick={() => setCurrent((step) => step + 1)}
        >
          {zh ? "下一步（示例）" : "Next step (example)"}
        </Button>
      </FormActions>
    </section>
  );
}

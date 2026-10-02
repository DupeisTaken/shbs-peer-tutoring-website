"use client";
import { SectionLinks } from "~/app/_components/section-links";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { tuteeViews, resolveTuteeView } from "./views";

export function TuteeNavigation() {
  const t = useTranslations("tuteePortal");
  const selected = resolveTuteeView(useSearchParams().get("view"));
  return (
    <SectionLinks
      label={t("navigation")}
      currentHref={`/student?view=${selected}`}
      items={tuteeViews.map((view) => ({
        href: `/student?view=${view}`,
        label: t(view),
      }))}
    />
  );
}

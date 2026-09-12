"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { tuteeViews, resolveTuteeView } from "./views";

export function TuteeNavigation() {
  const t = useTranslations("tuteePortal");
  const selected = resolveTuteeView(useSearchParams().get("view"));
  return (
    <nav
      aria-label={t("navigation")}
      className="flex flex-wrap gap-1 border-b border-slate-200 pb-3"
    >
      {tuteeViews.map((view) => (
        <Link
          key={view}
          href={`/student?view=${view}`}
          prefetch={false}
          aria-current={selected === view ? "page" : undefined}
          className={
            selected === view ? "btn-primary btn-sm" : "btn-secondary btn-sm"
          }
        >
          {t(view)}
        </Link>
      ))}
    </nav>
  );
}

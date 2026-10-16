"use client";
import { SectionLinks } from "~/app/_components/section-links";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { tuteeViews, resolveTuteeView } from "./views";
import {
  useSessionViewState,
  useSessionViewVerified,
} from "~/app/_components/session-view-state";
import { viewEnum } from "~/lib/session-view-state";

export function TuteeNavigation() {
  const t = useTranslations("tuteePortal");
  const params = useSearchParams();
  const router = useRouter();
  const verified = useSessionViewVerified();
  const explicit = params.has("view");
  const selected = resolveTuteeView(params.get("view"));
  const [remembered, remember] = useSessionViewState({
    id: "student-view-v1",
    initialState: "dashboard",
    parse: viewEnum(tuteeViews),
  });
  useEffect(() => {
    // Validated URL choices (including unknown links falling back to Dashboard)
    // remain authoritative. Only a bare workspace return recalls the previous view.
    if (!verified) return;
    if (explicit) {
      if (remembered !== selected) remember(selected);
    } else if (remembered !== "dashboard" && !window.location.hash)
      router.replace(`/student?view=${remembered}`, { scroll: false });
  }, [explicit, selected, remembered, remember, router, verified]);
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

"use client";

import { useTranslations } from "next-intl";
import type { FieldState } from "~/lib/signup-fields";

/** Keep requirement text separate from field names so configurable labels cannot go stale. */
export function FieldRequirement({
  state = "optional",
}: {
  state?: FieldState;
}) {
  const t = useTranslations();
  if (state === "hidden") return null;
  return (
    <>
      {" "}
      <span className="muted inline-block text-xs">
        {t(`signupFields.${state}`)}
      </span>
    </>
  );
}

/** Resolve a recognizable title without treating a fallback as the requested
 * locale's saved text. Callers retain ownership of current versus captured data. */
export function pageTitleReference(title: unknown, locale: unknown) {
  if (!title || typeof title !== "object" || Array.isArray(title)) return null;
  const titles = title as Record<string, unknown>;
  for (const language of [locale, "en"]) {
    if (typeof language !== "string") continue;
    const value = titles[language];
    if (typeof value === "string" && value.trim())
      return { value, locale: language };
  }
  return null;
}

export type TranslationReviewPageTarget = {
  id: string;
  state: "current" | "missing";
  title: ReturnType<typeof pageTitleReference>;
  address: string | null;
};

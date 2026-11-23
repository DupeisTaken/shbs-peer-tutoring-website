import { pageMetadata } from "~/server/branding-metadata";
import { TranslationEditor } from "~/app/_components/translation-editor";

/** The review deep link shares the editor and its server-side access gate. */
export async function generateMetadata() {
  return pageMetadata("localization.title");
}

export default async function LocalizationPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  return (
    <TranslationEditor initialView={view === "review" ? "review" : "strings"} />
  );
}

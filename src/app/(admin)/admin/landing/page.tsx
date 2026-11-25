import { pageMetadata } from "~/server/branding-metadata";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { authorizeHomeEditor } from "~/server/home/images";
import { StatePanel } from "~/app/_components/ui/patterns";
import { parseLandingEditorView } from "~/lib/landing-editor-view";
import LandingEditor, { LandingIntentRecovery } from "./landing-editor";

/** Entry and Preview share the same live permission gate; no editor queries run on denial. */
export async function generateMetadata() {
  return pageMetadata("admin.nav.links.landing");
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [access, t] = await Promise.all([
    authorizeHomeEditor(),
    getTranslations(),
  ]);
  if (access.ok) {
    const query = await searchParams;
    return <LandingEditor initialView={parseLandingEditorView(query.view)} />;
  }
  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.landing.title")}</h1>
      <StatePanel
        kind="denied"
        title={t("uiPatterns.editorDenied")}
        action={
          <Link href="/admin" className="btn-secondary control-standard">
            {t("uiPatterns.returnManagement")}
          </Link>
        }
      >
        {t("uiPatterns.editorDeniedHelp")}
      </StatePanel>
      <LandingIntentRecovery />
    </div>
  );
}

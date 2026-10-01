import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { authorizeHomeEditor } from "~/server/home/images";
import { StatePanel } from "~/app/_components/ui/patterns";
import LandingEditor from "./landing-editor";

/** Entry and Preview share the same live permission gate; no editor queries run on denial. */
export default async function LandingPage() {
  const [access, t] = await Promise.all([
    authorizeHomeEditor(),
    getTranslations(),
  ]);
  if (access.ok) return <LandingEditor />;
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
    </div>
  );
}

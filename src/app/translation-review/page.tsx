import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { TranslationReview } from "~/app/_components/translation-review";
export default async function Page() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("reviewDrafts")} management={false}>
      <TranslationReview />
    </WorkflowShell>
  );
}

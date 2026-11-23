import { getTranslations } from "next-intl/server";
import { StatePanel } from "~/app/_components/ui/patterns";

export default async function TutorLoading() {
  const t = await getTranslations("pageRecovery");
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <StatePanel kind="loading" title={t("loadingTitle")} />
    </div>
  );
}

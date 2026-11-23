import { getTranslations } from "next-intl/server";
import { StatePanel } from "~/app/_components/ui/patterns";

export default async function LocalizationLoading() {
  const t = await getTranslations("pageRecovery");
  return (
    <div className="py-4">
      <StatePanel kind="loading" title={t("loadingTitle")} />
    </div>
  );
}

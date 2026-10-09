import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  PublicFormCard,
  PublicFormPage,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { brandingMetadata } from "~/server/branding-metadata";
import { UnsubscribeForm } from "./unsubscribe-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("unsubscribe");
  return {
    ...(await brandingMetadata(t("title"))),
    robots: { index: false, follow: false },
    // The URL carries an unsubscribe capability; never forward it as a referrer.
    referrer: "no-referrer",
  };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations()]);
  const token = typeof params.token === "string" ? params.token : undefined;
  return (
    <PublicFormPage
      title={t("unsubscribe.title")}
      description={t("unsubscribe.description")}
      backLabel={t("common.backToMain")}
      footer={
        <PublicFormRoute
          href="/signin?callbackUrl=%2Fmy-account"
          label={t("unsubscribe.manage")}
        >
          {t("unsubscribe.manageHelp")}
        </PublicFormRoute>
      }
    >
      <PublicFormCard>
        <UnsubscribeForm token={token} />
      </PublicFormCard>
    </PublicFormPage>
  );
}

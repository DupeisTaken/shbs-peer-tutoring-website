import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  PublicFormCard,
  PublicFormPage,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { brandingMetadata } from "~/server/branding-metadata";
import { RequestAppealForm } from "./request-appeal-form";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("requestAppeal");
  return {
    ...(await brandingMetadata(t("title"))),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}
export default async function RequestAppealPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations()]);
  const token = typeof params.token === "string" ? params.token : undefined;
  return (
    <PublicFormPage
      title={t("requestAppeal.title")}
      description={t("requestAppeal.description")}
      backLabel={t("common.backToMain")}
      footer={
        <PublicFormRoute href="/privacy" label={t("requestAppeal.contact")}>
          {t("requestAppeal.contactHelp")}
        </PublicFormRoute>
      }
    >
      <PublicFormCard>
        <RequestAppealForm token={token} />
      </PublicFormCard>
    </PublicFormPage>
  );
}

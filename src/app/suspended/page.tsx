import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { SuspendedAppeal } from "./appeal-form";
import {
  PublicFormPage,
  PublicFormCard,
} from "~/app/_components/public-form-page";
import { InlineNotice } from "~/app/_components/ui/patterns";

export async function generateMetadata() {
  return pageMetadata("suspended.title");
}

/** Shown to a suspended account in place of any normal area: the reason + an appeal form. */
export default async function SuspendedPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const data = await api.account.suspension();
  if (!data.suspended) redirect("/");
  const t = await getTranslations();

  return (
    <PublicFormPage
      title={t("suspended.title")}
      description={t("suspended.body")}
      backLabel={t("common.backToMain")}
      skipLabel={t("common.skipToContent")}
    >
      <PublicFormCard>
        <div className="space-y-4">
          {data.reason && (
            <InlineNotice tone="warning">
              <p>{t("suspended.reason", { reason: data.reason })}</p>
            </InlineNotice>
          )}
          <SuspendedAppeal
            pending={data.appeal?.state === "PENDING"}
            denied={data.appeal?.state === "DENIED"}
          />
          <div className="border-t border-slate-100 pt-3">
            <SignOutButton />
          </div>
        </div>
      </PublicFormCard>
    </PublicFormPage>
  );
}

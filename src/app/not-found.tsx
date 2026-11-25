import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicFormCard, PublicFormPage } from "./_components/public-form-page";
import { getSignedInWorkspaceHeader } from "./_components/signed-in-workspace-header";
import { FormActions } from "./_components/ui/patterns";

/** Missing and unpublished resources share the same public recovery; never
 * disclose whether an inaccessible private record exists. */
export default async function NotFound() {
  const t = await getTranslations();
  const signedInHeader = await getSignedInWorkspaceHeader({
    href: "/",
    title: t("pageRecovery.title"),
  });
  return (
    <PublicFormPage
      title={t("pageRecovery.title")}
      backLabel={t("common.backToMain")}
      skipLabel={t("common.skipToContent")}
      header={signedInHeader ?? undefined}
    >
      <PublicFormCard>
        <p className="text-sm leading-6 text-slate-600">
          {t("pageRecovery.body")}
        </p>
        <FormActions>
          <Link href="/" className="btn-primary control-standard">
            {t("workflows.home")}
          </Link>
          {!signedInHeader && (
            <Link href="/signin" className="btn-secondary control-standard">
              {t("auth.register.done.signIn")}
            </Link>
          )}
        </FormActions>
      </PublicFormCard>
    </PublicFormPage>
  );
}

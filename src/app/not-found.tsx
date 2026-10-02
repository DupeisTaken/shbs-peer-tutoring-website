import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicFormCard, PublicFormPage } from "./_components/public-form-page";
import { FormActions } from "./_components/ui/patterns";

/** Missing and unpublished resources share the same public recovery; never
 * disclose whether an inaccessible private record exists. */
export default async function NotFound() {
  const t = await getTranslations();
  return (
    <PublicFormPage
      title={t("pageRecovery.title")}
      backLabel={t("common.backToMain")}
    >
      <PublicFormCard>
        <p className="text-sm leading-6 text-slate-600">
          {t("pageRecovery.body")}
        </p>
        <FormActions>
          <Link href="/signin" className="btn-secondary control-standard">
            {t("auth.register.done.signIn")}
          </Link>
        </FormActions>
      </PublicFormCard>
    </PublicFormPage>
  );
}

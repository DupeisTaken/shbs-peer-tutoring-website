import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { APP_TITLE, ORG_NAME, SUPPORT_EMAIL } from "~/lib/branding";
import { getPrivacyPolicy, PRIVACY_POLICY_UPDATED } from "~/lib/privacy-policy";

export async function generateMetadata() {
  const policy = getPrivacyPolicy(await getLocale());
  return {
    title: `${policy.title} | ${APP_TITLE}`,
    description: policy.introduction,
  };
}

/** Public, repository-owned notice: no login, seed data or policy acceptance required. */
export default async function PrivacyPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("common"),
  ]);
  const policy = getPrivacyPolicy(locale);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            className="flex min-h-11 items-center text-xl font-extrabold tracking-tight text-slate-900 lg:min-h-8 lg:text-lg"
          >
            {APP_TITLE}
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitcher compactAtDesktop />
            <LanguageSwitcher compactAtDesktop />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <Link
          href="/"
          className="link inline-flex min-h-11 items-center text-sm"
        >
          {t("backToMain")}
        </Link>
        {/* Explicit language keeps the English fallback accessible in other interface locales. */}
        <article lang={policy.lang} aria-labelledby="privacy-title">
          <div className="max-w-3xl border-b border-slate-200 pt-5 pb-8">
            <p className="text-accent-700 text-sm font-semibold">{ORG_NAME}</p>
            <h1
              id="privacy-title"
              className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl"
            >
              {policy.title}
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              {policy.introduction}
            </p>
            <p className="mt-4 text-sm text-slate-500">
              {policy.updatedLabel}:{" "}
              <time dateTime={PRIVACY_POLICY_UPDATED}>
                {PRIVACY_POLICY_UPDATED}
              </time>
            </p>
          </div>
          <div className="grid gap-10 pt-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
            <nav
              aria-label={policy.contentsLabel}
              className="self-start lg:sticky lg:top-8"
            >
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {policy.contentsLabel}
              </h2>
              <ul>
                {policy.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="link inline-flex min-h-11 items-center py-2 text-sm"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href="#contact"
                    className="link inline-flex min-h-11 items-center py-2 text-sm"
                  >
                    {policy.contactTitle}
                  </a>
                </li>
              </ul>
            </nav>
            <div className="min-w-0 space-y-9">
              {policy.sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-title`}
                  className="scroll-mt-8"
                >
                  <h2
                    id={`${section.id}-title`}
                    className="text-xl font-semibold tracking-tight text-slate-900"
                  >
                    {section.title}
                  </h2>
                  {section.paragraphs.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="mt-3 leading-7 text-slate-600"
                    >
                      {paragraph}
                    </p>
                  ))}
                </section>
              ))}
              <section
                id="contact"
                aria-labelledby="contact-title"
                className="bg-accent-50 border-accent-200 scroll-mt-8 rounded-xl border p-6"
              >
                <h2
                  id="contact-title"
                  className="text-xl font-semibold text-slate-900"
                >
                  {policy.contactTitle}
                </h2>
                <p className="mt-3 leading-7 text-slate-600">
                  {policy.contactBody}
                </p>
                {SUPPORT_EMAIL && (
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="link mt-3 inline-flex min-h-11 items-center break-all"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                )}
                <p className="mt-3 leading-7 text-slate-600">
                  {policy.contactFallback}
                </p>
              </section>
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}

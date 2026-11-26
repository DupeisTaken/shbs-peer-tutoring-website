import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import {
  getAboutLiveStats,
  getCurrentHeadEmail,
  getCustomAboutRender,
} from "~/server/home/about";
import { authorizeHomeEditor } from "~/server/home/images";
import { APP_TITLE, ORG_NAME, SUPPORT_EMAIL } from "~/lib/branding";
import { getAboutContent } from "~/lib/about-content";
import { getPrivacyPolicy } from "~/lib/privacy-policy";
import { ArrowRightIcon } from "~/app/_components/icons";
import { PageBlocks } from "~/app/_components/page-blocks";
import { PublicHeader } from "~/app/_components/public-header";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";

export async function generateMetadata() {
  const locale = await getLocale();
  const content = getAboutContent(locale);
  const custom = await getCustomAboutRender(db, locale, {
    allowPreview: false,
  });
  return {
    title: `${custom ? custom.title : content.headerTitle} | ${APP_TITLE}`,
    description: content.introduction,
  };
}

/**
 * Public, repository-owned About page (/about). No sign-in, seed data, or policy acceptance is
 * required. When staff enable the optional editor-authored alternative in /admin/landing (Pages),
 * /about renders that custom block layout instead while preserving the built-in fallback.
 */
export default async function AboutPage({
  searchParams,
}: {
  searchParams?: Promise<{ preview?: string }>;
} = {}) {
  const params = searchParams ? await searchParams : undefined;
  const wantPreview = params?.preview === "custom";
  const [locale, t, tl, help, editorAuth] = await Promise.all([
    getLocale(),
    getTranslations("common"),
    getTranslations("landing"),
    getTranslations("helpNav"),
    wantPreview ? authorizeHomeEditor() : Promise.resolve({ ok: false }),
  ]);
  const content = getAboutContent(locale);
  const custom = await getCustomAboutRender(db, locale, {
    allowPreview: wantPreview && editorAuth.ok,
  });
  const headerTitle = custom ? custom.title : content.headerTitle;
  const signedInHeader = await getSignedInWorkspaceHeader({
    href: "/about",
    title: headerTitle,
  });

  if (custom) {
    return (
      <div className="flex min-h-screen flex-col">
        {signedInHeader ?? (
          <PublicHeader
            href="/"
            linkTitle={t("backToMain")}
            sticky={false}
            title={headerTitle}
            skipLabel={t("skipToContent")}
          />
        )}

        <main id="main-content" className="flex-1">
          <div className="mx-auto max-w-3xl px-4 pt-12">
            {custom.isPreview && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <span className="font-semibold">
                  {tl("preview.draftBadge")}
                </span>{" "}
                · {content.customPreviewNote}
              </div>
            )}
            <h1 className="page-title" lang={custom.titleLocale}>
              {custom.title}
            </h1>
          </div>
          <PageBlocks blocks={custom.blocks} locale={locale} />
          {custom.isPreview && (
            <div className="mx-auto max-w-3xl px-4 pb-12">
              <Link href="/admin/landing?view=pages" className="link">
                {tl("preview.ribbon.back")}
              </Link>
            </div>
          )}
        </main>

        <AboutFooter
          footerText={tl("footer", { appTitle: APP_TITLE })}
          helpLabel={help("title")}
          privacyLabel={getPrivacyPolicy(locale).title}
        />
      </div>
    );
  }

  const [stats, headEmail, features] = await Promise.all([
    getAboutLiveStats(db),
    getCurrentHeadEmail(db),
    getFeatures(db),
  ]);
  const contactEmail = headEmail ?? (SUPPORT_EMAIL || null);
  const formatter = new Intl.NumberFormat(content.lang);

  const navSections = [
    { id: content.story.id, title: content.story.title },
    { id: content.howItWorks.id, title: content.howItWorks.title },
    { id: content.team.id, title: content.team.title },
    { id: content.audiences.id, title: content.audiences.title },
    { id: content.getInvolved.id, title: content.getInvolved.title },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {signedInHeader ?? (
        <PublicHeader
          href="/"
          linkTitle={t("backToMain")}
          sticky={false}
          title={headerTitle}
          skipLabel={t("skipToContent")}
        />
      )}

      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-12"
      >

        {/* Explicit language keeps the English fallback accessible in other interface locales. */}
        <article lang={content.lang} aria-labelledby="about-title">
          <header className="border-b border-slate-200 pt-5 pb-8">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <p className="text-accent-700 text-sm font-semibold">
                  {ORG_NAME}
                </p>
                <span className="border-accent-200 bg-accent-50 text-accent-800 inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold">
                  {content.eyebrow}
                </span>
              </div>
              <h1
                id="about-title"
                className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl"
              >
                {content.title}
              </h1>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                {content.introduction}
              </p>
            </div>

            {/* Counting-only live activity totals (no individual data or breakdowns). */}
            <section
              aria-labelledby="about-stats-heading"
              className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <h2 id="about-stats-heading" className="sr-only">
                {content.stats.heading}
              </h2>
              <div className="card p-5 sm:p-6">
                <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                  {content.stats.sessionsLabel}
                </p>
                <p
                  data-testid="about-stat-sessions"
                  className="text-accent-700 mt-2 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl"
                >
                  {formatter.format(stats.totalSessions)}
                </p>
                <p className="mt-1.5 text-sm text-slate-600">
                  {content.stats.sessionsCaption}
                </p>
              </div>
              <div className="card p-5 sm:p-6">
                <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                  {content.stats.minutesLabel}
                </p>
                <p
                  data-testid="about-stat-minutes"
                  className="text-accent-700 mt-2 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl"
                >
                  {formatter.format(stats.totalMinutesTutored)}
                </p>
                <p className="mt-1.5 text-sm text-slate-600">
                  {content.stats.minutesCaption}
                </p>
              </div>
            </section>
          </header>

          <div className="grid gap-10 pt-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
            <nav
              aria-label={content.contentsLabel}
              className="self-start lg:sticky lg:top-8"
            >
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {content.contentsLabel}
              </h2>
              <ul>
                {navSections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="link inline-flex min-h-11 items-center py-2 text-sm"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0 space-y-12">
              {/* Story & Philosophy */}
              <section
                id={content.story.id}
                aria-labelledby={`${content.story.id}-title`}
                className="scroll-mt-8"
              >
                <h2
                  id={`${content.story.id}-title`}
                  className="text-2xl font-semibold tracking-tight text-slate-900"
                >
                  {content.story.title}
                </h2>
                {content.story.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mt-3 leading-7 text-slate-600"
                  >
                    {paragraph}
                  </p>
                ))}
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {content.story.pillars.map((pillar) => (
                    <div key={pillar.title} className="card p-4 sm:p-5">
                      <h3 className="text-base font-semibold text-slate-900">
                        {pillar.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {pillar.body}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Curriculum, Sessions & Tutor Admission */}
              <section
                id={content.howItWorks.id}
                aria-labelledby={`${content.howItWorks.id}-title`}
                className="scroll-mt-8 space-y-6"
              >
                <h2
                  id={`${content.howItWorks.id}-title`}
                  className="text-2xl font-semibold tracking-tight text-slate-900"
                >
                  {content.howItWorks.title}
                </h2>

                <div className="card p-5 sm:p-6">
                  <h3 className="text-base font-semibold text-slate-900">
                    {content.howItWorks.curriculumTitle}
                  </h3>
                  <p className="mt-2 leading-7 text-slate-600">
                    {content.howItWorks.curriculumBody}
                  </p>
                </div>

                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {content.howItWorks.formatTitle}
                  </h3>
                  <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {content.howItWorks.facts.map((fact) => (
                      <div key={fact.label} className="card p-4 sm:p-5">
                        <dt className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                          {fact.label}
                        </dt>
                        <dd className="mt-1.5 text-base font-semibold text-slate-900">
                          {fact.value}
                        </dd>
                        <dd className="mt-1 text-sm leading-6 text-slate-600">
                          {fact.detail}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {content.howItWorks.admissionTitle}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {content.howItWorks.admissionIntro}
                  </p>
                  <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {content.howItWorks.admissionSteps.map((item) => (
                      <li key={item.step} className="card p-4 sm:p-5">
                        <span className="text-accent-700 text-xs font-bold tracking-wider uppercase">
                          {item.step}
                        </span>
                        <h4 className="mt-1.5 text-base font-semibold text-slate-900">
                          {item.title}
                        </h4>
                        <p className="mt-1.5 text-sm leading-6 text-slate-600">
                          {item.body}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>

              {/* The Whole Team */}
              <section
                id={content.team.id}
                aria-labelledby={`${content.team.id}-title`}
                className="scroll-mt-8"
              >
                <h2
                  id={`${content.team.id}-title`}
                  className="text-2xl font-semibold tracking-tight text-slate-900"
                >
                  {content.team.title}
                </h2>
                <p className="mt-3 leading-7 text-slate-600">
                  {content.team.independenceLead}
                </p>
                <div className="mt-5 space-y-4">
                  {content.team.roles.map((role) => (
                    <div
                      key={role.id}
                      className={`card p-5 ${
                        role.id === "management"
                          ? "border-accent-200 bg-accent-50/40"
                          : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-900">
                          {role.title}
                        </h3>
                        <span className="badge-slate">{role.badge}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {role.body}
                      </p>
                      {role.id === "management" && (
                        <div className="mt-3 border-t border-slate-200/80 pt-3 text-sm">
                          <p className="font-medium text-slate-800">
                            {content.team.headContactLabel}
                          </p>
                          {contactEmail ? (
                            <a
                              href={`mailto:${contactEmail}`}
                              className="link mt-1 inline-flex min-h-11 items-center break-all"
                            >
                              {contactEmail}
                            </a>
                          ) : (
                            <p className="mt-1 text-slate-600">
                              {content.team.headContactFallback}
                            </p>
                          )}
                        </div>
                      )}
                      {role.id === "viewers" && features.VIEWER_SIGNUP && (
                        <div className="mt-2">
                          <Link
                            href="/viewer"
                            className="link inline-flex min-h-11 items-center text-sm"
                          >
                            {content.team.viewerCta}
                          </Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Who This Program Is For */}
              <section
                id={content.audiences.id}
                aria-labelledby={`${content.audiences.id}-title`}
                className="scroll-mt-8"
              >
                <h2
                  id={`${content.audiences.id}-title`}
                  className="text-2xl font-semibold tracking-tight text-slate-900"
                >
                  {content.audiences.title}
                </h2>
                <p className="mt-3 leading-7 text-slate-600">
                  {content.audiences.intro}
                </p>
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {content.audiences.cards.map((card) => (
                    <div key={card.title} className="card p-4 sm:p-5">
                      <p className="text-accent-700 text-xs font-semibold tracking-wide uppercase">
                        {card.audience}
                      </p>
                      <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                        {card.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {card.body}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Get Involved */}
              <section
                id={content.getInvolved.id}
                aria-labelledby={`${content.getInvolved.id}-title`}
                className="bg-accent-50 border-accent-200 scroll-mt-8 rounded-xl border p-6"
              >
                <h2
                  id={`${content.getInvolved.id}-title`}
                  className="text-xl font-semibold text-slate-900"
                >
                  {content.getInvolved.title}
                </h2>
                <p className="mt-2 leading-7 text-slate-600">
                  {content.getInvolved.body}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href="/tutee" className="btn-primary min-h-11">
                    <span>{content.getInvolved.requestTutor}</span>
                    <ArrowRightIcon />
                  </Link>
                  <Link href="/tutor" className="btn-secondary min-h-11">
                    {content.getInvolved.becomeTutor}
                  </Link>
                  {features.CREW && (
                    <Link href="/crew" className="btn-secondary min-h-11">
                      {content.getInvolved.joinCrew}
                    </Link>
                  )}
                  {features.VIEWER_SIGNUP && (
                    <Link href="/viewer" className="btn-secondary min-h-11">
                      {content.getInvolved.followProgram}
                    </Link>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <Link
                    href="/help"
                    className="link inline-flex min-h-11 items-center"
                  >
                    {content.getInvolved.helpCenter}
                  </Link>
                  <Link
                    href="/privacy"
                    className="link inline-flex min-h-11 items-center"
                  >
                    {content.getInvolved.privacyPolicy}
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </article>
      </main>

      <AboutFooter
        footerText={tl("footer", { appTitle: APP_TITLE })}
        helpLabel={help("title")}
        privacyLabel={getPrivacyPolicy(locale).title}
      />
    </div>
  );
}

function AboutFooter({
  footerText,
  helpLabel,
  privacyLabel,
}: {
  footerText: string;
  helpLabel: string;
  privacyLabel: string;
}) {
  return (
    <footer className="border-t border-slate-200 py-6">
      <p className="muted text-center text-sm">{footerText}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
        <Link href="/help" className="link inline-flex min-h-11 items-center px-3">
          {helpLabel}
        </Link>
        <span aria-hidden="true" className="text-slate-300">
          ·
        </span>
        <Link
          href="/privacy"
          className="link inline-flex min-h-11 items-center px-3"
        >
          {privacyLabel}
        </Link>
      </div>
    </footer>
  );
}

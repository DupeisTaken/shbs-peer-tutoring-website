import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { getHomeOverrides, applyHomeVars } from "~/server/home/content";
import { getLandingNews } from "~/server/home/news";
import { getLandingSections } from "~/server/home/sections";
import { getLandingLayout, type Block } from "~/server/home/blocks";
import { getNavPages } from "~/server/home/pages";
import { APP_TITLE, SUPPORT_EMAIL } from "~/lib/branding";
import { Markdown } from "~/app/_components/markdown";
import { LandingSections } from "~/app/_components/landing-sections";
import { RichTextBlock, ImageBlock, ButtonsBlock, ColumnsBlock } from "~/app/_components/page-blocks";
import { NavPageLinks } from "~/app/_components/nav-page-links";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";

/**
 * The public landing page body, shared by the live route (`/`) and the admin preview
 * (`/landing-preview`). The page is an ordered list of blocks (see src/server/home/blocks.ts):
 * system blocks (HERO/FEATURES/SECTIONS/NEWS) render the curated pieces edited in their own tabs;
 * content blocks (RICH_TEXT/IMAGE/BUTTONS) render their inline data. In `preview` mode it also pulls
 * in unpublished news + hidden sections (badged) behind a ribbon. The auth redirect for signed-in
 * visitors lives on the `/` route, not here.
 */
export async function LandingView({ preview = false }: { preview?: boolean }) {
  const locale = await getLocale();
  const [features, overrides, news, sections, layout, navPages, t] = await Promise.all([
    getFeatures(db),
    getHomeOverrides(db, locale),
    getLandingNews(db, locale, { includeDrafts: preview }),
    getLandingSections(db, locale, { includeHidden: preview }),
    getLandingLayout(db),
    getNavPages(db, locale),
    getTranslations("landing"),
  ]);

  // Resolve a landing text slot: an admin override (with {appTitle} substituted) wins, else the
  // bundled messages/*.json default.
  const text = (key: string) => {
    const override = overrides[key];
    return override != null ? applyHomeVars(override) : t(key, { appTitle: APP_TITLE });
  };
  const heroImageId = overrides.heroImageId;
  const draftLabel = t("preview.draftBadge");

  const renderBlock = (block: Block) => {
    switch (block.type) {
      case "HERO":
        return (
          <section className="relative overflow-hidden bg-gradient-to-b from-accent-50 via-white to-white">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-accent-200/40 blur-3xl"
            />
            <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
              <span className="badge-slate mb-5">{text("tagline")}</span>
              <h1 className="text-4xl font-extrabold tracking-tight whitespace-nowrap sm:text-6xl">
                <span className="bg-gradient-to-r from-accent-700 to-accent-400 bg-clip-text text-transparent">
                  {text("heroTitle")}
                </span>
              </h1>
              {heroImageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/images/${heroImageId}`}
                  alt=""
                  className="mx-auto mt-8 h-auto max-h-80 w-full max-w-2xl rounded-2xl border border-slate-200 object-cover shadow-sm"
                />
              )}
              <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">{text("intro")}</p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Link href="/signup" className="btn-primary">
                  {text("ctaPrimary")}
                </Link>
                <Link href="/tutor-signup" className="btn-secondary">
                  {text("ctaSecondary")}
                </Link>
              </div>
            </div>
          </section>
        );

      case "FEATURES":
        return (
          <section className="mx-auto max-w-5xl px-4 py-16">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <FeatureCard
                emoji="🎓"
                title={text("features.students.title")}
                body={text("features.students.body")}
              />
              <FeatureCard
                emoji="🧑‍🏫"
                title={text("features.tutors.title")}
                body={text("features.tutors.body")}
              />
              <FeatureCard
                emoji="🗂️"
                title={text("features.team.title")}
                body={text("features.team.body")}
              />
            </div>
          </section>
        );

      case "SECTIONS":
        if (sections.length === 0) return null;
        return (
          <section className="mx-auto max-w-3xl px-4 py-4">
            <div className="card px-6 py-2">
              <LandingSections
                sections={sections.map((s) => ({
                  id: s.id,
                  title: s.title,
                  body: s.body,
                  openByDefault: s.openByDefault,
                  mode: s.mode,
                  slug: s.slug,
                  draftLabel: preview && !s.published ? draftLabel : undefined,
                }))}
              />
            </div>
          </section>
        );

      case "NEWS":
        if (news.length === 0) return null;
        return (
          <section className="mx-auto max-w-3xl px-4 py-8">
            <h2 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">
              {t("news.title")}
            </h2>
            <ol className="space-y-5">
              {news.map((item) => (
                <li key={item.id} className="card p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                      {preview && !item.published && (
                        <span className="badge-amber">{draftLabel}</span>
                      )}
                    </div>
                    {item.date && (
                      <time
                        dateTime={item.date}
                        className="text-xs font-medium tracking-wide text-slate-500 uppercase"
                      >
                        {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                          new Date(item.date),
                        )}
                      </time>
                    )}
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    <Markdown>{item.body}</Markdown>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );

      case "RICH_TEXT":
        return <RichTextBlock block={block} locale={locale} />;
      case "IMAGE":
        return <ImageBlock block={block} locale={locale} />;
      case "BUTTONS":
        return <ButtonsBlock block={block} locale={locale} />;
      case "COLUMNS":
        return <ColumnsBlock block={block} locale={locale} />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      {preview && <PreviewRibbon />}

      {/* Top banner: brand + the entry points */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            className="text-lg font-extrabold tracking-tight whitespace-nowrap text-slate-900"
          >
            {APP_TITLE}
          </Link>
          <nav className="flex flex-wrap items-center gap-2">
            <NavPageLinks pages={navPages} />
            <Link href="/signup" className="btn-primary btn-sm">
              {t("nav.requestTutor")}
            </Link>
            <Link href="/tutor-signup" className="btn-secondary btn-sm">
              {t("nav.becomeTutor")}
            </Link>
            {features.CREW && (
              <Link href="/crew-signup" className="btn-secondary btn-sm">
                {t("nav.becomeCrew")}
              </Link>
            )}
            {features.VIEWER_SIGNUP && (
              <Link href="/viewer-signup" className="btn-secondary btn-sm">
                {t("nav.viewerSignup")}
              </Link>
            )}
            <Link href="/signin" className="btn-secondary btn-sm">
              {t("nav.teamSignin")}
            </Link>
            <ThemeSwitcher />
            <LanguageSwitcher />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {layout.map((block) => (
          <div key={block.id}>{renderBlock(block)}</div>
        ))}
      </main>

      <footer className="border-t border-slate-200 py-6">
        <p className="muted text-center text-sm">{text("footer")}</p>
        {SUPPORT_EMAIL && (
          <p className="muted mt-1 text-center text-sm">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="link">
              {SUPPORT_EMAIL}
            </a>
          </p>
        )}
      </footer>
    </div>
  );
}

/** Sticky banner shown only in the editor preview. */
async function PreviewRibbon() {
  const t = await getTranslations("landing.preview");
  return (
    // Not sticky: the page's own header is sticky top-0, so the ribbon stays at the very top and
    // scrolls away rather than overlapping it.
    <div className="border-b border-accent-200 bg-accent-600 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase">
            {t("ribbon.title")}
          </span>
          <span className="text-white/90">{t("ribbon.note")}</span>
        </span>
        <Link href="/admin/landing" className="font-semibold underline-offset-2 hover:underline">
          {t("ribbon.back")}
        </Link>
      </div>
    </div>
  );
}

function FeatureCard({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="card p-6">
      <div className="text-2xl">{emoji}</div>
      <h2 className="mt-3 font-semibold text-slate-900">{title}</h2>
      <p className="muted mt-1 text-sm">{body}</p>
    </div>
  );
}

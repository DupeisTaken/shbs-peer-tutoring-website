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
import {
  RichTextBlock,
  ImageBlock,
  ButtonsBlock,
  ColumnsBlock,
} from "~/app/_components/page-blocks";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";
import { NativeDisclosureIcon } from "~/app/_components/icons";
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
  const [features, overrides, news, sections, layout, navPages, t] =
    await Promise.all([
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
    return override != null
      ? applyHomeVars(override)
      : t(key, { appTitle: APP_TITLE });
  };
  const heroImageId = overrides.heroImageId;
  const draftLabel = t("preview.draftBadge");

  const renderBlock = (block: Block) => {
    switch (block.type) {
      case "HERO":
        return (
          <section className="from-accent-50 relative overflow-hidden bg-gradient-to-b via-white to-white">
            <div
              aria-hidden
              className="bg-accent-200/35 pointer-events-none absolute -top-28 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full blur-3xl sm:w-[42rem]"
            />
            <div className="relative mx-auto max-w-3xl px-4 py-14 text-center sm:py-24 lg:py-28">
              <span className="badge-slate mb-5">{text("tagline")}</span>
              <GradientTitle text={text("heroTitle")} />
              {heroImageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/images/${heroImageId}`}
                  alt=""
                  className="mx-auto mt-7 h-auto max-h-80 w-full max-w-2xl rounded-xl border border-slate-200 object-cover shadow-sm"
                />
              )}
              <p className="mx-auto mt-5 max-w-sm text-base leading-7 text-slate-600 sm:max-w-2xl sm:text-lg">
                {text("intro")}
              </p>
              <div className="mx-auto mt-8 grid max-w-sm grid-cols-1 gap-3 sm:flex sm:max-w-none sm:flex-wrap sm:items-center sm:justify-center">
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
          <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
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
                      <h3 className="text-lg font-semibold text-slate-900">
                        {item.title}
                      </h3>
                      {preview && !item.published && (
                        <span className="badge-amber">{draftLabel}</span>
                      )}
                    </div>
                    {item.date && (
                      <time
                        dateTime={item.date}
                        className="text-xs font-medium tracking-wide text-slate-500 uppercase"
                      >
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                        }).format(new Date(item.date))}
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

      {/* Top banner: single-line brand left, compact entry menus right. */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto grid max-w-6xl gap-3 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
          <Link
            href="/"
            className="min-w-0 justify-self-start text-left text-lg font-extrabold tracking-tight whitespace-nowrap text-slate-900"
          >
            {APP_TITLE}
          </Link>
          <nav className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">
            <HeaderMenu
              label={t("nav.accessProgramInformation")}
              items={[
                ...navPages.map((page) => ({
                  href: `/p/${page.slug}`,
                  label: page.label,
                })),
                ...(features.VIEWER_SIGNUP
                  ? [{ href: "/viewer-signup", label: t("nav.viewerSignup") }]
                  : []),
              ]}
            />
            <HeaderMenu
              label={t("nav.joinProgram")}
              tone="primary"
              items={[
                { href: "/signup", label: t("nav.requestTutor"), strong: true },
                { href: "/tutor-signup", label: t("nav.becomeTutor") },
                ...(features.CREW
                  ? [{ href: "/crew-signup", label: t("nav.becomeCrew") }]
                  : []),
              ]}
            />
            <Link href="/signin" className="btn-secondary btn-sm shrink-0">
              {t("nav.teamSignin")}
            </Link>
            <div className="shrink-0">
              <ThemeSwitcher />
            </div>
            <div className="shrink-0">
              <LanguageSwitcher />
            </div>
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
    <div className="border-accent-200 bg-accent-600 border-b text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase">
            {t("ribbon.title")}
          </span>
          <span className="text-white/90">{t("ribbon.note")}</span>
        </span>
        <Link
          href="/admin/landing"
          className="font-semibold underline-offset-2 hover:underline"
        >
          {t("ribbon.back")}
        </Link>
      </div>
    </div>
  );
}

function FeatureCard({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card p-5 text-center sm:p-6 sm:text-left">
      <div className="text-2xl">{emoji}</div>
      <h2 className="mt-3 font-semibold text-slate-900">{title}</h2>
      <p className="muted mt-1 text-sm">{body}</p>
    </div>
  );
}

function HeaderMenu({
  label,
  items,
  tone = "secondary",
}: {
  label: string;
  items: { href: string; label: string; strong?: boolean }[];
  tone?: "primary" | "secondary";
}) {
  if (items.length === 0) return null;

  return (
    <details className="group relative shrink-0">
      <DetailsAutoClose />
      <summary
        className={`btn-sm flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden ${
          tone === "primary" ? "btn-primary" : "btn-secondary"
        }`}
      >
        <span>{label}</span>
        <NativeDisclosureIcon />
      </summary>
      <div className="absolute left-0 z-30 mt-2 min-w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
        <div className="grid gap-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm whitespace-nowrap text-slate-700 transition hover:bg-slate-50 hover:text-slate-950 ${
                item.strong ? "font-bold text-slate-950" : "font-medium"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </details>
  );
}

function GradientTitle({ text }: { text: string }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return (
    <h1 className="mx-auto flex max-w-sm flex-wrap justify-center gap-x-2 text-3xl leading-tight font-extrabold tracking-tight sm:max-w-none sm:text-5xl lg:text-6xl">
      {words.length > 0 ? (
        words.map((word, i) => (
          <span
            key={`${word}-${i}`}
            className="from-accent-700 to-accent-400 bg-gradient-to-r bg-clip-text text-transparent"
          >
            {word}
          </span>
        ))
      ) : (
        <span className="from-accent-700 to-accent-400 bg-gradient-to-r bg-clip-text text-transparent">
          {text}
        </span>
      )}
    </h1>
  );
}

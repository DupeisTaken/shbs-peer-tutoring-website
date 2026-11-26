import Link from "next/link";
import type { ReactNode } from "react";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { getHomeOverrides, applyHomeVars } from "~/server/home/content";
import { getLandingNews } from "~/server/home/news";
import { getLandingSections } from "~/server/home/sections";
import { getLandingLayout, type Block } from "~/server/home/blocks";
import { getNavPages } from "~/server/home/pages";
import { APP_TITLE, SUPPORT_EMAIL } from "~/lib/branding";
import { getAboutContent } from "~/lib/about-content";
import { getPrivacyPolicy } from "~/lib/privacy-policy";
import {
  resolveSignedInLink,
  type SignedInLinkMap,
} from "~/lib/signed-in-landing-links";
import { Markdown } from "~/app/_components/markdown";
import { LandingSections } from "~/app/_components/landing-sections";
import {
  RichTextBlock,
  ImageBlock,
  ButtonsBlock,
  ColumnsBlock,
} from "~/app/_components/page-blocks";
import { HeaderMenu, HeaderMenuGroup } from "~/app/_components/header-menu";
import {
  ArrowRightIcon,
  BookOpenIcon,
  LayersIcon,
  UsersIcon,
} from "~/app/_components/icons";
import { PublicHeader } from "~/app/_components/public-header";

/**
 * The public landing page body, shared by the live route (`/`) and the admin preview
 * (`/landing-preview`). The page is an ordered list of blocks (see src/server/home/blocks.ts):
 * system blocks (HERO/FEATURES/SECTIONS/NEWS) render the curated pieces edited in their own tabs;
 * content blocks (RICH_TEXT/IMAGE/BUTTONS) render their inline data. In `preview` mode it also pulls
 * in unpublished news + hidden sections (badged) behind a ribbon. The auth redirect for signed-in
 * visitors lives on the `/` route, not here.
 */
export async function LandingView({
  preview = false,
  signedInHeader,
  signedInLinks,
}: {
  preview?: boolean;
  signedInHeader?: ReactNode;
  signedInLinks?: SignedInLinkMap;
}) {
  const activeSignedInLinks = preview ? undefined : signedInLinks;
  const [locale, timeZone] = await Promise.all([getLocale(), getTimeZone()]);
  const [features, overrides, news, sections, layout, navPages, t, tc] =
    await Promise.all([
      getFeatures(db),
      getHomeOverrides(db, locale),
      getLandingNews(db, locale, { includeDrafts: preview }),
      getLandingSections(db, locale, { includeHidden: preview }),
      getLandingLayout(db),
      getNavPages(db, locale),
      getTranslations("landing"),
      getTranslations("common"),
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
  const help = await getTranslations("helpNav");
  const about = getAboutContent(locale);
  const informationItems = [
    { href: "/about", label: about.navTitle, lang: about.lang },
    { href: "/privacy", label: getPrivacyPolicy(locale).title },
    ...navPages
      .filter((page) => page.slug !== "faq" && page.slug !== "about")
      .map((page) => ({
        href: `/p/${page.slug}`,
        label: page.label,
        lang: page.labelLocale,
      })),
    ...(features.VIEWER_SIGNUP
      ? [
          {
            href: "/viewer",
            label: t("nav.viewerSignup"),
            description: t("viewerSignupHelp"),
          },
        ]
      : []),
  ];
  const joinItems = [
    { href: "/tutee", label: t("nav.requestTutor"), strong: true },
    { href: "/tutor", label: t("nav.becomeTutor") },
    ...(features.CREW ? [{ href: "/crew", label: t("nav.becomeCrew") }] : []),
  ];

  // The page owns one primary heading even when editors remove or repeat a hero.
  const primaryHero = layout.find((block) => block.type === "HERO");
  const renderBlock = (block: Block) => {
    switch (block.type) {
      case "HERO":
        return (
          <section className="hero-grid-bg relative overflow-hidden border-b border-slate-200/80 bg-white">
            <div
              aria-hidden="true"
              className="from-accent-50/70 pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b to-transparent"
            />
            <div
              className={`relative mx-auto max-w-5xl px-4 py-14 sm:py-20 lg:py-24 ${
                heroImageId
                  ? "grid items-center gap-10 lg:grid-cols-12"
                  : "text-center"
              }`}
            >
              <div className={heroImageId ? "lg:col-span-7" : "mx-auto max-w-3xl"}>
                <span className="border-accent-200 bg-accent-50 text-accent-800 mb-5 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide">
                  {text("tagline")}
                </span>
                <GradientTitle
                  text={text("heroTitle")}
                  primary={block === primaryHero}
                  centered={!heroImageId}
                />
                <p
                  className={`mt-5 text-base leading-7 text-slate-600 sm:text-lg ${
                    heroImageId ? "max-w-xl" : "mx-auto max-w-2xl"
                  }`}
                >
                  {text("intro")}
                </p>
                <div
                  className={`mt-8 grid max-w-sm grid-cols-1 gap-3 sm:flex sm:max-w-none sm:flex-wrap sm:items-center ${
                    heroImageId ? "" : "mx-auto sm:justify-center"
                  }`}
                >
                  {(() => {
                    const primary = resolveSignedInLink(
                      "/tutee",
                      activeSignedInLinks,
                    );
                    const secondary = resolveSignedInLink(
                      "/tutor",
                      activeSignedInLinks,
                    );
                    return (
                      <>
                        <Link
                          href={primary?.href ?? "/tutee"}
                          className="btn-primary min-h-11"
                        >
                          <span>{primary?.label ?? text("ctaPrimary")}</span>
                          <ArrowRightIcon />
                        </Link>
                        <Link
                          href={secondary?.href ?? "/tutor"}
                          className="btn-secondary min-h-11"
                        >
                          {secondary?.label ?? text("ctaSecondary")}
                        </Link>
                      </>
                    );
                  })()}
                </div>
              </div>
              {heroImageId && (
                <div className="lg:col-span-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/images/${heroImageId}`}
                    alt=""
                    className="h-auto max-h-88 w-full rounded-2xl border border-slate-200 object-cover shadow-md"
                  />
                </div>
              )}
            </div>
          </section>
        );

      case "FEATURES":
        return (
          <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
              <FeatureCard
                icon={<BookOpenIcon />}
                title={text("features.students.title")}
                body={text("features.students.body")}
              />
              <FeatureCard
                icon={<UsersIcon />}
                title={text("features.tutors.title")}
                body={text("features.tutors.body")}
              />
              <FeatureCard
                icon={<LayersIcon />}
                title={text("features.team.title")}
                body={text("features.team.body")}
              />
            </div>
          </section>
        );

      case "SECTIONS":
        if (sections.length === 0) return null;
        return (
          <section className="mx-auto max-w-5xl px-4 py-4">
            <div className="card px-5 py-2 sm:px-6">
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
                signedInLinks={activeSignedInLinks}
              />
            </div>
          </section>
        );

      case "NEWS":
        if (news.length === 0) return null;
        return (
          <section className="mx-auto max-w-5xl px-4 py-8">
            <h2 className="section-title mb-5">{t("news.title")}</h2>
            <ol className="space-y-4">
              {news.map((item) => (
                <li key={item.id} className="card p-5 sm:p-6">
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
                          timeZone,
                        }).format(new Date(item.date))}
                      </time>
                    )}
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    <Markdown signedInLinks={activeSignedInLinks}>
                      {item.body}
                    </Markdown>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );

      case "RICH_TEXT":
        return (
          <RichTextBlock
            block={block}
            locale={locale}
            signedInLinks={activeSignedInLinks}
          />
        );
      case "IMAGE":
        return <ImageBlock block={block} locale={locale} />;
      case "BUTTONS":
        return (
          <ButtonsBlock
            block={block}
            locale={locale}
            signedInLinks={activeSignedInLinks}
          />
        );
      case "COLUMNS":
        return (
          <ColumnsBlock
            block={block}
            locale={locale}
            signedInLinks={activeSignedInLinks}
          />
        );
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      {preview && (
        <PreviewRibbon
          title={t("preview.ribbon.title")}
          note={t("preview.ribbon.note")}
          back={t("preview.ribbon.back")}
        />
      )}

      {signedInHeader ?? (
        <PublicHeader
          skipLabel={tc("skipToContent")}
          trailingAction={
            <HeaderMenuGroup label={t("nav.landmark")}>
              <HeaderMenu
                label={t("nav.signInAndJoin")}
                tone="secondary"
                align="right"
                panelWidth="wide"
                compact
                items={[
                  {
                    href: "/signin",
                    label: t("nav.teamSignin"),
                    strong: true,
                  },
                  ...joinItems.map((item, idx) => ({
                    ...item,
                    strong: false,
                    group: t("nav.joinProgram"),
                    separatorBefore: idx === 0,
                  })),
                  ...informationItems.map((item, idx) => ({
                    ...item,
                    group: t("nav.accessProgramInformation"),
                    separatorBefore: idx === 0,
                  })),
                ]}
              />
            </HeaderMenuGroup>
          }
        />
      )}

      <main id="main-content" className="flex-1">
        {!primaryHero && <h1 className="sr-only">{APP_TITLE}</h1>}
        {layout.map((block) => (
          <div key={block.id}>{renderBlock(block)}</div>
        ))}
      </main>

      <footer className="border-t border-slate-200 py-6">
        <p className="muted text-center text-sm">{text("footer")}</p>
        {/* Keep About, Help Center and privacy notice discoverable even when editors remove landing blocks. */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
          <Link
            href="/about"
            lang={about.lang}
            className="link inline-flex min-h-11 items-center px-3"
          >
            {about.navTitle}
          </Link>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <Link
            href="/help"
            className="link inline-flex min-h-11 items-center px-3"
          >
            {help("title")}
          </Link>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <Link
            href="/privacy"
            className="link inline-flex min-h-11 items-center px-3"
          >
            {getPrivacyPolicy(locale).title}
          </Link>
        </div>
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
function PreviewRibbon({
  title,
  note,
  back,
}: {
  title: string;
  note: string;
  back: string;
}) {
  return (
    // Not sticky: the page's own header is sticky top-0, so the ribbon stays at the very top and
    // scrolls away rather than overlapping it.
    <div className="border-accent-200 bg-accent-600 border-b text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase">
            {title}
          </span>
          <span className="text-white/90">{note}</span>
        </span>
        <Link
          href="/admin/landing"
          className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline"
        >
          {back}
        </Link>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="card hover:border-accent-200 p-5 text-center transition hover:shadow-md sm:p-6 sm:text-left">
      <div className="bg-accent-50 text-accent-700 ring-accent-200/70 mx-auto inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 sm:mx-0">
        {icon}
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-900">{title}</h2>
      <p className="muted mt-1.5 text-sm leading-6">{body}</p>
    </div>
  );
}

function GradientTitle({
  text,
  primary,
  centered = true,
}: {
  text: string;
  primary: boolean;
  centered?: boolean;
}) {
  const Heading = primary ? "h1" : "h2";
  // Stay within accent-800..accent-600 across the whole headline so large text exceeds WCAG AA
  // contrast in every accent theme (including amber, sky and emerald) and across EN/ZH scripts.
  return (
    <Heading
      className={`${centered ? "mx-auto max-w-sm sm:max-w-none" : ""} text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl`}
    >
      <span className="from-accent-800 via-accent-700 to-accent-600 bg-gradient-to-r bg-clip-text text-transparent">
        {text}
      </span>
    </Heading>
  );
}

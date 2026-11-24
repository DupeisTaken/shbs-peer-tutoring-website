import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { db } from "~/server/db";
import { getSectionBySlug } from "~/server/home/sections";
import {
  getCustomPageBySlug,
  getNavPages,
  pageOwnerKey,
} from "~/server/home/pages";
import { getLayout } from "~/server/home/blocks";
import { authorizeHomeEditor } from "~/server/home/images";
import { APP_TITLE } from "~/lib/branding";
import type { LandingEditorView } from "~/lib/landing-editor-view";
import { Markdown } from "~/app/_components/markdown";
import { PageBlocks } from "~/app/_components/page-blocks";
import { HeaderMenu, HeaderMenuGroup } from "~/app/_components/header-menu";
import { PublicHeader } from "~/app/_components/public-header";

/**
 * Public page at /p/<slug>. The slug resolves to either a standalone custom page (a block layout) or
 * a PAGE-mode landing section (markdown) — they share one slug namespace. Unpublished ones are shown
 * only to a landing editor (preview), with a hidden-from-visitors banner.
 */
export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Preserve existing FAQ bookmarks while the maintained catalogue owns help.
  if (slug === "faq") redirect("/help");
  const locale = await getLocale();
  const navPages = await getNavPages(db, locale);

  const page = await getCustomPageBySlug(db, slug, locale);
  if (page) {
    const editorView = await gateUnpublished(page.published);
    const blocks = await getLayout(db, pageOwnerKey(page.id));
    return (
      <Shell
        editorView={editorView ? "pages" : null}
        title={page.title}
        titleLocale={page.titleLocale}
        nav={navPages}
      >
        <PageBlocks blocks={blocks} locale={locale} />
      </Shell>
    );
  }

  const section = await getSectionBySlug(db, slug, locale);
  if (section) {
    const editorView = await gateUnpublished(section.published);
    return (
      <Shell
        editorView={editorView ? "sections" : null}
        title={section.title}
        nav={navPages}
      >
        <article className="mx-auto max-w-3xl px-4 py-12">
          <div className="leading-relaxed text-slate-600">
            <Markdown>{section.body}</Markdown>
          </div>
        </article>
      </Shell>
    );
  }

  notFound();
}

/** Unpublished content is editor-only (returns true to flag the preview banner); else 404. */
async function gateUnpublished(published: boolean): Promise<boolean> {
  if (published) return false;
  const access = await authorizeHomeEditor();
  if (!access.ok) notFound();
  return true;
}

async function Shell({
  editorView,
  title,
  titleLocale,
  nav,
  children,
}: {
  editorView: LandingEditorView | null;
  title: string;
  titleLocale?: string;
  nav: { slug: string; label: string; labelLocale: string | undefined }[];
  children: ReactNode;
}) {
  const [t, tc] = await Promise.all([
    getTranslations("landing"),
    getTranslations("common"),
  ]);
  const help = await getTranslations("helpNav");
  const navItems = nav
    .filter((page) => page.slug !== "faq")
    .map((page) => ({
      href: `/p/${page.slug}`,
      label: page.label,
      lang: page.labelLocale,
    }));
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        skipLabel={tc("skipToContent")}
        navigation={
          <HeaderMenuGroup
            label={t("nav.landmark")}
            className="flex min-w-0 items-center"
          >
            <HeaderMenu
              label={t("nav.accessProgramInformation")}
              items={navItems}
              tone="ghost"
              className="hidden lg:block"
              compact
            />
            <HeaderMenu
              label={t("nav.menu")}
              items={navItems}
              className="lg:hidden"
              panelWidth="wide"
            />
          </HeaderMenuGroup>
        }
      />

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-3xl px-4 pt-12">
          {editorView && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <span className="font-semibold">{t("preview.draftBadge")}</span> ·{" "}
              {t(
                editorView === "pages"
                  ? "detail.hiddenPageNote"
                  : "detail.hiddenNote",
              )}
            </div>
          )}
          <h1 className="page-title" lang={titleLocale}>
            {title}
          </h1>
        </div>
        {children}
        <div className="mx-auto max-w-3xl px-4 pb-12">
          {/* The resolved draft owner selects a fixed editor view, including in a new tab
              without session storage. Published pages keep their public return route. */}
          {editorView ? (
            <Link
              href={
                editorView === "pages"
                  ? "/admin/landing?view=pages"
                  : "/admin/landing?view=sections"
              }
              className="link"
            >
              {t("preview.ribbon.back")}
            </Link>
          ) : (
            <Link href="/" className="link">
              {tc("backToMain")}
            </Link>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <p className="muted text-center text-sm">
          {t("footer", { appTitle: APP_TITLE })}
        </p>
        <p className="mt-2 text-center text-sm">
          <Link
            href="/help"
            className="link inline-flex min-h-11 items-center px-3"
          >
            {help("title")}
          </Link>
        </p>
      </footer>
    </div>
  );
}

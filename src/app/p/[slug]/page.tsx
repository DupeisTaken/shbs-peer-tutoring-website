import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { db } from "~/server/db";
import { getSectionBySlug } from "~/server/home/sections";
import { getCustomPageBySlug, getNavPages, pageOwnerKey } from "~/server/home/pages";
import { getLayout } from "~/server/home/blocks";
import { authorizeHomeEditor } from "~/server/home/images";
import { APP_TITLE } from "~/lib/branding";
import { Markdown } from "~/app/_components/markdown";
import { PageBlocks } from "~/app/_components/page-blocks";
import { NavPageLinks } from "~/app/_components/nav-page-links";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { LanguageSwitcher } from "~/app/_components/language-switcher";

/**
 * Public page at /p/<slug>. The slug resolves to either a standalone custom page (a block layout) or
 * a PAGE-mode landing section (markdown) — they share one slug namespace. Unpublished ones are shown
 * only to a landing editor (preview), with a hidden-from-visitors banner.
 */
export default async function SlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const navPages = await getNavPages(db, locale);

  const page = await getCustomPageBySlug(db, slug, locale);
  if (page) {
    const editorView = await gateUnpublished(page.published);
    const blocks = await getLayout(db, pageOwnerKey(page.id));
    return (
      <Shell editorView={editorView} title={page.title} nav={navPages}>
        <PageBlocks blocks={blocks} locale={locale} />
      </Shell>
    );
  }

  const section = await getSectionBySlug(db, slug, locale);
  if (section) {
    const editorView = await gateUnpublished(section.published);
    return (
      <Shell editorView={editorView} title={section.title} nav={navPages}>
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
  nav,
  children,
}: {
  editorView: boolean;
  title: string;
  nav: { slug: string; label: string }[];
  children: ReactNode;
}) {
  const [t, tc] = await Promise.all([
    getTranslations("landing"),
    getTranslations("common"),
  ]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            className="text-lg font-extrabold tracking-tight whitespace-nowrap text-slate-900"
          >
            {APP_TITLE}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <NavPageLinks pages={nav} />
            <ThemeSwitcher />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 pt-12">
          {editorView && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <span className="font-semibold">{t("preview.draftBadge")}</span> ·{" "}
              {t("detail.hiddenNote")}
            </div>
          )}
          <h1 className="page-title">{title}</h1>
        </div>
        {children}
        <div className="mx-auto max-w-3xl px-4 pb-12">
          {/* When an editor is previewing an unpublished page, wrap back to the landing editor
              rather than the public home. */}
          {editorView ? (
            <Link href="/admin/landing" className="link">
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
        <p className="muted text-center text-sm">{t("footer", { appTitle: APP_TITLE })}</p>
      </footer>
    </div>
  );
}

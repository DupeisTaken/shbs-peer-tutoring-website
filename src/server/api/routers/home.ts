import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, translatorProcedure } from "~/server/api/trpc";
import {
  HOME_FIELDS,
  isHomeFieldKey,
  storageLocale,
} from "~/server/home/content";
import { landingDefault } from "~/server/home/defaults";
import { getLandingLayout, getLayout, layoutSchema } from "~/server/home/blocks";
import { pageOwnerKey } from "~/server/home/pages";

const NEWS_STATUS = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

/** Title → URL slug (lowercase, hyphenated, ASCII-ish). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** A slug used by no other section *or* custom page (they share the /p/<slug> namespace; appends
 *  -2, -3, … on collision). `self` excludes the row being updated from its own table. */
async function ensureUniqueSlug(
  db: Parameters<typeof getLandingLayout>[0],
  base: string,
  self: { sectionId?: string; pageId?: string },
): Promise<string> {
  let candidate = base;
  for (let n = 2; ; n++) {
    const inSection = await db.landingSection.findFirst({
      where: { slug: candidate, ...(self.sectionId ? { id: { not: self.sectionId } } : {}) },
      select: { id: true },
    });
    const inPage = await db.customPage.findFirst({
      where: { slug: candidate, ...(self.pageId ? { id: { not: self.pageId } } : {}) },
      select: { id: true },
    });
    if (!inSection && !inPage) return candidate;
    candidate = `${base}-${n}`;
  }
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Owner of a block layout: the landing page, or a custom page by id. */
const ownerInput = z.string().regex(/^(landing|page:[a-z0-9]+)$/);

/**
 * Editor API for the public landing page (/admin/landing). Gated by `translatorProcedure`
 * (elevated staff or a `canTranslate` user). Public rendering does NOT go through here — the
 * landing server component reads `src/server/home/{content,news}.ts` directly. Image upload is a
 * route handler (`/api/admin/home-images`); listing/deleting images lives here.
 */
export const homeRouter = createTRPCRouter({
  // ---- Fixed text slots -----------------------------------------------------

  /** Every landing slot for a locale: its bundled default + the current override (if any). */
  content: translatorProcedure
    .input(z.object({ locale: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.homeContent.findMany({
        where: { locale: { in: Array.from(new Set([input.locale, "en"])) } },
        select: { key: true, locale: true, value: true },
      });
      return HOME_FIELDS.map((field) => {
        const want = storageLocale(field.key, input.locale);
        const override =
          rows.find((r) => r.key === field.key && r.locale === want)?.value ?? null;
        return {
          key: field.key,
          kind: field.kind,
          global: Boolean(field.global),
          hasAppTitle: Boolean(field.hasAppTitle),
          default: field.kind === "image" ? null : landingDefault(input.locale, field.key),
          override,
        };
      });
    }),

  /** Set an override; blank — or text equal to the bundled default — clears it (revert). */
  setContent: translatorProcedure
    .input(
      z.object({
        locale: z.string().min(1),
        key: z.string().min(1),
        value: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isHomeFieldKey(input.key)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown content key." });
      }
      const locale = storageLocale(input.key, input.locale);
      const value = input.value;
      const def = landingDefault(input.locale, input.key);
      if (!value.trim() || value === def) {
        await ctx.db.homeContent.deleteMany({ where: { key: input.key, locale } });
        return { ok: true, cleared: true };
      }
      await ctx.db.homeContent.upsert({
        where: { key_locale: { key: input.key, locale } },
        update: { value, updatedByName: ctx.session.user.name },
        create: { key: input.key, locale, value, updatedByName: ctx.session.user.name },
      });
      return { ok: true, cleared: false };
    }),

  // ---- Program news ---------------------------------------------------------

  /** All posts (any status) with their translations, for the admin list. */
  news: translatorProcedure.query(async ({ ctx }) => {
    const posts = await ctx.db.newsPost.findMany({
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        pinned: true,
        publishedAt: true,
        createdByName: true,
        createdAt: true,
        updatedAt: true,
        translations: { select: { locale: true, title: true, body: true } },
      },
    });
    return posts;
  }),

  /** Create a draft post with its required English translation. */
  createNews: translatorProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.db.newsPost.create({
        data: {
          createdByName: ctx.session.user.name,
          translations: {
            create: { locale: "en", title: input.title, body: input.body },
          },
        },
        select: { id: true },
      });
      return post;
    }),

  /** Update lifecycle / ordering / date. Publishing stamps the date if not already set. */
  updateNews: translatorProcedure
    .input(
      z.object({
        id: z.string(),
        status: NEWS_STATUS.optional(),
        pinned: z.boolean().optional(),
        // Date string (yyyy-mm-dd or ISO) or null to clear.
        publishedAt: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.db.newsPost.findUnique({
        where: { id: input.id },
        select: { status: true, publishedAt: true },
      });
      if (!post) throw new TRPCError({ code: "NOT_FOUND" });

      const data: {
        status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
        pinned?: boolean;
        publishedAt?: Date | null;
      } = {};
      if (input.status) data.status = input.status;
      if (input.pinned !== undefined) data.pinned = input.pinned;
      if (input.publishedAt !== undefined) {
        data.publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
      }
      // Stamp a publish date the first time it goes live and none was given.
      if (input.status === "PUBLISHED" && !post.publishedAt && data.publishedAt === undefined) {
        data.publishedAt = new Date();
      }
      await ctx.db.newsPost.update({ where: { id: input.id }, data });
      return { ok: true };
    }),

  /** Add or edit one locale's title + body. */
  setNewsTranslation: translatorProcedure
    .input(
      z.object({
        postId: z.string(),
        locale: z.string().trim().min(2),
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.newsTranslation.upsert({
        where: { postId_locale: { postId: input.postId, locale: input.locale } },
        update: { title: input.title, body: input.body },
        create: {
          postId: input.postId,
          locale: input.locale,
          title: input.title,
          body: input.body,
        },
      });
      return { ok: true };
    }),

  /** Remove a translation. The `en` fallback can't be removed. */
  removeNewsTranslation: translatorProcedure
    .input(z.object({ postId: z.string(), locale: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.locale === "en") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The English version is the fallback and can't be removed.",
        });
      }
      await ctx.db.newsTranslation.deleteMany({
        where: { postId: input.postId, locale: input.locale },
      });
      return { ok: true };
    }),

  /** Hard-delete a post (and its translations). Archiving via updateNews is the reversible default. */
  deleteNews: translatorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.newsPost.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ---- Image library --------------------------------------------------------

  /** Uploaded images (metadata only — bytes are served from /api/images/[id]). */
  images: translatorProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.homeImage.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        alt: true,
        mimeType: true,
        byteSize: true,
        createdByName: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, url: `/api/images/${r.id}` }));
  }),

  setImageAlt: translatorProcedure
    .input(z.object({ id: z.string(), alt: z.string().max(300) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.homeImage.update({
        where: { id: input.id },
        data: { alt: input.alt.trim() || null },
      });
      return { ok: true };
    }),

  deleteImage: translatorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.homeImage.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ---- Expandable landing sections (accordion panels) -----------------------

  /** All sections (any visibility) in display order, with their translations, for the admin list. */
  sections: translatorProcedure.query(async ({ ctx }) => {
    return ctx.db.landingSection.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        sortOrder: true,
        published: true,
        openByDefault: true,
        mode: true,
        slug: true,
        createdByName: true,
        createdAt: true,
        updatedAt: true,
        translations: { select: { locale: true, title: true, body: true } },
      },
    });
  }),

  /** Create a hidden section with its required English translation, appended to the end. */
  createSection: translatorProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const max = await ctx.db.landingSection.aggregate({ _max: { sortOrder: true } });
      const section = await ctx.db.landingSection.create({
        data: {
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          createdByName: ctx.session.user.name,
          translations: { create: { locale: "en", title: input.title, body: input.body } },
        },
        select: { id: true },
      });
      return section;
    }),

  /** Toggle visibility / expanded-by-default / inline-vs-page mode (+ its detail-page slug). */
  updateSection: translatorProcedure
    .input(
      z.object({
        id: z.string(),
        published: z.boolean().optional(),
        openByDefault: z.boolean().optional(),
        mode: z.enum(["INLINE", "PAGE"]).optional(),
        // Lowercase letters/digits/hyphens; blank lets the server derive one from the title.
        slug: z
          .string()
          .trim()
          .max(60)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.")
          .or(z.literal(""))
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data: {
        published?: boolean;
        openByDefault?: boolean;
        mode?: "INLINE" | "PAGE";
        slug?: string;
      } = {};
      if (input.published !== undefined) data.published = input.published;
      if (input.openByDefault !== undefined) data.openByDefault = input.openByDefault;
      if (input.mode !== undefined) data.mode = input.mode;

      const current = await ctx.db.landingSection.findUnique({
        where: { id: input.id },
        select: { slug: true, mode: true, translations: { select: { locale: true, title: true } } },
      });
      if (!current) throw new TRPCError({ code: "NOT_FOUND" });

      const goingToPage = (input.mode ?? current.mode) === "PAGE";
      // An explicit slug wins; otherwise a PAGE section without one gets a slug derived from its title.
      let desiredSlug: string | undefined;
      if (input.slug) desiredSlug = input.slug;
      else if (goingToPage && !current.slug) {
        const enTitle =
          current.translations.find((tr) => tr.locale === "en")?.title ??
          current.translations[0]?.title ??
          "section";
        desiredSlug = slugify(enTitle) || "section";
      }
      if (desiredSlug) {
        data.slug = await ensureUniqueSlug(ctx.db, desiredSlug, { sectionId: input.id });
      }

      await ctx.db.landingSection.update({ where: { id: input.id }, data });
      return { ok: true };
    }),

  /** Persist a new display order (ids in the desired order). */
  reorderSections: translatorProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(
        input.ids.map((id, i) =>
          ctx.db.landingSection.update({ where: { id }, data: { sortOrder: i } }),
        ),
      );
      return { ok: true };
    }),

  setSectionTranslation: translatorProcedure
    .input(
      z.object({
        sectionId: z.string(),
        locale: z.string().trim().min(2),
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.landingSectionTranslation.upsert({
        where: { sectionId_locale: { sectionId: input.sectionId, locale: input.locale } },
        update: { title: input.title, body: input.body },
        create: {
          sectionId: input.sectionId,
          locale: input.locale,
          title: input.title,
          body: input.body,
        },
      });
      return { ok: true };
    }),

  removeSectionTranslation: translatorProcedure
    .input(z.object({ sectionId: z.string(), locale: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.locale === "en") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The English version is the fallback and can't be removed.",
        });
      }
      await ctx.db.landingSectionTranslation.deleteMany({
        where: { sectionId: input.sectionId, locale: input.locale },
      });
      return { ok: true };
    }),

  deleteSection: translatorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.landingSection.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ---- Block layout (landing page or a custom page) -------------------------

  /** A container's block layout. "landing" falls back to the default page; a page to an empty list. */
  layout: translatorProcedure
    .input(z.object({ owner: ownerInput.default("landing") }))
    .query(({ ctx, input }) =>
      input.owner === "landing" ? getLandingLayout(ctx.db) : getLayout(ctx.db, input.owner),
    ),

  /** Persist the whole block array for a container (one document). First save creates the row. */
  setLayout: translatorProcedure
    .input(z.object({ owner: ownerInput, blocks: layoutSchema }))
    .mutation(async ({ ctx, input }) => {
      const blocks = input.blocks as object;
      await ctx.db.pageLayout.upsert({
        where: { ownerKey: input.owner },
        update: { blocks, updatedByName: ctx.session.user.name },
        create: { ownerKey: input.owner, blocks, updatedByName: ctx.session.user.name },
      });
      return { ok: true };
    }),

  // ---- Custom pages (standalone /p/<slug> pages) ----------------------------

  /** All custom pages (any visibility), in nav order, for the admin list. */
  pages: translatorProcedure.query(({ ctx }) =>
    ctx.db.customPage.findMany({
      orderBy: [{ navOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        published: true,
        showInNav: true,
        navOrder: true,
        createdByName: true,
        updatedAt: true,
      },
    }),
  ),

  /** Create an unpublished page with an English title and a slug derived from it. */
  createPage: translatorProcedure
    .input(z.object({ title: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const slug = await ensureUniqueSlug(ctx.db, slugify(input.title) || "page", {});
      const max = await ctx.db.customPage.aggregate({ _max: { navOrder: true } });
      const page = await ctx.db.customPage.create({
        data: {
          slug,
          title: { en: input.title },
          navOrder: (max._max.navOrder ?? 0) + 1,
          createdByName: ctx.session.user.name,
        },
        select: { id: true },
      });
      return page;
    }),

  /** Update a page's flags / slug / nav order. */
  updatePage: translatorProcedure
    .input(
      z.object({
        id: z.string(),
        published: z.boolean().optional(),
        showInNav: z.boolean().optional(),
        navOrder: z.number().int().optional(),
        slug: z.string().trim().max(60).regex(SLUG_RE, "Use lowercase letters, numbers and hyphens.").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data: {
        published?: boolean;
        showInNav?: boolean;
        navOrder?: number;
        slug?: string;
      } = {};
      if (input.published !== undefined) data.published = input.published;
      if (input.showInNav !== undefined) data.showInNav = input.showInNav;
      if (input.navOrder !== undefined) data.navOrder = input.navOrder;
      if (input.slug) data.slug = await ensureUniqueSlug(ctx.db, input.slug, { pageId: input.id });
      await ctx.db.customPage.update({ where: { id: input.id }, data });
      return { ok: true };
    }),

  /** Set one locale of a page's title (blank clears it; en is the fallback). */
  setPageTitle: translatorProcedure
    .input(z.object({ id: z.string(), locale: z.string().min(2), value: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.db.customPage.findUnique({
        where: { id: input.id },
        select: { title: true },
      });
      if (!page) throw new TRPCError({ code: "NOT_FOUND" });
      const title = { ...(page.title as Record<string, string>) };
      if (input.value.trim()) title[input.locale] = input.value.trim();
      else delete title[input.locale];
      await ctx.db.customPage.update({ where: { id: input.id }, data: { title } });
      return { ok: true };
    }),

  /** Persist page order (ids in the desired order) — drives nav order. */
  reorderPages: translatorProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(
        input.ids.map((id, i) =>
          ctx.db.customPage.update({ where: { id }, data: { navOrder: i } }),
        ),
      );
      return { ok: true };
    }),

  /** Delete a page and its block layout. */
  deletePage: translatorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.pageLayout.deleteMany({ where: { ownerKey: pageOwnerKey(input.id) } });
      await ctx.db.customPage.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { Markdown } from "~/app/_components/markdown";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialog } from "~/app/_components/confirm-dialog";
import {
  type Block,
  type LeafBlock,
  CONTENT_BLOCK_TYPES,
  SYSTEM_BLOCK_TYPES,
  isSystemBlock,
} from "~/lib/page-blocks";

/**
 * Editor for the public landing page (/). Three tabs: the fixed text slots (hero, CTAs, feature
 * cards), the program-news feed, and the uploaded-image library. All writes go through the `home`
 * router (translatorProcedure); image upload posts to /api/admin/home-images. Edits are live —
 * no redeploy — because the landing renderer reads the same DB rows.
 */

type Tab = "layout" | "content" | "sections" | "pages" | "news" | "images";

type ImageInfo = {
  id: string;
  url: string;
  alt: string | null;
  mimeType: string;
  byteSize: number;
  createdByName: string | null;
  createdAt: Date;
};

/** field.key → the leaf under admin.landing.fields.* */
const FIELD_LABEL: Record<string, string> = {
  tagline: "tagline",
  heroTitle: "heroTitle",
  intro: "intro",
  ctaPrimary: "ctaPrimary",
  ctaSecondary: "ctaSecondary",
  heroImageId: "heroImage",
  "features.students.title": "studentsTitle",
  "features.students.body": "studentsBody",
  "features.tutors.title": "tutorsTitle",
  "features.tutors.body": "tutorsBody",
  "features.team.title": "teamTitle",
  "features.team.body": "teamBody",
  footer: "footer",
};

export default function LandingAdminPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const [tab, setTab] = useState<Tab>("layout");
  const images = api.home.images.useQuery();

  // Order groups the landing-page surfaces (layout → content → sections → news) ahead of standalone
  // pages and the shared image library. Each tab carries a one-line description shown below the bar.
  const tabs: { key: Tab; label: string; desc: string }[] = [
    { key: "layout", label: t("admin.landing.tabs.layout"), desc: t("admin.landing.tabDesc.layout") },
    { key: "content", label: t("admin.landing.tabs.content"), desc: t("admin.landing.tabDesc.content") },
    { key: "sections", label: t("admin.landing.tabs.sections"), desc: t("admin.landing.tabDesc.sections") },
    { key: "news", label: t("admin.landing.tabs.news"), desc: t("admin.landing.tabDesc.news") },
    { key: "pages", label: t("admin.landing.tabs.pages"), desc: t("admin.landing.tabDesc.pages") },
    { key: "images", label: t("admin.landing.tabs.images"), desc: t("admin.landing.tabDesc.images") },
  ];
  const activeDesc = tabs.find((tb) => tb.key === tab)?.desc;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{t("admin.landing.title")}</h1>
          <p className="muted mt-1">{t("admin.landing.subtitle")}</p>
        </div>
        {/* Opens the real landing page (drafts + hidden sections shown) in a new tab. */}
        <a
          href="/landing-preview"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary btn-sm shrink-0"
        >
          {t("admin.landing.preview.button")} ↗
        </a>
      </div>

      <div>
        <div className="flex flex-wrap gap-2 border-b border-slate-200">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === tb.key
                  ? "border-accent-500 text-accent-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        {activeDesc && <p className="muted mt-2 text-sm">{activeDesc}</p>}
      </div>

      {tab === "layout" && <LayoutEditor images={images.data ?? []} readOnly={readOnly} />}
      {tab === "content" && (
        <ContentEditor images={images.data ?? []} readOnly={readOnly} />
      )}
      {tab === "sections" && <SectionsManager images={images.data ?? []} readOnly={readOnly} />}
      {tab === "pages" && <PagesManager images={images.data ?? []} readOnly={readOnly} />}
      {tab === "news" && <NewsManager images={images.data ?? []} readOnly={readOnly} />}
      {tab === "images" && (
        <ImageLibrary
          images={images.data ?? []}
          loading={images.isLoading}
          readOnly={readOnly}
          onChanged={() => images.refetch()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — fixed text slots
// ---------------------------------------------------------------------------

/**
 * The fixed slots, grouped so the editor mirrors the page's anatomy (top → bottom) rather than a
 * flat field dump. Keys map to HOME_FIELDS in src/server/home/content.ts.
 */
const CONTENT_GROUPS: { key: string; fields: string[] }[] = [
  { key: "hero", fields: ["tagline", "heroTitle", "intro", "heroImageId"] },
  { key: "buttons", fields: ["ctaPrimary", "ctaSecondary"] },
  {
    key: "features",
    fields: [
      "features.students.title",
      "features.students.body",
      "features.tutors.title",
      "features.tutors.body",
      "features.team.title",
      "features.team.body",
    ],
  },
  { key: "footer", fields: ["footer"] },
];

function ContentEditor({ images, readOnly }: { images: ImageInfo[]; readOnly: boolean }) {
  const t = useTranslations();
  const languages = api.i18n.languages.useQuery();
  const [locale, setLocale] = useState("en");
  const content = api.home.content.useQuery({ locale });
  const utils = api.useUtils();
  const refresh = () => {
    void utils.home.content.invalidate({ locale });
  };

  const byKey = new Map((content.data ?? []).map((f) => [f.key, f]));

  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2 text-sm">
        <span className="muted">{t("common.language")}</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          className="select field-auto min-w-32"
        >
          {(languages.data ?? []).map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
              {l.code === "en" ? ` (${t("admin.landing.defaultLang")})` : ""}
            </option>
          ))}
        </select>
      </label>

      {content.isLoading && <p className="muted text-sm">{t("admin.landing.loading")}</p>}

      {!content.isLoading &&
        CONTENT_GROUPS.map((group) => (
          <section key={group.key} className="card p-5">
            <h2 className="section-title">{t(`admin.landing.groups.${group.key}.title`)}</h2>
            <p className="muted mt-0.5 mb-3 text-sm">
              {t(`admin.landing.groups.${group.key}.desc`)}
            </p>
            <div className="divide-y divide-slate-100">
              {group.fields.map((key) => {
                const field = byKey.get(key);
                if (!field) return null;
                return field.kind === "image" ? (
                  <ImageSlotField
                    key={key + locale}
                    locale={locale}
                    field={field}
                    images={images}
                    readOnly={readOnly}
                    onSaved={refresh}
                  />
                ) : (
                  <ContentField
                    key={key + locale}
                    locale={locale}
                    field={field}
                    readOnly={readOnly}
                    onSaved={refresh}
                  />
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}

type ContentFieldData = {
  key: string;
  kind: "line" | "multiline" | "image";
  global: boolean;
  hasAppTitle: boolean;
  default: string | null;
  override: string | null;
};

function ContentField({
  locale,
  field,
  readOnly,
  onSaved,
}: {
  locale: string;
  field: ContentFieldData;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const baseline = field.override ?? field.default ?? "";
  const [value, setValue] = useState(baseline);
  const save = api.home.setContent.useMutation({ onSuccess: onSaved });
  const dirty = value !== baseline;
  const label = t(`admin.landing.fields.${FIELD_LABEL[field.key] ?? field.key}`);

  return (
    <div className="py-4 first:pt-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="label">{label}</label>
        <span className={field.override != null ? "badge-amber" : "badge-slate"}>
          {field.override != null
            ? t("admin.landing.badge.custom")
            : t("admin.landing.badge.default")}
        </span>
      </div>
      {field.kind === "multiline" ? (
        <textarea
          className="textarea w-full"
          rows={3}
          value={value}
          readOnly={readOnly}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.default ?? ""}
        />
      ) : (
        <input
          className="input w-full"
          value={value}
          readOnly={readOnly}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.default ?? ""}
        />
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {field.hasAppTitle && (
          // The hint literally shows the `{appTitle}` token, but ICU reads it as a required
          // variable — feed it the literal string so it renders verbatim instead of throwing.
          <span className="muted text-xs">
            {t("admin.landing.appTitleHint", { appTitle: "{appTitle}" })}
          </span>
        )}
        {!readOnly && (
          <div className="ml-auto flex items-center gap-3">
            {save.error && <span className="text-xs text-red-600">{save.error.message}</span>}
            {field.override != null && (
              <button
                type="button"
                className="link text-xs"
                disabled={save.isPending}
                onClick={() => {
                  setValue(field.default ?? "");
                  save.mutate({ locale, key: field.key, value: "" });
                }}
              >
                {t("admin.landing.revert")}
              </button>
            )}
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ locale, key: field.key, value })}
            >
              {t("common.save")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The hero-image slot: pick from the uploaded library (stored globally, locale-agnostic). */
function ImageSlotField({
  locale,
  field,
  images,
  readOnly,
  onSaved,
}: {
  locale: string;
  field: ContentFieldData;
  images: ImageInfo[];
  readOnly: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const save = api.home.setContent.useMutation({ onSuccess: onSaved });
  const current = field.override;
  const label = t(`admin.landing.fields.${FIELD_LABEL[field.key] ?? field.key}`);

  return (
    <div className="py-4 first:pt-0">
      <label className="label">{label}</label>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${current}`}
            alt=""
            className="h-20 w-32 rounded-md border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-20 w-32 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
            {t("admin.landing.content.heroImage.none")}
          </div>
        )}
        {!readOnly && (
          <div className="flex flex-col gap-2">
            <select
              className="select field-auto min-w-44"
              value={current ?? ""}
              onChange={(e) => save.mutate({ locale, key: field.key, value: e.target.value })}
            >
              <option value="">{t("admin.landing.content.heroImage.choose")}</option>
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.alt ?? img.id.slice(0, 8)}
                </option>
              ))}
            </select>
            {images.length === 0 && (
              <span className="muted text-xs">{t("admin.landing.content.heroImage.uploadFirst")}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — program news
// ---------------------------------------------------------------------------

type TranslationRow = { locale: string; title: string; body: string };
type NewsPostRow = {
  id: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  pinned: boolean;
  publishedAt: Date | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  translations: TranslationRow[];
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "badge-slate",
  PUBLISHED: "badge-green",
  ARCHIVED: "badge-amber",
};

function NewsManager({ images, readOnly }: { images: ImageInfo[]; readOnly: boolean }) {
  const t = useTranslations();
  const news = api.home.news.useQuery();
  const utils = api.useUtils();
  const refresh = () => {
    void utils.home.news.invalidate();
  };

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const create = api.home.createNews.useMutation({
    onSuccess: () => {
      setTitle("");
      setBody("");
      refresh();
    },
  });

  return (
    <div className="space-y-5">
      {!readOnly && (
        <section className="card space-y-3 p-5">
          <h2 className="section-title">{t("admin.landing.news.new.title")}</h2>
          <input
            className="input w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("admin.landing.news.new.titlePlaceholder")}
          />
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("admin.landing.news.new.bodyPlaceholder")}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate({ title: title.trim(), body })}
            >
              {t("admin.landing.news.new.create")}
            </button>
            {create.error && <span className="text-sm text-red-600">{create.error.message}</span>}
          </div>
        </section>
      )}

      {news.isLoading && <p className="muted text-sm">{t("admin.landing.loading")}</p>}
      {!news.isLoading && (news.data ?? []).length === 0 && (
        <p className="muted text-sm">{t("admin.landing.news.empty")}</p>
      )}
      {(news.data ?? []).map((post) => (
        <NewsPostCard
          key={post.id}
          post={post}
          images={images}
          readOnly={readOnly}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

function NewsPostCard({
  post,
  images,
  readOnly,
  onChanged,
}: {
  post: NewsPostRow;
  images: ImageInfo[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const update = api.home.updateNews.useMutation({ onSuccess: onChanged });
  const del = api.home.deleteNews.useMutation({ onSuccess: onChanged });
  const saveTr = api.home.setNewsTranslation.useMutation({ onSuccess: onChanged });
  const removeTr = api.home.removeNewsTranslation.useMutation({ onSuccess: onChanged });

  const en = post.translations.find((tr) => tr.locale === "en");
  const heading = en?.title ?? post.translations[0]?.title ?? t("admin.landing.news.untitled");
  const dateValue = post.publishedAt
    ? new Date(post.publishedAt).toISOString().slice(0, 10)
    : "";

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
            <span className={STATUS_BADGE[post.status]}>
              {t(`admin.landing.news.status.${post.status}`)}
            </span>
            {post.pinned && <span className="badge-slate">{t("admin.landing.news.pinnedBadge")}</span>}
          </div>
          {post.createdByName && (
            <p className="muted mt-1 text-xs">
              {t("admin.landing.news.byline", { who: post.createdByName })}
            </p>
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {post.status !== "PUBLISHED" && (
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: post.id, status: "PUBLISHED" })}
              >
                {t("admin.landing.news.actions.publish")}
              </button>
            )}
            {post.status === "PUBLISHED" && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: post.id, status: "DRAFT" })}
              >
                {t("admin.landing.news.actions.unpublish")}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: post.id, pinned: !post.pinned })}
            >
              {post.pinned
                ? t("admin.landing.news.actions.unpin")
                : t("admin.landing.news.actions.pin")}
            </button>
            {post.status !== "ARCHIVED" ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: post.id, status: "ARCHIVED" })}
              >
                {t("admin.landing.news.actions.archive")}
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: post.id, status: "DRAFT" })}
              >
                {t("admin.landing.news.actions.restore")}
              </button>
            )}
            <button
              type="button"
              className="link-danger text-xs"
              disabled={del.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.landing.news.actions.confirmDelete"),
                    confirmLabel: t("common.delete"),
                    cancelLabel: t("common.cancel"),
                    danger: true,
                  })
                )
                  del.mutate({ id: post.id });
              }}
            >
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>

      {!readOnly && (
        <label className="flex items-center gap-2 text-sm">
          <span className="muted">{t("admin.landing.news.dateLabel")}</span>
          <input
            type="date"
            className="input field-auto"
            defaultValue={dateValue}
            onChange={(e) =>
              update.mutate({ id: post.id, publishedAt: e.target.value || null })
            }
          />
        </label>
      )}

      <LocalizedTranslations
        translations={post.translations}
        images={images}
        readOnly={readOnly}
        onSave={(locale, title, body) => saveTr.mutate({ postId: post.id, locale, title, body })}
        saving={saveTr.isPending}
        saveError={saveTr.error?.message}
        onRemove={(locale, done) =>
          removeTr.mutate({ postId: post.id, locale }, { onSuccess: done })
        }
        removing={removeTr.isPending}
      />
      {dialog}
    </section>
  );
}

/**
 * Per-locale title + markdown body editor shared by news posts and landing sections. The language
 * picker offers `en` (the fallback) plus any added languages; the parent owns the save/remove
 * mutations so the same UI drives different routers.
 */
function LocalizedTranslations({
  translations,
  images,
  readOnly,
  onSave,
  saving,
  saveError,
  onRemove,
  removing,
}: {
  translations: TranslationRow[];
  images: ImageInfo[];
  readOnly: boolean;
  onSave: (locale: string, title: string, body: string) => void;
  saving: boolean;
  saveError: string | undefined;
  onRemove: (locale: string, done: () => void) => void;
  removing: boolean;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const languages = api.i18n.languages.useQuery();
  const langs = useMemo(
    () => (languages.data ?? []).map((l) => ({ code: l.code, label: l.label })),
    [languages.data],
  );
  const byLocale = useMemo(
    () => new Map(translations.map((tr) => [tr.locale, tr])),
    [translations],
  );
  const codes = langs.map((l) => l.code);
  const labelFor = (c: string) => langs.find((l) => l.code === c)?.label ?? c;

  const existing = [
    "en",
    ...codes.filter((c) => c !== "en" && byLocale.has(c)),
    ...[...byLocale.keys()].filter((c) => c !== "en" && !codes.includes(c)),
  ];
  const [drafts, setDrafts] = useState<string[]>([]);
  const available = [...existing, ...drafts.filter((d) => !existing.includes(d))];
  const notAdded = codes.filter((c) => !available.includes(c));
  const [active, setActive] = useState("en");
  const isDraft = !byLocale.has(active);

  return (
    <div className="border-t border-slate-100 pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="muted text-sm">{t("admin.landing.translation.language")}</span>
        <select
          value={active}
          onChange={(e) => setActive(e.target.value)}
          className="select field-auto min-w-32"
        >
          {available.map((c) => (
            <option key={c} value={c}>
              {labelFor(c)}
              {c === "en" ? ` (${t("admin.landing.defaultLang")})` : ""}
            </option>
          ))}
        </select>
        {!readOnly && notAdded.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const c = e.target.value;
              if (!c) return;
              setDrafts((d) => [...d, c]);
              setActive(c);
            }}
            className="select field-auto min-w-40"
          >
            <option value="">{t("admin.landing.translation.add")}</option>
            {notAdded.map((c) => (
              <option key={c} value={c}>
                {labelFor(c)}
              </option>
            ))}
          </select>
        )}
      </div>

      <LocalizedBodyEditor
        key={active}
        locale={active}
        row={byLocale.get(active)}
        images={images}
        readOnly={readOnly}
        onSave={onSave}
        saving={saving}
        saveError={saveError}
      />

      {!readOnly && active !== "en" && (
        <div className="mt-2">
          {isDraft ? (
            <button
              type="button"
              className="link text-xs"
              onClick={() => {
                setDrafts((d) => d.filter((x) => x !== active));
                setActive("en");
              }}
            >
              {t("admin.landing.translation.discard")}
            </button>
          ) : (
            <button
              type="button"
              className="link-danger text-xs"
              disabled={removing}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.landing.translation.confirmRemove", {
                      lang: labelFor(active),
                    }),
                    confirmLabel: t("common.delete"),
                    cancelLabel: t("common.cancel"),
                    danger: true,
                  })
                )
                  onRemove(active, () => setActive("en"));
              }}
            >
              {t("admin.landing.translation.remove")}
            </button>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

function LocalizedBodyEditor({
  locale,
  row,
  images,
  readOnly,
  onSave,
  saving,
  saveError,
}: {
  locale: string;
  row: TranslationRow | undefined;
  images: ImageInfo[];
  readOnly: boolean;
  onSave: (locale: string, title: string, body: string) => void;
  saving: boolean;
  saveError: string | undefined;
}) {
  const t = useTranslations();
  const [title, setTitle] = useState(row?.title ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = title !== (row?.title ?? "") || body !== (row?.body ?? "");

  const insertImage = (img: ImageInfo) => {
    const snippet = `![${img.alt ?? ""}](${img.url})`;
    const el = bodyRef.current;
    if (el && typeof el.selectionStart === "number") {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      setBody(body.slice(0, start) + snippet + body.slice(end));
    } else {
      setBody(body ? `${body}\n\n${snippet}` : snippet);
    }
  };

  return (
    <div className="space-y-2">
      <input
        className="input w-full font-semibold"
        value={title}
        readOnly={readOnly}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("admin.landing.translation.titlePlaceholder")}
      />
      {preview ? (
        <div className="min-h-[6rem] rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
          {body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <span className="muted">{t("admin.landing.translation.previewEmpty")}</span>
          )}
        </div>
      ) : (
        <textarea
          ref={bodyRef}
          className="textarea w-full font-mono text-xs"
          rows={6}
          value={body}
          readOnly={readOnly}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("admin.landing.translation.bodyPlaceholder")}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="link text-xs" onClick={() => setPreview((v) => !v)}>
          {preview ? t("admin.landing.translation.edit") : t("admin.landing.translation.preview")}
        </button>
        {!readOnly && images.length > 0 && !preview && (
          <select
            value=""
            onChange={(e) => {
              const img = images.find((i) => i.id === e.target.value);
              if (img) insertImage(img);
            }}
            className="select field-auto min-w-40 text-xs"
          >
            <option value="">{t("admin.landing.translation.insertImage")}</option>
            {images.map((img) => (
              <option key={img.id} value={img.id}>
                {img.alt ?? img.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
        {!readOnly && (
          <div className="ml-auto flex items-center gap-3">
            {saveError && <span className="text-xs text-red-600">{saveError}</span>}
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!dirty || !title.trim() || saving}
              onClick={() => onSave(locale, title.trim(), body)}
            >
              {t("common.save")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — image library
// ---------------------------------------------------------------------------

function ImageLibrary({
  images,
  loading,
  readOnly,
  onChanged,
}: {
  images: ImageInfo[];
  loading: boolean;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const del = api.home.deleteImage.useMutation({ onSuccess: onChanged });

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (alt.trim()) form.append("alt", alt.trim());
      const res = await fetch("/api/admin/home-images", { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? t("admin.landing.images.uploadFailed"));
      }
      if (fileRef.current) fileRef.current.value = "";
      setAlt("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.landing.images.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const copy = (text: string, id: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  return (
    <div className="space-y-5">
      {!readOnly && (
        <section className="card space-y-3 p-5">
          <h2 className="section-title">{t("admin.landing.images.upload.title")}</h2>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="block text-sm"
          />
          <input
            className="input w-full"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={t("admin.landing.images.upload.altPlaceholder")}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={uploading}
              onClick={upload}
            >
              {uploading
                ? t("admin.landing.images.upload.uploading")
                : t("admin.landing.images.upload.button")}
            </button>
            <span className="muted text-xs">{t("admin.landing.images.upload.hint")}</span>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </section>
      )}

      {loading && <p className="muted text-sm">{t("admin.landing.loading")}</p>}
      {!loading && images.length === 0 && (
        <p className="muted text-sm">{t("admin.landing.images.empty")}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((img) => (
          <div key={img.id} className="card space-y-2 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.alt ?? ""}
              className="h-36 w-full rounded-md border border-slate-200 object-cover"
            />
            <p className="truncate text-xs text-slate-600">{img.alt ?? img.id.slice(0, 8)}</p>
            <p className="muted text-[11px]">
              {Math.max(1, Math.round(img.byteSize / 1024))} KB
              {img.createdByName ? ` · ${img.createdByName}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="link text-xs"
                onClick={() => copy(img.url, `u-${img.id}`)}
              >
                {copied === `u-${img.id}`
                  ? t("admin.landing.images.copied")
                  : t("admin.landing.images.copyUrl")}
              </button>
              <button
                type="button"
                className="link text-xs"
                onClick={() => copy(`![${img.alt ?? ""}](${img.url})`, `m-${img.id}`)}
              >
                {copied === `m-${img.id}`
                  ? t("admin.landing.images.copied")
                  : t("admin.landing.images.copyMarkdown")}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className="link-danger ml-auto text-xs"
                  disabled={del.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t("admin.landing.images.confirmDelete"),
                        confirmLabel: t("common.delete"),
                        cancelLabel: t("common.cancel"),
                        danger: true,
                      })
                    )
                      del.mutate({ id: img.id });
                  }}
                >
                  {t("common.delete")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {dialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — expandable sections (accordion panels)
// ---------------------------------------------------------------------------

type SectionRow = {
  id: string;
  sortOrder: number;
  published: boolean;
  openByDefault: boolean;
  mode: "INLINE" | "PAGE";
  slug: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  translations: TranslationRow[];
};

function SectionsManager({ images, readOnly }: { images: ImageInfo[]; readOnly: boolean }) {
  const t = useTranslations();
  const sections = api.home.sections.useQuery();
  const utils = api.useUtils();
  const refresh = () => {
    void utils.home.sections.invalidate();
  };

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const create = api.home.createSection.useMutation({
    onSuccess: () => {
      setTitle("");
      setBody("");
      refresh();
    },
  });
  const reorder = api.home.reorderSections.useMutation({ onSuccess: refresh });

  const list = (sections.data ?? []) as SectionRow[];
  const move = (id: string, dir: "up" | "down") => {
    const ids = list.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    const swap = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = swap;
    reorder.mutate({ ids });
  };

  return (
    <div className="space-y-5">
      {!readOnly && (
        <section className="card space-y-3 p-5">
          <h2 className="section-title">{t("admin.landing.sections.new.title")}</h2>
          <input
            className="input w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("admin.landing.sections.new.titlePlaceholder")}
          />
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("admin.landing.sections.new.bodyPlaceholder")}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate({ title: title.trim(), body })}
            >
              {t("admin.landing.sections.new.create")}
            </button>
            {create.error && <span className="text-sm text-red-600">{create.error.message}</span>}
          </div>
        </section>
      )}

      {sections.isLoading && <p className="muted text-sm">{t("admin.landing.loading")}</p>}
      {!sections.isLoading && list.length === 0 && (
        <p className="muted text-sm">{t("admin.landing.sections.empty")}</p>
      )}
      {list.map((section, i) => (
        <SectionCard
          key={section.id}
          section={section}
          images={images}
          readOnly={readOnly}
          onChanged={refresh}
          onMove={move}
          canUp={i > 0}
          canDown={i < list.length - 1}
          moving={reorder.isPending}
        />
      ))}
    </div>
  );
}

function SectionCard({
  section,
  images,
  readOnly,
  onChanged,
  onMove,
  canUp,
  canDown,
  moving,
}: {
  section: SectionRow;
  images: ImageInfo[];
  readOnly: boolean;
  onChanged: () => void;
  onMove: (id: string, dir: "up" | "down") => void;
  canUp: boolean;
  canDown: boolean;
  moving: boolean;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const update = api.home.updateSection.useMutation({ onSuccess: onChanged });
  const del = api.home.deleteSection.useMutation({ onSuccess: onChanged });
  const saveTr = api.home.setSectionTranslation.useMutation({ onSuccess: onChanged });
  const removeTr = api.home.removeSectionTranslation.useMutation({ onSuccess: onChanged });

  const en = section.translations.find((tr) => tr.locale === "en");
  const heading =
    en?.title ?? section.translations[0]?.title ?? t("admin.landing.sections.untitled");

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
          <span className={section.published ? "badge-green" : "badge-slate"}>
            {section.published
              ? t("admin.landing.sections.statusVisible")
              : t("admin.landing.sections.statusHidden")}
          </span>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={t("admin.landing.sections.actions.moveUp")}
              disabled={!canUp || moving}
              onClick={() => onMove(section.id, "up")}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={t("admin.landing.sections.actions.moveDown")}
              disabled={!canDown || moving}
              onClick={() => onMove(section.id, "down")}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: section.id, published: !section.published })}
            >
              {section.published
                ? t("admin.landing.sections.actions.hide")
                : t("admin.landing.sections.actions.show")}
            </button>
            {section.mode === "INLINE" && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={section.openByDefault}
                  onChange={(e) =>
                    update.mutate({ id: section.id, openByDefault: e.target.checked })
                  }
                />
                {t("admin.landing.sections.actions.expanded")}
              </label>
            )}
            <button
              type="button"
              className="link-danger text-xs"
              disabled={del.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.landing.sections.actions.confirmDelete"),
                    confirmLabel: t("common.delete"),
                    cancelLabel: t("common.cancel"),
                    danger: true,
                  })
                )
                  del.mutate({ id: section.id });
              }}
            >
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="muted">{t("admin.landing.sections.mode.label")}</span>
            <select
              className="select field-auto"
              value={section.mode}
              onChange={(e) =>
                update.mutate({ id: section.id, mode: e.target.value as "INLINE" | "PAGE" })
              }
            >
              <option value="INLINE">{t("admin.landing.sections.mode.inline")}</option>
              <option value="PAGE">{t("admin.landing.sections.mode.page")}</option>
            </select>
          </label>
          {section.mode === "PAGE" && <SlugField section={section} update={update} />}
          {update.error && <span className="text-red-600">{update.error.message}</span>}
        </div>
      )}

      <LocalizedTranslations
        translations={section.translations}
        images={images}
        readOnly={readOnly}
        onSave={(locale, title, body) =>
          saveTr.mutate({ sectionId: section.id, locale, title, body })
        }
        saving={saveTr.isPending}
        saveError={saveTr.error?.message}
        onRemove={(locale, done) =>
          removeTr.mutate({ sectionId: section.id, locale }, { onSuccess: done })
        }
        removing={removeTr.isPending}
      />
      {dialog}
    </section>
  );
}

/** Slug editor for a PAGE-mode section (sanitizes on blur; links to the live detail page). */
function SlugField({
  section,
  update,
}: {
  section: SectionRow;
  update: ReturnType<typeof api.home.updateSection.useMutation>;
}) {
  const t = useTranslations();
  const [slug, setSlug] = useState(section.slug ?? "");
  useEffect(() => {
    setSlug(section.slug ?? "");
  }, [section.slug]);

  const commit = () => {
    const clean = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (clean !== slug) setSlug(clean);
    if (clean && clean !== (section.slug ?? "")) update.mutate({ id: section.id, slug: clean });
  };

  return (
    <span className="flex items-center gap-1.5">
      <span className="muted">/p/</span>
      <input
        className="input field-auto min-w-32"
        value={slug}
        placeholder={t("admin.landing.sections.slug.placeholder")}
        onChange={(e) => setSlug(e.target.value)}
        onBlur={commit}
      />
      {section.slug && (
        <a href={`/p/${section.slug}`} target="_blank" rel="noopener noreferrer" className="link">
          {t("admin.landing.sections.viewPage")} ↗
        </a>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab — page layout (block builder)
// ---------------------------------------------------------------------------

function newBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `b_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

/** Which editor tab owns a system block's content. */
const SYSTEM_BLOCK_TAB: Record<string, string> = {
  HERO: "content",
  FEATURES: "content",
  SECTIONS: "sections",
  NEWS: "news",
};

function makeContentBlock(type: (typeof CONTENT_BLOCK_TYPES)[number]): LeafBlock {
  switch (type) {
    case "IMAGE":
      return { id: newBlockId(), type: "IMAGE", imageId: "", width: "wide" };
    case "BUTTONS":
      return {
        id: newBlockId(),
        type: "BUTTONS",
        align: "left",
        buttons: [{ label: {}, href: "", style: "primary" }],
      };
    case "RICH_TEXT":
    default:
      return { id: newBlockId(), type: "RICH_TEXT", align: "left", text: {} };
  }
}

function makeColumnsBlock(count: number): Block {
  const n = Math.min(4, Math.max(1, count));
  return {
    id: newBlockId(),
    type: "COLUMNS",
    columns: Array.from({ length: n }, () => [] as LeafBlock[]),
  };
}

function richTextLeaf(text: string): LeafBlock {
  return { id: newBlockId(), type: "RICH_TEXT", align: "center", text: { en: text } };
}

/** Predefined block stacks the editor can drop in at once. */
function makePreset(name: string): Block[] {
  if (name === "cta") {
    return [
      { id: newBlockId(), type: "RICH_TEXT", align: "center", text: { en: "## Ready to get started?" } },
      {
        id: newBlockId(),
        type: "BUTTONS",
        align: "center",
        buttons: [{ label: { en: "Request a tutor" }, href: "/signup", style: "primary" }],
      },
    ];
  }
  if (name === "cards3") {
    return [
      {
        id: newBlockId(),
        type: "COLUMNS",
        card: true,
        columns: [
          [richTextLeaf("**Card one**\n\nA short description.")],
          [richTextLeaf("**Card two**\n\nA short description.")],
          [richTextLeaf("**Card three**\n\nA short description.")],
        ],
      },
    ];
  }
  return [];
}

function LayoutEditor({
  images,
  readOnly,
  owner = "landing",
  contentOnly = false,
}: {
  images: ImageInfo[];
  readOnly: boolean;
  /** Block container: "landing" or "page:<id>". */
  owner?: string;
  /** Hide the system blocks (Hero/Features/Sections/News) — true for custom pages. */
  contentOnly?: boolean;
}) {
  const t = useTranslations();
  const languages = api.i18n.languages.useQuery();
  const layout = api.home.layout.useQuery({ owner });
  const utils = api.useUtils();
  const save = api.home.setLayout.useMutation({
    onSuccess: () => utils.home.layout.invalidate({ owner }),
  });
  const [locale, setLocale] = useState("en");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);

  // Seed local state from the server once.
  useEffect(() => {
    if (layout.data && blocks === null) {
      setBlocks(layout.data);
      setBaseline(JSON.stringify(layout.data));
    }
  }, [layout.data, blocks]);

  if (layout.isLoading || blocks === null) {
    return <p className="muted text-sm">{t("admin.landing.loading")}</p>;
  }

  const dirty = baseline !== JSON.stringify(blocks);
  const present = new Set(blocks.map((b) => b.type));
  const missingSystem = SYSTEM_BLOCK_TYPES.filter((tp) => !present.has(tp));

  const updateAt = (i: number, block: Block) =>
    setBlocks(blocks.map((b, idx) => (idx === i ? block : b)));
  const removeAt = (i: number) => setBlocks(blocks.filter((_, idx) => idx !== i));
  const moveAt = (i: number, dir: "up" | "down") => {
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    setBlocks(next);
  };
  const append = (b: Block | Block[]) =>
    setBlocks([...blocks, ...(Array.isArray(b) ? b : [b])]);

  const addByValue = (value: string) => {
    if (value.startsWith("system:")) {
      append({ id: newBlockId(), type: value.slice(7) as Block["type"] } as Block);
    } else if (value.startsWith("content:")) {
      append(makeContentBlock(value.slice(8) as (typeof CONTENT_BLOCK_TYPES)[number]));
    } else if (value.startsWith("columns:")) {
      append(makeColumnsBlock(Number(value.slice(8))));
    } else if (value.startsWith("preset:")) {
      append(makePreset(value.slice(7)));
    }
  };

  return (
    <div className="space-y-4">
      {/* Save bar (no heading — the tab description / page card provides context). */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="muted">{t("common.language")}</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="select field-auto min-w-28"
            >
              {(languages.data ?? []).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          {!readOnly && (
            <>
              {dirty && <span className="muted text-xs">{t("admin.landing.layout.unsaved")}</span>}
              {save.error && <span className="text-xs text-red-600">{save.error.message}</span>}
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!dirty || save.isPending}
                onClick={() =>
                  save.mutate(
                    { owner, blocks },
                    { onSuccess: () => setBaseline(JSON.stringify(blocks)) },
                  )
                }
              >
                {t("admin.landing.layout.save")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {blocks.map((block, i) => (
          <BlockCard
            key={block.id}
            block={block}
            index={i}
            count={blocks.length}
            locale={locale}
            images={images}
            readOnly={readOnly}
            onChange={(b) => updateAt(i, b)}
            onMove={(dir) => moveAt(i, dir)}
            onRemove={() => removeAt(i)}
          />
        ))}
        {blocks.length === 0 && <p className="muted text-sm">{t("admin.landing.layout.empty")}</p>}
      </div>

      {!readOnly && (
        <select
          value=""
          onChange={(e) => addByValue(e.target.value)}
          className="select field-auto min-w-48"
        >
          <option value="">{t("admin.landing.layout.addBlock")}</option>
          <optgroup label={t("admin.landing.layout.groupContent")}>
            {CONTENT_BLOCK_TYPES.map((tp) => (
              <option key={tp} value={`content:${tp}`}>
                {t(`admin.landing.layout.blockTypes.${tp}`)}
              </option>
            ))}
            <option value="columns:2">{t("admin.landing.layout.blockTypes.COLUMNS")}</option>
          </optgroup>
          <optgroup label={t("admin.landing.layout.groupPresets")}>
            <option value="preset:cta">{t("admin.landing.layout.presets.cta")}</option>
            <option value="preset:cards3">{t("admin.landing.layout.presets.cards3")}</option>
          </optgroup>
          {!contentOnly && missingSystem.length > 0 && (
            <optgroup label={t("admin.landing.layout.groupSystem")}>
              {missingSystem.map((tp) => (
                <option key={tp} value={`system:${tp}`}>
                  {t(`admin.landing.layout.blockTypes.${tp}`)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
    </div>
  );
}

function BlockCard({
  block,
  index,
  count,
  locale,
  images,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: {
  block: Block;
  index: number;
  count: number;
  locale: string;
  images: ImageInfo[];
  readOnly: boolean;
  onChange: (b: Block) => void;
  onMove: (dir: "up" | "down") => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const system = isSystemBlock(block.type);

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-slate">{t(`admin.landing.layout.blockTypes.${block.type}`)}</span>
          {system && (
            <span className="muted text-xs">
              {t("admin.landing.layout.systemHint", {
                tab: t(`admin.landing.tabs.${SYSTEM_BLOCK_TAB[block.type]}`),
              })}
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={t("admin.landing.sections.actions.moveUp")}
              disabled={index === 0}
              onClick={() => onMove("up")}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={t("admin.landing.sections.actions.moveDown")}
              disabled={index === count - 1}
              onClick={() => onMove("down")}
            >
              ↓
            </button>
            <button type="button" className="link-danger text-xs" onClick={onRemove}>
              {t("admin.landing.layout.remove")}
            </button>
          </div>
        )}
      </div>

      {!system && !readOnly && (
        <div className="mt-3">
          {block.type === "RICH_TEXT" && (
            <RichTextBlockEditor block={block} locale={locale} onChange={onChange} />
          )}
          {block.type === "IMAGE" && (
            <ImageBlockEditor block={block} locale={locale} images={images} onChange={onChange} />
          )}
          {block.type === "BUTTONS" && (
            <ButtonsBlockEditor block={block} locale={locale} onChange={onChange} />
          )}
          {block.type === "COLUMNS" && (
            <ColumnsBlockEditor block={block} locale={locale} images={images} onChange={onChange} />
          )}
        </div>
      )}
    </section>
  );
}

/** Editor for one leaf block inside a column (reuses the same field editors as the top level). */
function LeafEditor({
  block,
  locale,
  images,
  onChange,
}: {
  block: LeafBlock;
  locale: string;
  images: ImageInfo[];
  onChange: (b: LeafBlock) => void;
}) {
  if (block.type === "RICH_TEXT")
    return <RichTextBlockEditor block={block} locale={locale} onChange={(b) => onChange(b as LeafBlock)} />;
  if (block.type === "IMAGE")
    return (
      <ImageBlockEditor
        block={block}
        locale={locale}
        images={images}
        onChange={(b) => onChange(b as LeafBlock)}
      />
    );
  return <ButtonsBlockEditor block={block} locale={locale} onChange={(b) => onChange(b as LeafBlock)} />;
}

function ColumnsBlockEditor({
  block,
  locale,
  images,
  onChange,
}: {
  block: Extract<Block, { type: "COLUMNS" }>;
  locale: string;
  images: ImageInfo[];
  onChange: (b: Block) => void;
}) {
  const t = useTranslations();
  const setColumn = (ci: number, col: LeafBlock[]) =>
    onChange({ ...block, columns: block.columns.map((c, i) => (i === ci ? col : c)) });

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={block.card ?? false}
          onChange={(e) => onChange({ ...block, card: e.target.checked })}
        />
        {t("admin.landing.layout.columns.card")}
      </label>

      {block.columns.map((col, ci) => (
        <div key={ci} className="rounded-md border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase">
              {t("admin.landing.layout.columns.columnLabel", { n: ci + 1 })}
            </span>
            {block.columns.length > 1 && (
              <button
                type="button"
                className="link-danger text-xs"
                onClick={() =>
                  onChange({ ...block, columns: block.columns.filter((_, i) => i !== ci) })
                }
              >
                {t("admin.landing.layout.columns.removeColumn")}
              </button>
            )}
          </div>

          <div className="space-y-2">
            {col.map((leaf, li) => (
              <div key={leaf.id} className="rounded bg-slate-50 p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="badge-slate">
                    {t(`admin.landing.layout.blockTypes.${leaf.type}`)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      aria-label={t("admin.landing.sections.actions.moveUp")}
                      disabled={li === 0}
                      onClick={() => {
                        const next = [...col];
                        const tmp = next[li]!;
                        next[li] = next[li - 1]!;
                        next[li - 1] = tmp;
                        setColumn(ci, next);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      aria-label={t("admin.landing.sections.actions.moveDown")}
                      disabled={li === col.length - 1}
                      onClick={() => {
                        const next = [...col];
                        const tmp = next[li]!;
                        next[li] = next[li + 1]!;
                        next[li + 1] = tmp;
                        setColumn(ci, next);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="link-danger text-xs"
                      onClick={() => setColumn(ci, col.filter((_, i) => i !== li))}
                    >
                      {t("admin.landing.layout.remove")}
                    </button>
                  </div>
                </div>
                <LeafEditor
                  block={leaf}
                  locale={locale}
                  images={images}
                  onChange={(b) => setColumn(ci, col.map((x, i) => (i === li ? b : x)))}
                />
              </div>
            ))}
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setColumn(ci, [
                  ...col,
                  makeContentBlock(e.target.value as (typeof CONTENT_BLOCK_TYPES)[number]),
                ]);
              }}
              className="select field-auto min-w-40 text-xs"
            >
              <option value="">{t("admin.landing.layout.columns.addBlock")}</option>
              {CONTENT_BLOCK_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`admin.landing.layout.blockTypes.${tp}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}

      {block.columns.length < 4 && (
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onChange({ ...block, columns: [...block.columns, []] })}
        >
          {t("admin.landing.layout.columns.addColumn")}
        </button>
      )}
    </div>
  );
}

function AlignSelect({
  value,
  onChange,
}: {
  value: "left" | "center";
  onChange: (a: "left" | "center") => void;
}) {
  const t = useTranslations();
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="muted">{t("admin.landing.layout.align.label")}</span>
      <select
        className="select field-auto"
        value={value}
        onChange={(e) => onChange(e.target.value as "left" | "center")}
      >
        <option value="left">{t("admin.landing.layout.align.left")}</option>
        <option value="center">{t("admin.landing.layout.align.center")}</option>
      </select>
    </label>
  );
}

function RichTextBlockEditor({
  block,
  locale,
  onChange,
}: {
  block: Extract<Block, { type: "RICH_TEXT" }>;
  locale: string;
  onChange: (b: Block) => void;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-2">
      <textarea
        className="textarea w-full font-mono text-xs"
        rows={4}
        value={block.text[locale] ?? ""}
        onChange={(e) => onChange({ ...block, text: { ...block.text, [locale]: e.target.value } })}
        placeholder={t("admin.landing.layout.richText.placeholder")}
      />
      <AlignSelect value={block.align ?? "left"} onChange={(a) => onChange({ ...block, align: a })} />
    </div>
  );
}

function ImageBlockEditor({
  block,
  locale,
  images,
  onChange,
}: {
  block: Extract<Block, { type: "IMAGE" }>;
  locale: string;
  images: ImageInfo[];
  onChange: (b: Block) => void;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {block.imageId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${block.imageId}`}
            alt=""
            className="h-16 w-24 rounded border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
            {t("admin.landing.content.heroImage.none")}
          </div>
        )}
        <select
          className="select field-auto min-w-40"
          value={block.imageId}
          onChange={(e) => onChange({ ...block, imageId: e.target.value })}
        >
          <option value="">{t("admin.landing.content.heroImage.choose")}</option>
          {images.map((img) => (
            <option key={img.id} value={img.id}>
              {img.alt ?? img.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs">
          <span className="muted">{t("admin.landing.layout.image.width")}</span>
          <select
            className="select field-auto"
            value={block.width ?? "wide"}
            onChange={(e) =>
              onChange({ ...block, width: e.target.value as "narrow" | "wide" | "full" })
            }
          >
            <option value="narrow">{t("admin.landing.layout.image.narrow")}</option>
            <option value="wide">{t("admin.landing.layout.image.wide")}</option>
            <option value="full">{t("admin.landing.layout.image.full")}</option>
          </select>
        </label>
      </div>
      <input
        className="input w-full"
        value={block.caption?.[locale] ?? ""}
        placeholder={t("admin.landing.layout.image.caption")}
        onChange={(e) =>
          onChange({ ...block, caption: { ...(block.caption ?? {}), [locale]: e.target.value } })
        }
      />
    </div>
  );
}

function ButtonsBlockEditor({
  block,
  locale,
  onChange,
}: {
  block: Extract<Block, { type: "BUTTONS" }>;
  locale: string;
  onChange: (b: Block) => void;
}) {
  const t = useTranslations();
  const setButton = (i: number, b: (typeof block.buttons)[number]) =>
    onChange({ ...block, buttons: block.buttons.map((x, idx) => (idx === i ? b : x)) });
  return (
    <div className="space-y-2">
      {block.buttons.map((b, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            className="input field-auto min-w-32"
            value={b.label[locale] ?? ""}
            placeholder={t("admin.landing.layout.buttons.label")}
            onChange={(e) => setButton(i, { ...b, label: { ...b.label, [locale]: e.target.value } })}
          />
          <input
            className="input field-auto min-w-40"
            value={b.href}
            placeholder={t("admin.landing.layout.buttons.href")}
            onChange={(e) => setButton(i, { ...b, href: e.target.value })}
          />
          <select
            className="select field-auto"
            value={b.style}
            onChange={(e) => setButton(i, { ...b, style: e.target.value as "primary" | "secondary" })}
          >
            <option value="primary">{t("admin.landing.layout.buttons.primary")}</option>
            <option value="secondary">{t("admin.landing.layout.buttons.secondary")}</option>
          </select>
          <button
            type="button"
            className="link-danger text-xs"
            onClick={() => onChange({ ...block, buttons: block.buttons.filter((_, idx) => idx !== i) })}
          >
            {t("admin.landing.layout.remove")}
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            onChange({ ...block, buttons: [...block.buttons, { label: {}, href: "", style: "primary" }] })
          }
        >
          {t("admin.landing.layout.buttons.add")}
        </button>
        <AlignSelect value={block.align ?? "left"} onChange={(a) => onChange({ ...block, align: a })} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — custom pages (standalone /p/<slug> pages)
// ---------------------------------------------------------------------------

type PageRow = {
  id: string;
  slug: string;
  title: Record<string, string>;
  published: boolean;
  showInNav: boolean;
  navOrder: number;
  createdByName: string | null;
  updatedAt: Date;
};

function PagesManager({ images, readOnly }: { images: ImageInfo[]; readOnly: boolean }) {
  const t = useTranslations();
  const pages = api.home.pages.useQuery();
  const utils = api.useUtils();
  const refresh = () => {
    void utils.home.pages.invalidate();
  };
  const [title, setTitle] = useState("");
  const create = api.home.createPage.useMutation({
    onSuccess: () => {
      setTitle("");
      refresh();
    },
  });
  const reorder = api.home.reorderPages.useMutation({ onSuccess: refresh });

  const list = pages.data ?? [];
  const move = (id: string, dir: "up" | "down") => {
    const ids = list.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    const swap = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = swap;
    reorder.mutate({ ids });
  };

  return (
    <div className="space-y-5">
      {!readOnly && (
        <section className="card space-y-3 p-5">
          <h2 className="section-title">{t("admin.landing.pages.new.title")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="input min-w-48 flex-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("admin.landing.pages.new.placeholder")}
            />
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate({ title: title.trim() })}
            >
              {t("admin.landing.pages.new.create")}
            </button>
          </div>
          {create.error && <span className="text-sm text-red-600">{create.error.message}</span>}
        </section>
      )}

      {pages.isLoading && <p className="muted text-sm">{t("admin.landing.loading")}</p>}
      {!pages.isLoading && list.length === 0 && (
        <p className="muted text-sm">{t("admin.landing.pages.empty")}</p>
      )}
      {list.map((p, i) => (
        <PageCard
          key={p.id}
          page={{ ...p, title: (p.title ?? {}) as Record<string, string> }}
          images={images}
          readOnly={readOnly}
          onChanged={refresh}
          onMove={move}
          canUp={i > 0}
          canDown={i < list.length - 1}
          moving={reorder.isPending}
        />
      ))}
    </div>
  );
}

function PageCard({
  page,
  images,
  readOnly,
  onChanged,
  onMove,
  canUp,
  canDown,
  moving,
}: {
  page: PageRow;
  images: ImageInfo[];
  readOnly: boolean;
  onChanged: () => void;
  onMove: (id: string, dir: "up" | "down") => void;
  canUp: boolean;
  canDown: boolean;
  moving: boolean;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const languages = api.i18n.languages.useQuery();
  const [locale, setLocale] = useState("en");
  const [open, setOpen] = useState(false);
  const update = api.home.updatePage.useMutation({ onSuccess: onChanged });
  const del = api.home.deletePage.useMutation({ onSuccess: onChanged });
  const setTitle = api.home.setPageTitle.useMutation({ onSuccess: onChanged });

  const heading =
    page.title.en ?? Object.values(page.title)[0] ?? t("admin.landing.pages.untitled");

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
          <span className="muted text-xs">/p/{page.slug}</span>
          <span className={page.published ? "badge-green" : "badge-slate"}>
            {page.published
              ? t("admin.landing.sections.statusVisible")
              : t("admin.landing.sections.statusHidden")}
          </span>
          {page.showInNav && <span className="badge-slate">{t("admin.landing.pages.inNav")}</span>}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={t("admin.landing.sections.actions.moveUp")}
              disabled={!canUp || moving}
              onClick={() => onMove(page.id, "up")}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={t("admin.landing.sections.actions.moveDown")}
              disabled={!canDown || moving}
              onClick={() => onMove(page.id, "down")}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: page.id, published: !page.published })}
            >
              {page.published
                ? t("admin.landing.sections.actions.hide")
                : t("admin.landing.sections.actions.show")}
            </button>
            <a
              href={`/p/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="link text-xs"
            >
              {t("admin.landing.sections.viewPage")} ↗
            </a>
            <button
              type="button"
              className="link-danger text-xs"
              disabled={del.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.landing.pages.confirmDelete"),
                    confirmLabel: t("common.delete"),
                    cancelLabel: t("common.cancel"),
                    danger: true,
                  })
                )
                  del.mutate({ id: page.id });
              }}
            >
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="muted">{t("common.language")}</span>
            <select
              className="select field-auto"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
            >
              {(languages.data ?? []).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <PageTitleField page={page} locale={locale} setTitle={setTitle} />
          <PageSlugField page={page} update={update} />
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={page.showInNav}
              onChange={(e) => update.mutate({ id: page.id, showInNav: e.target.checked })}
            />
            {t("admin.landing.pages.showInNav")}
          </label>
          {update.error && <span className="text-red-600">{update.error.message}</span>}
        </div>
      )}

      {!readOnly && (
        <div className="border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-slate-600"
          >
            <DisclosureIcon open={open} />
            {t("admin.landing.pages.editContent")}
          </button>
          {open && (
            <div className="mt-3">
              <LayoutEditor
                images={images}
                readOnly={readOnly}
                owner={`page:${page.id}`}
                contentOnly
              />
            </div>
          )}
        </div>
      )}
      {dialog}
    </section>
  );
}

function PageTitleField({
  page,
  locale,
  setTitle,
}: {
  page: PageRow;
  locale: string;
  setTitle: ReturnType<typeof api.home.setPageTitle.useMutation>;
}) {
  const t = useTranslations();
  const [val, setVal] = useState(page.title[locale] ?? "");
  useEffect(() => {
    setVal(page.title[locale] ?? "");
  }, [page.title, locale]);
  return (
    <label className="flex items-center gap-2">
      <span className="muted">{t("admin.landing.pages.titleLabel")}</span>
      <input
        className="input field-auto min-w-40"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val !== (page.title[locale] ?? ""))
            setTitle.mutate({ id: page.id, locale, value: val });
        }}
      />
    </label>
  );
}

function PageSlugField({
  page,
  update,
}: {
  page: PageRow;
  update: ReturnType<typeof api.home.updatePage.useMutation>;
}) {
  const [slug, setSlug] = useState(page.slug);
  useEffect(() => {
    setSlug(page.slug);
  }, [page.slug]);
  const commit = () => {
    const clean = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (clean !== slug) setSlug(clean);
    if (clean && clean !== page.slug) update.mutate({ id: page.id, slug: clean });
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="muted">/p/</span>
      <input
        className="input field-auto min-w-28"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        onBlur={commit}
      />
    </span>
  );
}

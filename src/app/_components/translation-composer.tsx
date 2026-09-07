"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
/** A dedicated translator surface avoids granting access to structural publishing controls. */
export function TranslationComposer() {
  const t = useTranslations("workflows");
  const initialLocale = useLocale();
  const [locale, setLocale] = useState(initialLocale);
  const [kind, setKind] = useState("content");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const content = api.home.content.useQuery(
    { locale },
    { enabled: kind === "content" },
  );
  const news = api.home.news.useQuery(undefined, { enabled: kind === "news" });
  const sections = api.home.sections.useQuery(undefined, {
    enabled: kind === "sections",
  });
  const pages = api.home.pages.useQuery(undefined, {
    enabled: kind === "pages",
  });
  const utils = api.useUtils();
  const done = () => utils.translationReview.list.invalidate();
  const saveContent = api.home.setContent.useMutation({ onSuccess: done });
  const saveNews = api.home.setNewsTranslation.useMutation({ onSuccess: done });
  const saveSection = api.home.setSectionTranslation.useMutation({
    onSuccess: done,
  });
  const savePage = api.home.setPageTitle.useMutation({ onSuccess: done });
  const options =
    kind === "content"
      ? (content.data ?? [])
          .filter((x) => x.kind !== "image")
          .map((x) => ({
            id: x.key,
            label: x.default ?? x.key,
            title: "",
            body: x.override ?? x.default ?? "",
          }))
      : kind === "news"
        ? (news.data ?? []).map((x) => {
            const tr =
              x.translations.find((v) => v.locale === locale) ??
              x.translations.find((v) => v.locale === "en");
            return {
              id: x.id,
              label: tr?.title ?? x.id,
              title: tr?.title ?? "",
              body: tr?.body ?? "",
            };
          })
        : kind === "sections"
          ? (sections.data ?? []).map((x) => {
              const tr =
                x.translations.find((v) => v.locale === locale) ??
                x.translations.find((v) => v.locale === "en");
              return {
                id: x.id,
                label: tr?.title ?? x.id,
                title: tr?.title ?? "",
                body: tr?.body ?? "",
              };
            })
          : (pages.data ?? []).map((x) => ({
              id: x.id,
              label: x.slug,
              title: "",
              body: (x.title as Record<string, string>)[locale] ?? "",
            }));
  const pending =
    saveContent.isPending ||
    saveNews.isPending ||
    saveSection.isPending ||
    savePage.isPending;
  const error =
    saveContent.error ??
    saveNews.error ??
    saveSection.error ??
    savePage.error ??
    content.error ??
    news.error ??
    sections.error ??
    pages.error;
  return (
    <form
      className="card space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (kind === "content")
          saveContent.mutate({ locale, key: target, value: body });
        else if (kind === "news")
          saveNews.mutate({ locale, postId: target, title, body });
        else if (kind === "sections")
          saveSection.mutate({ locale, sectionId: target, title, body });
        else savePage.mutate({ locale, id: target, value: body });
      }}
    >
      <h2 className="section-title">{t("prepareTranslation")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">{t("contentType")}</span>
          <select
            className="input w-full"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setTarget("");
              setTitle("");
              setBody("");
            }}
          >
            {["content", "news", "sections", "pages"].map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">{t("locale")}</span>
          <input
            className="input w-full"
            value={locale}
            onChange={(e) => {
              setLocale(e.target.value);
              setTarget("");
            }}
            required
            maxLength={10}
          />
        </label>
      </div>
      <label className="block">
        <span className="label">{t("target")}</span>
        <select
          className="input w-full"
          required
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            const value = options.find((v) => v.id === e.target.value);
            setTitle(value?.title ?? "");
            setBody(value?.body ?? "");
          }}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label.slice(0, 100)}
            </option>
          ))}
        </select>
      </label>
      {(kind === "news" || kind === "sections") && (
        <label className="block">
          <span className="label">{t("title")}</span>
          <input
            className="input w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </label>
      )}
      <label className="block">
        <span className="label">{t("translation")}</span>
        <textarea
          className="input min-h-40 w-full"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={kind === "pages" ? 200 : 20000}
        />
      </label>
      <button className="btn-primary" disabled={pending || !target}>
        {t("save")}
      </button>
      {error && <p role="alert">{error.message}</p>}
      {(saveContent.isSuccess ||
        saveNews.isSuccess ||
        saveSection.isSuccess ||
        savePage.isSuccess) && <p role="status">{t("saved")}</p>}
    </form>
  );
}

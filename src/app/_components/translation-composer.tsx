"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { translationAccess } from "~/lib/translation-access";
/** A dedicated translator surface avoids granting access to structural publishing controls. */
export function TranslationComposer() {
  const t = useTranslations("workflows");
  const editor = useTranslations("translationEditor");
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const initialLocale = useLocale();
  const [locale, setLocale] = useState(initialLocale);
  const [kind, setKind] = useState("content");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const languages = api.i18n.managedLanguages.useQuery();
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
  const done = async () => {
    await Promise.all([
      utils.translationReview.list.invalidate(),
      utils.home.invalidate(),
    ]);
  };
  const saveContent = api.home.setContent.useMutation({ onSuccess: done });
  const saveNews = api.home.setNewsTranslation.useMutation({ onSuccess: done });
  const saveSection = api.home.setSectionTranslation.useMutation({
    onSuccess: done,
  });
  const savePage = api.home.setPageTitle.useMutation({ onSuccess: done });
  // Outcomes describe the submitted form only, never another language or destination.
  const resetOutcome = () => {
    saveContent.reset();
    saveNews.reset();
    saveSection.reset();
    savePage.reset();
  };
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
  const loading =
    languages.isLoading ||
    (kind === "content"
      ? content.isLoading
      : kind === "news"
        ? news.isLoading
        : kind === "sections"
          ? sections.isLoading
          : pages.isLoading);
  const error =
    saveContent.error ??
    saveNews.error ??
    saveSection.error ??
    savePage.error ??
    languages.error ??
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
            aria-label={t("contentType")}
            disabled={pending}
            onChange={(e) => {
              resetOutcome();
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
          <select
            className="select w-full"
            value={locale}
            aria-label={t("locale")}
            disabled={pending}
            onChange={(e) => {
              resetOutcome();
              setLocale(e.target.value);
              setTarget("");
              setTitle("");
              setBody("");
            }}
            required
          >
            {(languages.data ?? []).map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">{t("target")}</span>
        <select
          className="input w-full"
          required
          value={target}
          aria-label={t("target")}
          disabled={pending || loading}
          onChange={(e) => {
            resetOutcome();
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
            aria-label={t("title")}
            disabled={pending}
            onChange={(e) => {
              resetOutcome();
              setTitle(e.target.value);
            }}
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
          aria-label={t("translation")}
          disabled={pending}
          onChange={(e) => {
            resetOutcome();
            setBody(e.target.value);
          }}
          maxLength={kind === "pages" ? 200 : 20000}
        />
      </label>
      {loading && <p role="status">{editor("loading")}</p>}
      <button
        className="btn-primary"
        disabled={
          pending ||
          loading ||
          !target ||
          !languages.data?.some((language) => language.code === locale)
        }
      >
        {editor(access.publish ? "publishEdit" : "submitDraft")}
      </button>
      {error && <p role="alert">{error.message}</p>}
      {(saveContent.isSuccess ||
        saveNews.isSuccess ||
        saveSection.isSuccess ||
        savePage.isSuccess) && (
        <p role="status">
          {editor(access.publish ? "published" : "submitted")}
        </p>
      )}
    </form>
  );
}

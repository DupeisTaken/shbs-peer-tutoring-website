"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { getQueryKey } from "@trpc/react-query";
import { translationAccess } from "~/lib/translation-access";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useSessionAccessDenied } from "./session-view-state";
import { viewAccessDenied } from "~/lib/session-view-state";
import {
  useTranslationIntent,
  type TranslationIntentHandlers,
} from "./use-translation-intent";

type SubmittedTranslation = {
  key: string;
  intent: string;
  actorId: string;
  published: boolean;
  refresh: () => Promise<unknown>;
};
/** A dedicated translator surface avoids granting access to structural publishing controls. */
export function TranslationComposer({
  concealed = false,
}: { concealed?: boolean } = {}) {
  const t = useTranslations("workflows");
  const saveBoundary = useTranslations("saveBoundary");
  const editor = useTranslations("translationEditor");
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const capabilityRevoked = useRef(false);
  const synchronizationAllowed = useRef(false);
  const ownerActive = useRef(false);
  useLayoutEffect(() => {
    ownerActive.current = true;
    return () => {
      ownerActive.current = false;
    };
  }, []);
  const initialLocale = useLocale();
  const [locale, setLocale] = useState(initialLocale);
  const [kind, setKind] = useState("content");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const admission = useRef(false);
  const [admitted, setAdmitted] = useState(false);
  const submitted = useRef<SubmittedTranslation | null>(null);
  const currentActor = useRef(me.data?.id);
  const accepted = useRef(new Map<string, string>());
  const [receipts, setReceipts] = useState<
    Record<string, { intent: string; published: boolean }>
  >({});
  const [syncing, setSyncing] = useState(false);
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  // Destination, language and content type form the draft identity. Moving to a
  // different context does not publish, copy into it, or discard the previous text.
  const drafts = useRef(new Map<string, { title: string; body: string }>());
  const destinations = useRef(new Map<string, string>());
  const capabilityPruned = useRef(false);
  const contextKey = (type: string, language: string) =>
    JSON.stringify([type, language]);
  const draftKey = (type: string, language: string, id: string) =>
    JSON.stringify([type, language, id]);
  // Callback guards follow committed authority. An abandoned render cannot
  // revoke another context's retained admitted/accepted input.
  useLayoutEffect(() => {
    capabilityRevoked.current = !!(
      me.isSuccess &&
      me.data &&
      !me.error &&
      !access.edit
    );
    currentActor.current = me.data?.id;
    if (
      me.isSuccess &&
      me.data &&
      !me.error &&
      !access.edit &&
      !capabilityPruned.current
    ) {
      capabilityPruned.current = true;
      const retained = new Map<string, { title: string; body: string }>();
      const retain = (key: string, value: string) => {
        const [savedTitle, savedBody] = JSON.parse(value) as [string, string];
        retained.set(key, { title: savedTitle, body: savedBody });
        const [type, language, id] = JSON.parse(key) as [
          string,
          string,
          string,
        ];
        destinations.current.set(contextKey(type, language), id);
      };
      destinations.current.clear();
      for (const [key, value] of accepted.current) retain(key, value);
      // A revoke may arrive after admission but before its response. Preserve the
      // captured payload and receipt ownership while discarding unrelated edits.
      if (admission.current && submitted.current)
        retain(submitted.current.key, submitted.current.intent);
      drafts.current = retained;
      const current = retained.get(draftKey(kind, locale, target));
      if (!current) setTarget("");
      setTitle(current?.title ?? "");
      setBody(current?.body ?? "");
    }
    if (me.isSuccess && access.edit && !me.error)
      capabilityPruned.current = false;
  }, [me.isSuccess, me.data, me.error, access.edit, kind, locale, target]);
  const rememberDraft = () => {
    destinations.current.set(contextKey(kind, locale), target);
    if (target)
      drafts.current.set(draftKey(kind, locale, target), { title, body });
  };
  const changeContext = (nextKind: string, nextLocale: string) => {
    rememberDraft();
    resetOutcome();
    const nextTarget =
      destinations.current.get(contextKey(nextKind, nextLocale)) ?? "";
    const draft = drafts.current.get(
      draftKey(nextKind, nextLocale, nextTarget),
    );
    setKind(nextKind);
    setLocale(nextLocale);
    setTarget(nextTarget);
    setTitle(draft?.title ?? "");
    setBody(draft?.body ?? "");
  };
  const languages = api.i18n.managedLanguages.useQuery(undefined, {
    enabled: !concealed && access.edit,
  });
  const contentInput = { locale };
  const content = api.home.content.useQuery(contentInput, {
    enabled: !concealed && access.edit && kind === "content",
  });
  const news = api.home.news.useQuery(undefined, {
    enabled: !concealed && access.edit && kind === "news",
  });
  const sections = api.home.sections.useQuery(undefined, {
    enabled: !concealed && access.edit && kind === "sections",
  });
  const pages = api.home.pages.useQuery(undefined, {
    enabled: !concealed && access.edit && kind === "pages",
  });
  const utils = api.useUtils();
  const refreshDestination = async () => {
    const data =
      kind === "content"
        ? await utils.home.content.fetch({ locale }, { staleTime: 0 })
        : kind === "news"
          ? await utils.home.news.fetch(undefined, { staleTime: 0 })
          : kind === "sections"
            ? await utils.home.sections.fetch(undefined, { staleTime: 0 })
            : await utils.home.pages.fetch(undefined, { staleTime: 0 });
    if (data == null) throw new Error(editor("readFailed"));
  };
  const refreshAccepted = async (origin = submitted.current) => {
    setSyncing(true);
    try {
      if (
        !origin ||
        currentActor.current !== origin.actorId ||
        !ownerActive.current ||
        !synchronizationAllowed.current
      )
        throw new Error(editor("acceptedRefreshFailed"));
      // Invalidation cancels existing refetches by default. Finish those reads
      // before fetching the exact origin, including when it is now inactive.
      const invalidations = await Promise.allSettled([
        invalidateAndReport(utils.translationReview.list),
        invalidateAndReport(utils.home),
      ]);
      if (
        currentActor.current !== origin.actorId ||
        !ownerActive.current ||
        !synchronizationAllowed.current
      )
        throw new Error(editor("acceptedRefreshFailed"));
      for (const result of invalidations) {
        if (
          result.status === "rejected" &&
          viewAccessDenied(result.reason as { data?: { code?: string } })
        )
          throw result.reason as unknown;
      }
      await settleRefreshes([
        async () => {
          for (const result of invalidations)
            if (result.status === "rejected") throw result.reason as unknown;
        },
        async () => {
          await origin.refresh();
        },
        async () => {
          await me.refetch({ throwOnError: true });
        },
        async () => {
          await languages.refetch({ throwOnError: true });
        },
      ]);
      setRefreshError(null);
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      setSyncing(false);
    }
  };
  // Raw transport never releases admission: a lost response is still unknown.
  const saveContent = api.home.setContent.useMutation({ retry: false });
  const saveNews = api.home.setNewsTranslation.useMutation({ retry: false });
  const saveSection = api.home.setSectionTranslation.useMutation({
    retry: false,
  });
  const savePage = api.home.setPageTitle.useMutation({ retry: false });
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
  const destinationRead =
    kind === "content"
      ? content
      : kind === "news"
        ? news
        : kind === "sections"
          ? sections
          : pages;
  const loading =
    me.isLoading || languages.isLoading || destinationRead.isLoading;
  const missingRead = [me, languages, destinationRead].some(
    (query) => query.isSuccess && query.data == null,
  );
  const readError =
    me.error ??
    languages.error ??
    destinationRead.error ??
    (missingRead ? new Error(editor("readFailed")) : null);
  // Bind only the selected destination; inactive branches cannot satisfy its read.
  const destinationKey =
    kind === "content"
      ? getQueryKey(api.home.content, contentInput, "query")
      : kind === "news"
        ? getQueryKey(api.home.news, undefined, "query")
        : kind === "sections"
          ? getQueryKey(api.home.sections, undefined, "query")
          : getQueryKey(api.home.pages, undefined, "query");
  const denied = useSessionAccessDenied(
    ...[
      { ...me, queryKey: getQueryKey(api.account.me, undefined, "query") },
      {
        ...languages,
        queryKey: getQueryKey(api.i18n.managedLanguages, undefined, "query"),
      },
      {
        ...destinationRead,
        denialKey: "destination",
        queryKey: destinationKey,
      },
    ].map((query) => ({
      ...query,
      isSuccess: query.isSuccess && query.data != null,
    })),
  );
  useLayoutEffect(() => {
    synchronizationAllowed.current = !concealed && !denied && access.edit;
  });
  const controller = useTranslationIntent({
    actorId: !me.error && !denied ? me.data?.id : null,
    mode: access.publish ? "PUBLISH" : "DRAFT",
    canSubmit: !concealed && !denied && !me.error && access.edit,
    refreshAuthority: async () => {
      const result = await me.refetch({ throwOnError: true });
      const fresh = translationAccess(result.data);
      return {
        actorId: result.data?.id ?? null,
        mode: fresh.publish ? ("PUBLISH" as const) : ("DRAFT" as const),
        canSubmit: !!result.data && fresh.edit,
      };
    },
  });
  // Logical admission can finish via GET/Stop while the old HTTP call hangs.
  const pending = syncing || controller.pending || admitted;
  const key = draftKey(kind, locale, target);
  const receipt = receipts[key];
  const intent = JSON.stringify([title, body]);
  const alreadyAccepted = receipt?.intent === intent;
  const blocked =
    concealed ||
    pending ||
    controller.blocked ||
    loading ||
    !!readError ||
    !!refreshError ||
    !access.edit;
  const retryRead = async () => {
    if (!ownerActive.current || concealed || admission.current || syncing)
      return;
    if (refreshError && !denied) {
      admission.current = true;
      setAdmitted(true);
      try {
        await refreshAccepted();
      } finally {
        admission.current = false;
        setAdmitted(false);
      }
      return;
    }
    setSyncing(true);
    try {
      await settleRefreshes([
        async () => {
          await me.refetch();
        },
        async () => {
          await languages.refetch();
        },
        async () => {
          await destinationRead.refetch();
        },
      ]);
    } catch {
      // Each query retains its own read failure and recovery state.
    } finally {
      setSyncing(false);
    }
  };
  const error =
    saveContent.error ??
    saveNews.error ??
    saveSection.error ??
    savePage.error ??
    refreshError ??
    readError;
  if (concealed) return null;
  if (denied || (me.data && !access.edit))
    return (
      <div className="space-y-2">
        <p role="alert">{editor("noAccess")}</p>
        {denied && (
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => {
              void retryRead();
            }}
          >
            {editor("retryRead")}
          </button>
        )}
      </div>
    );
  return (
    <form
      className="card space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !ownerActive.current ||
          admission.current ||
          blocked ||
          alreadyAccepted ||
          !target ||
          !options.some((option) => option.id === target) ||
          !languages.data?.some((language) => language.code === locale)
        )
          return;
        admission.current = true;
        setAdmitted(true);
        const origin: SubmittedTranslation = {
          key,
          intent,
          actorId: me.data!.id,
          published: access.publish,
          refresh: refreshDestination,
        };
        submitted.current = origin;
        const release = () => {
          if (submitted.current === origin) {
            admission.current = false;
            setAdmitted(false);
          }
        };
        const handlers: TranslationIntentHandlers = {
          onAccepted: async (receipt, { synchronize }) => {
            // Record the original receipt before checking visibility/authority.
            const saved = { ...origin, published: receipt.mode === "PUBLISH" };
            accepted.current.set(origin.key, origin.intent);
            setReceipts((previous) => ({ ...previous, [origin.key]: saved }));
            resetOutcome();
            try {
              if (
                synchronize &&
                ownerActive.current &&
                synchronizationAllowed.current &&
                currentActor.current === origin.actorId
              )
                await refreshAccepted(origin);
              else setRefreshError(new Error(editor("acceptedRefreshFailed")));
            } finally {
              release();
            }
          },
          onStopped: () => {
            release();
            resetOutcome();
            // Once a stopped write becomes unsent again, a verified revoke
            // applies the same pruning rule as it does to other unsent edits.
            if (capabilityRevoked.current) {
              drafts.current.delete(origin.key);
              setTarget("");
              setTitle("");
              setBody("");
            }
          },
        };
        const attempt =
          kind === "content"
            ? controller.submit(
                "home.setContent",
                { locale, key: target, value: body },
                (input) => saveContent.mutateAsync(input),
                handlers,
              )
            : kind === "news"
              ? controller.submit(
                  "home.setNewsTranslation",
                  { locale, postId: target, title, body },
                  (input) => saveNews.mutateAsync(input),
                  handlers,
                )
              : kind === "sections"
                ? controller.submit(
                    "home.setSectionTranslation",
                    { locale, sectionId: target, title, body },
                    (input) => saveSection.mutateAsync(input),
                    handlers,
                  )
                : controller.submit(
                    "home.setPageTitle",
                    { locale, id: target, value: body },
                    (input) => savePage.mutateAsync(input),
                    handlers,
                  );
        void attempt.then((result) => {
          if (result.status === "BLOCKED") release();
        });
      }}
    >
      <p className="muted text-sm">{saveBoundary("form")}</p>
      <h2 className="section-title">{t("prepareTranslation")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">{t("contentType")}</span>
          <select
            className="input w-full"
            value={kind}
            aria-label={t("contentType")}
            disabled={pending || controller.blocked}
            onChange={(e) => {
              if (pending || controller.blocked) return;
              changeContext(e.target.value, locale);
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
            disabled={pending || controller.blocked}
            onChange={(e) => {
              if (pending || controller.blocked) return;
              changeContext(kind, e.target.value);
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
          disabled={pending || controller.blocked || loading || !!readError}
          onChange={(e) => {
            if (pending || controller.blocked || loading || readError) return;
            rememberDraft();
            resetOutcome();
            setTarget(e.target.value);
            const value =
              drafts.current.get(draftKey(kind, locale, e.target.value)) ??
              options.find((v) => v.id === e.target.value);
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
            disabled={pending || controller.blocked}
            onChange={(e) => {
              if (pending || controller.blocked) return;
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
          disabled={pending || controller.blocked}
          onChange={(e) => {
            if (pending || controller.blocked) return;
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
          blocked ||
          alreadyAccepted ||
          !target ||
          !options.some((option) => option.id === target) ||
          !languages.data?.some((language) => language.code === locale)
        }
      >
        {editor(access.publish ? "publishEdit" : "submitDraft")}
      </button>
      {error && <p role="alert">{error.message}</p>}
      {(readError != null || refreshError != null) && (
        <div className="space-y-2">
          <p className="text-sm">
            {editor(refreshError ? "acceptedRefreshFailed" : "readFailed")}
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => {
              void retryRead();
            }}
          >
            {editor("retryRead")}
          </button>
        </div>
      )}
      {receipt?.intent === intent && (
        <p role="status">
          {editor(receipt.published ? "published" : "submitted")}
        </p>
      )}
    </form>
  );
}

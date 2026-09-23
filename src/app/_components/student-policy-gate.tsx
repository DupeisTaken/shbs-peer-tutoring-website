"use client";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Markdown } from "./markdown";
import { TimedActionDialog } from "./timed-action-dialog";
import { policyActionTarget, type PolicySlug } from "~/lib/policy-evidence";

/** The root layout persists across navigation. Refresh on visits and focus, and
 * prompt for published revisions only. Dismissal never grants participation. */
export function StudentPolicyGate() {
  const t = useTranslations("workflow");
  const path = usePathname();
  const search = useSearchParams().toString();
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Credential setup and recovery must stay usable before policy participation.
  const skipPolicyGate = [
    // A privacy notice must stay readable even when participation consent is due.
    "/privacy",
    "/signup",
    "/signup/account",
    "/signin",
    "/onboarding/email",
    "/forgot-password",
    "/reset-password",
    "/suspended",
    "/tutor-signup",
    "/crew-signup",
    "/viewer-signup",
  ].includes(path);
  const status = api.studentWorkflow.policyStatus.useQuery({ tuteeEntry: path === "/student" || path.startsWith("/student/") }, {
    enabled: !skipPolicyGate,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const { refetch } = status;
  useEffect(() => {
    if (skipPolicyGate) {
      setDismissed(null);
      return;
    }
    let active = true;
    const onFocus = () => {
      void (async () => {
        const result = await refetch();
        // React Query v5 refreshes on visibilitychange; native window focus also
        // matters when the user returns from another window without hiding this tab.
        if (active && !result.error) setDismissed(null);
      })();
    };
    // Query-only student tabs are visits too. Retain this visit's dismissal when
    // the revision is unchanged so personal navigation is not repeatedly interrupted.
    void refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [path, search, skipPolicyGate, refetch]);
  // A disabled query can still expose cached data or an earlier error.
  if (skipPolicyGate) return null;
  if (
    status.error ||
    (status.data && dismissed === `${status.data.slug}:${status.data.revision}`)
  )
    return (
      <aside
        className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-5xl rounded-lg border border-amber-200 bg-amber-50 p-4"
        role="status"
      >
        <p className="text-sm">
          {t(status.error ? "policyLoadError" : "policyHistoryAccess")}
        </p>
        <button
          className="btn-secondary mt-3"
          onClick={() => {
            if (status.error) void refetch();
            else setDismissed(null);
          }}
        >
          {t(status.error ? "retry" : "policyTitle")}
        </button>
      </aside>
    );
  return status.data ? (
    <PolicyPrompt
      key={`${status.data.slug}:${status.data.revision}`}
      policy={status.data}
      onDismiss={() =>
        setDismissed(`${status.data!.slug}:${status.data!.revision}`)
      }
    />
  ) : null;
}

function PolicyPrompt({
  policy,
  onDismiss,
}: {
  policy: {
    slug: string;
    revision: string;
    documents: {
      locale: string;
      title: string;
      body: string;
      version?: string | null;
    }[];
  };
  onDismiss: () => void;
}) {
  const locale = useLocale();
  const doc =
    policy.documents.find((d) => d.locale === locale) ??
    policy.documents.find((d) => d.locale === "en")!;
  // Remount the review when the displayed document changes, including translations.
  // Refetching the same content must not discard an in-progress review.
  return (
    <PolicyReview
      key={JSON.stringify([
        policy.slug,
        policy.revision,
        doc.locale,
        doc.title,
        doc.version,
        doc.body,
      ])}
      slug={policy.slug as PolicySlug}
      revision={policy.revision}
      doc={doc}
      onDismiss={onDismiss}
    />
  );
}

function PolicyReview({
  slug,
  revision,
  doc,
  onDismiss,
}: {
  slug: PolicySlug;
  revision: string;
  doc: { locale: string; title: string; body: string; version?: string | null };
  onDismiss: () => void;
}) {
  const t = useTranslations("workflow");
  const utils = api.useUtils();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const titleId = useId();
  const canAccept = hasRead && agreed;

  useEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const checkBottom = () => {
      // Ignore unlaid-out/hidden regions. A fully visible short policy needs no scroll.
      // Latch once reached so scrolling back up does not revoke this review.
      if (
        container.clientHeight > 0 &&
        container.scrollTop + container.clientHeight >=
          container.scrollHeight - 4
      ) {
        setHasRead(true);
      }
    };
    checkBottom();
    container.addEventListener("scroll", checkBottom, { passive: true });
    const observer = new ResizeObserver(checkBottom);
    observer.observe(container);
    observer.observe(content);
    return () => {
      container.removeEventListener("scroll", checkBottom);
      observer.disconnect();
    };
  }, [attempt]);
  const accept = api.studentWorkflow.acceptPolicy.useMutation({
    onSuccess: async () => {
      // Refresh both the global popup and local participation forms.
      await Promise.all([
        utils.studentWorkflow.policyStatus.invalidate(),
        utils.student.policy.invalidate(),
        utils.account.me.invalidate(),
      ]);
      router.refresh();
    },
  });
  return (
    <TimedActionDialog
      key={attempt}
      action="POLICY"
      target={policyActionTarget(slug, revision)}
      title={t("policyTitle")}
      message={t("policyConsequences")}
      canConfirm={canAccept}
      busy={accept.isPending}
      error={accept.error?.message}
      onCancel={onDismiss}
      onConfirm={(ticket) => {
        if (!canAccept) return;
        accept.mutate({
          slug,
          revision,
          ticket,
          agreed: true,
        });
      }}
    >
      <p className="text-sm text-slate-600">{t("policyHistoryAccess")}</p>
      <div
        ref={scrollRef}
        role="region"
        aria-labelledby={titleId}
        aria-describedby={!hasRead ? hintId : undefined}
        className="max-h-[25dvh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 sm:max-h-[40dvh]"
        tabIndex={0}
      >
        <div ref={contentRef}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="font-semibold">
              {doc.title}
            </h3>
            {doc.version && <span className="badge-slate">{doc.version}</span>}
          </div>
          <Markdown>{doc.body}</Markdown>
        </div>
      </div>
      {!hasRead && (
        <p id={hintId} className="text-sm text-slate-500">
          {t("policyScrollHint")}
        </p>
      )}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          disabled={!hasRead}
          aria-describedby={!hasRead ? hintId : undefined}
          onChange={(e) => {
            if (hasRead) setAgreed(e.target.checked);
          }}
          className="mt-1"
        />
        <span className={hasRead ? "text-slate-900" : "text-slate-400"}>
          {t("policyAgree")}
        </span>
      </label>
      <button
        className="btn-secondary btn-sm"
        disabled={accept.isPending}
        onClick={() => {
          // Retry renews even expired/preparation-failed tickets and rereads publication.
          accept.reset();
          setAgreed(false);
          setHasRead(false);
          setAttempt((value) => value + 1);
          void utils.studentWorkflow.policyStatus.invalidate();
        }}
      >
        {t("retry")}
      </button>
    </TimedActionDialog>
  );
}

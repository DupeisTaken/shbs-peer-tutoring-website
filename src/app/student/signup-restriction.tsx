"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

type Restriction = RouterOutputs["studentWorkflow"]["signupRestriction"];
type SourceRefresh = { queued: boolean; work: Promise<void> | null };
const RestrictionContext = createContext<{
  blocked: boolean;
  ready: boolean;
  error: boolean;
  retrying: boolean;
  refreshAfterSourceRead: () => Promise<void>;
} | null>(null);

export const useStudentSignupRestriction = () => useContext(RestrictionContext);

/** One query serves the header and Requests. Initial SSR evidence is retained;
 * normal identity invalidation rechecks it without another polling lifecycle. */
export function StudentSignupRestrictionProvider({
  initialRestriction,
  snapshotKey,
  children,
}: {
  initialRestriction: Restriction;
  snapshotKey: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const input = useMemo(
    () => ({ displayedTermId: initialRestriction.intakeTermId, snapshotKey }),
    [initialRestriction.intakeTermId, snapshotKey],
  );
  const key = useMemo(
    () => getQueryKey(api.studentWorkflow.signupRestriction, input, "query"),
    [input],
  );
  const query = api.studentWorkflow.signupRestriction.useQuery(input, {
    initialData: initialRestriction,
  });
  const { refetch } = query;
  const [checkingScope, setCheckingScope] = useState<string | null>(null);
  const checkingSources = checkingScope === snapshotKey;
  const sourceRefreshes = useRef(new Map<string, SourceRefresh>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const owners = sourceRefreshes.current;
    return () => {
      const owner = owners.get(snapshotKey);
      if (owner) owner.queued = false;
    };
  }, [snapshotKey]);
  const refreshAfterSourceRead = useCallback(() => {
    const sourceRefresh: SourceRefresh = sourceRefreshes.current.get(
      snapshotKey,
    ) ?? {
      queued: false,
      work: null,
    };
    sourceRefreshes.current.set(snapshotKey, sourceRefresh);
    sourceRefresh.queued = true;
    if (sourceRefresh.work) return sourceRefresh.work;
    setCheckingScope(snapshotKey);
    const pending = (async () => {
      // An older pending read cannot certify rows that were just refreshed.
      // Join it, then issue one read after those source results; coalesce siblings.
      if (client.getQueryState(key)?.fetchStatus === "fetching")
        await refetch({ cancelRefetch: false });
      while (sourceRefresh.queued && mounted.current) {
        sourceRefresh.queued = false;
        const result = await refetch({ cancelRefetch: false });
        if (result.error) break;
      }
    })();
    sourceRefresh.work = pending;
    void pending.finally(() => {
      sourceRefresh.work = null;
      if (mounted.current)
        setCheckingScope((scope) => (scope === snapshotKey ? null : scope));
    });
    return pending;
  }, [client, key, refetch, snapshotKey]);
  const samePeriod =
    query.data.intakeTermId === initialRestriction.intakeTermId;
  const refreshedPeriod = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (query.error || query.isFetching || samePeriod) return;
    if (refreshedPeriod.current === query.data.intakeTermId) return;
    refreshedPeriod.current = query.data.intakeTermId;
    // Refresh only after an authoritative period change. Hold creation while
    // the server replaces labels, permissions and the period namespace.
    router.refresh();
  }, [
    query.data.intakeTermId,
    query.error,
    query.isFetching,
    router,
    samePeriod,
  ]);
  return (
    <RestrictionContext.Provider
      value={{
        blocked: samePeriod && query.data.blocked,
        ready:
          samePeriod && !query.error && !query.isFetching && !checkingSources,
        error: !!query.error,
        retrying: query.isFetching || checkingSources,
        refreshAfterSourceRead,
      }}
    >
      {children}
    </RestrictionContext.Provider>
  );
}

export function StudentSignupAction({
  initiallyBlocked,
  departed,
}: {
  initiallyBlocked: boolean;
  departed: boolean;
}) {
  const restriction = useStudentSignupRestriction();
  const t = useTranslations("tuteePortal");
  if (
    departed ||
    (restriction ? restriction.blocked || !restriction.ready : initiallyBlocked)
  )
    return null;
  return (
    <Link href="/tutee" className="btn-primary" prefetch={false}>
      {t("requestTutor")}
    </Link>
  );
}

export function StudentSignupRestrictionFeedback() {
  const restriction = useStudentSignupRestriction();
  const t = useTranslations("participantRecovery");
  if (!restriction) return null;
  return (
    <QueryFeedback
      hasData
      loading={false}
      error={restriction.error}
      retrying={restriction.retrying}
      loadingTitle={t("loading")}
      errorTitle={t("refreshFailed")}
      retryLabel={t("retry")}
      onRetry={() => void restriction.refreshAfterSourceRead()}
    />
  );
}

"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  proposedAssignedCount,
  workloadWarning,
  type WorkloadProposal,
} from "~/lib/tutor-workload";
import { Button } from "./ui/button";
import { InlineNotice } from "./ui/patterns";

/** All assignment readers share a query key. A new route always checks current
 * workload; denial conceals/evicts private preferences until explicit recovery. */
export function useAssignmentWorkloads(enabled = true) {
  const client = useQueryClient();
  const [denied, setDenied] = useState(false);
  const query = api.admin.assignmentWorkloads.useQuery(undefined, {
    staleTime: 0,
    enabled: enabled && !denied,
  });
  const deniedNow =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (deniedNow && !denied) {
      setDenied(true);
      client.removeQueries({
        queryKey: getQueryKey(
          api.admin.assignmentWorkloads,
          undefined,
          "query",
        ),
      });
    } else if (
      denied &&
      query.isSuccess &&
      query.data !== undefined &&
      !deniedNow
    ) {
      // A sibling's explicit retry refreshes this same evicted query key. Release
      // every reader's latch only after that fresh authorized response succeeds.
      setDenied(false);
    }
  }, [client, denied, deniedNow, query.isSuccess, query.data]);
  const retry = async () => {
    const result = await query.refetch();
    if (result.isSuccess) setDenied(false);
  };
  return {
    ...query,
    data: denied || deniedNow ? undefined : query.data,
    unavailable: denied || deniedNow,
    retry,
  };
}

export function AssignmentWorkloadFeedback() {
  const t = useTranslations("tutorWorkload");
  const query = useAssignmentWorkloads();
  if (!query.error && !query.unavailable && query.data) return null;
  const failed = Boolean(query.error) || query.unavailable;
  return (
    <InlineNotice
      tone={failed ? "error" : "info"}
      announcement={failed ? "alert" : "status"}
      action={
        failed && (
          <Button
            size="compact"
            disabled={query.isFetching}
            onClick={() => void query.retry()}
          >
            {t("retry")}
          </Button>
        )
      }
    >
      {t(query.unavailable ? "denied" : query.error ? "loadFailed" : "loading")}
    </InlineNotice>
  );
}

/** Advisory content stays visible beside the selector and inside the existing
 * qualification review. It never adds an acknowledgement, timer or permission. */
export function AssignmentWorkloadAdvice({
  tutorId,
  proposals,
}: {
  tutorId: string;
  proposals?: WorkloadProposal[];
}) {
  const t = useTranslations("tutorWorkload");
  const query = useAssignmentWorkloads();
  const tutor = query.data?.tutors?.find((row) => row.id === tutorId);
  if (!tutor)
    return (
      <p className="text-xs text-slate-600">
        {t(
          !query.error &&
            !query.unavailable &&
            (query.isLoading || query.isFetching || query.data === undefined)
            ? "loading"
            : "unavailable",
        )}
      </p>
    );
  if (query.error || query.isFetching)
    return (
      <p role="status" className="text-xs text-slate-600">
        {t(query.error ? "stale" : "rechecking", { count: tutor.count })}
      </p>
    );
  const projection = proposedAssignedCount(
    tutor.blocks,
    proposals ??
      (query.data?.termId
        ? [
            {
              block: {
                id: "proposed-unscheduled",
                termId: query.data.termId,
                scheduleConfirmed: false,
                dayOfWeek: 1,
                startMin: 0,
                endMin: 1,
              },
            },
          ]
        : []),
  );
  const warning = workloadWarning(
    tutor.count,
    projection,
    tutor.preferredMaximum,
  );
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">
        {t("current", { count: tutor.count })} ·{" "}
        {tutor.preferredMaximum === null
          ? t("unset")
          : t("savedPreference", { count: tutor.preferredMaximum })}
      </p>
      {warning && (
        <InlineNotice tone="warning" announcement="status">
          {t(warning, {
            count: tutor.count,
            proposed: projection,
            maximum: tutor.preferredMaximum!,
          })}
        </InlineNotice>
      )}
    </div>
  );
}

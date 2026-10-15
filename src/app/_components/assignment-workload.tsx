"use client";
import { useEffect, useState, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  proposedAssignedCount,
  type WorkloadProposal,
} from "~/lib/tutor-workload";
import { AssignmentConfirmation } from "./assignment-confirmation";
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

/** Workload review happens only after submission. It shares the qualification
 * dialog and remains advisory: Continue uses the original assignment operation. */
export function WorkloadAssignmentConfirmation({
  tutorId,
  proposals,
  ...confirmation
}: Omit<
  ComponentProps<typeof AssignmentConfirmation>,
  "advisory" | "workloadReview"
> & {
  tutorId: string;
  proposals?: WorkloadProposal[];
}) {
  const t = useTranslations("tutorWorkload");
  const query = useAssignmentWorkloads();
  const tutor = query.data?.tutors?.find((row) => row.id === tutorId);
  const projection = tutor?.assignable
    ? proposedAssignedCount(
        tutor.blocks,
        proposals?.map((proposal) => ({
          ...proposal,
          block:
            proposal.block?.termId === query.data?.termId
              ? proposal.block
              : undefined,
        })) ??
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
      )
    : (tutor?.count ?? 0);
  const pending =
    !query.error &&
    !query.unavailable &&
    (query.isLoading || query.isFetching || query.data === undefined);
  const warning =
    !pending &&
    !query.error &&
    tutor?.assignable &&
    tutor.preferredMaximum !== null &&
    projection > tutor.preferredMaximum
      ? t("proposedOver", {
          count: tutor.count,
          proposed: projection,
          maximum: tutor.preferredMaximum,
        })
      : null;
  return (
    <AssignmentConfirmation
      {...confirmation}
      workloadReview={{ pending, warning }}
    />
  );
}

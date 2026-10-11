"use client";

import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { RequestInvalidity, type InvalidityRecord } from "./request-invalidity";

type Props = {
  record: InvalidityRecord;
  name: string;
  canFlag: boolean;
  coordinator?: boolean;
};

/** Mount these adapters only for staff. Refreshes synchronize related readers,
 * then fetch the exact row before an explicit draft reload adopts its version. */
export function ApplicationInvalidityControls(props: Props) {
  const t = useTranslations("requestInvalidity");
  const utils = api.useUtils();
  const mutation = api.admin.setApplicationInvalidity.useMutation();
  return (
    <RequestInvalidity
      {...props}
      reviewKey={`application:${props.record.id}`}
      onCommit={mutation.mutateAsync}
      onRefresh={async () => {
        await settleRefreshes([
          () => invalidateAndReport(utils.admin.tutorApplications),
          () => invalidateAndReport(utils.interviewManagement.options),
        ]);
        const rows = await utils.admin.tutorApplications.fetch(undefined, {
          staleTime: 0,
        });
        const fresh = rows.find((row) => row.id === props.record.id);
        if (!fresh) throw new Error(t("missing"));
        return fresh;
      }}
    />
  );
}

export function StudentRequestInvalidityControls(props: Props) {
  const t = useTranslations("requestInvalidity");
  const utils = api.useUtils();
  const mutation = api.studentWorkflow.setRequestInvalidity.useMutation();
  return (
    <RequestInvalidity
      {...props}
      reviewKey={`survey:${props.record.id}`}
      onCommit={mutation.mutateAsync}
      onRefresh={async () => {
        await settleRefreshes([
          () => invalidateAndReport(utils.studentWorkflow.adminRequests),
          () => invalidateAndReport(utils.admin.tutees),
        ]);
        const rows = await utils.studentWorkflow.adminRequests.fetch(
          undefined,
          { staleTime: 0 },
        );
        const fresh = rows.find((row) => row.id === props.record.id);
        if (!fresh) throw new Error(t("missing"));
        return fresh;
      }}
    />
  );
}

export function SignupInvalidityControls(props: Props) {
  const t = useTranslations("requestInvalidity");
  const utils = api.useUtils();
  const mutation = api.admin.setSignupInvalidity.useMutation();
  return (
    <RequestInvalidity
      {...props}
      reviewKey={`signup:${props.record.id}`}
      onCommit={mutation.mutateAsync}
      onRefresh={async () => {
        await settleRefreshes([
          () => invalidateAndReport(utils.admin.tutees),
          () => invalidateAndReport(utils.studentWorkflow.adminRequests),
        ]);
        const rows = await utils.admin.tutees.fetch(undefined, {
          staleTime: 0,
        });
        const fresh = rows.find((row) => row.id === props.record.id);
        if (!fresh) throw new Error(t("missing"));
        return fresh;
      }}
    />
  );
}

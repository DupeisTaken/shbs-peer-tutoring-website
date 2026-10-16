import type { ReactNode } from "react";
import { Button } from "./button";
import { InlineNotice, StatePanel } from "./patterns";

export type QueryFeedbackProps = {
  /** Presence, not record count. An empty array is a completed read. */
  hasData: boolean;
  /** Include the caller's initial pending/unknown state, not just active fetching. */
  loading: boolean;
  error: boolean;
  retrying?: boolean;
  loadingTitle: string;
  errorTitle: string;
  retryLabel: string;
  errorDetail?: ReactNode;
  onRetry: () => void;
};

/** Read feedback only. The feature owns query execution, empty/denied states,
 * safe cached content and drafts; this component never mounts or hides them. */
export function QueryFeedback({
  hasData,
  loading,
  error,
  retrying = false,
  loadingTitle,
  errorTitle,
  retryLabel,
  errorDetail,
  onRetry,
}: QueryFeedbackProps) {
  if (error) {
    const retry = (
      <Button size="compact" disabled={retrying} onClick={onRetry}>
        {retryLabel}
      </Button>
    );
    return hasData ? (
      <InlineNotice tone="error" announcement="alert" action={retry}>
        <p className="font-medium">{errorTitle}</p>
        {errorDetail && <div className="mt-1">{errorDetail}</div>}
      </InlineNotice>
    ) : (
      <StatePanel kind="error" title={errorTitle} action={retry}>
        {errorDetail}
      </StatePanel>
    );
  }
  if (!hasData && loading)
    return <StatePanel kind="loading" title={loadingTitle} />;
  return null;
}

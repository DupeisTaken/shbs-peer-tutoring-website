"use client";

import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { RoomGrid } from "~/app/_components/room-grid";
import { Button } from "~/app/_components/ui/button";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";

/** Hydrate the existing authorized server projection into a live query. Slot
 * saves can now refresh occupancy without replacing independent dashboard drafts. */
export function TutorRoomSchedule({
  initialData,
}: {
  initialData: RouterOutputs["tutor"]["schedule"];
}) {
  const t = useTranslations("roomAllocation");
  const query = api.tutor.schedule.useQuery(undefined, { initialData });
  const denied = useSessionAccessDenied(query);
  const recovery = useTranslations("managementRecovery");
  const table = useTranslations("tablePatterns");
  if (denied || !query.data)
    return (
      <StatePanel
        kind={denied ? "denied" : query.error ? "error" : "loading"}
        title={
          denied
            ? recovery("denied", { section: table("schedule") })
            : query.error
              ? t("readFailed")
              : t("loading")
        }
        action={
          query.error ? (
            <Button onClick={() => void query.refetch()}>
              {t("retryRefresh")}
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <div className="space-y-3">
      {query.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button onClick={() => void query.refetch()}>
              {t("retryRefresh")}
            </Button>
          }
        >
          {t("readFailed")}
        </InlineNotice>
      )}
      <RoomGrid
        {...query.data}
        highlightTutorId={query.data.myTutorId}
        catalogReady={!query.isLoading}
        viewEnabled={!denied}
      />
    </div>
  );
}

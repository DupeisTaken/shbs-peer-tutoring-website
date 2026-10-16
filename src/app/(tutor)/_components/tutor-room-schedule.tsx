"use client";

import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { RoomGrid } from "~/app/_components/room-grid";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice } from "~/app/_components/ui/patterns";

/** Hydrate the existing authorized server projection into a live query. Slot
 * saves can now refresh occupancy without replacing independent dashboard drafts. */
export function TutorRoomSchedule({
  initialData,
}: {
  initialData: RouterOutputs["tutor"]["schedule"];
}) {
  const t = useTranslations("roomAllocation");
  const query = api.tutor.schedule.useQuery(undefined, { initialData });
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
      <RoomGrid {...query.data} highlightTutorId={query.data.myTutorId} />
    </div>
  );
}

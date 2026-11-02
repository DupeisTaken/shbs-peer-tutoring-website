"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { MessageInbox } from "./message-inbox";
import { ProfileDialog } from "./profile-dialog";
import { Button } from "./ui/button";
import { StatePanel } from "./ui/patterns";

/** Opening only reads scoped contacts. A retained owner preserves its draft on Close. */
export function SessionCoordinateMessage({
  cohortId,
  label,
}: {
  cohortId: string;
  label?: string;
}) {
  const t = useTranslations("sessionPlanning");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const title = label ?? t("message");
  return (
    <>
      <Button
        size="compact"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        {title}
      </Button>
      {mounted && (
        <ScopedComposer
          cohortId={cohortId}
          title={title}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ScopedComposer({
  cohortId,
  title,
  open,
  onClose,
}: {
  cohortId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("sessionPlanning");
  const contacts = api.messaging.recipients.useQuery({
    sessionCohortId: cohortId,
  });
  const denied =
    contacts.error?.data?.code === "FORBIDDEN" ||
    contacts.error?.data?.code === "UNAUTHORIZED";
  if (denied || !contacts.data)
    return open ? (
      <ProfileDialog title={title} onClose={onClose}>
        <StatePanel
          kind={denied ? "denied" : contacts.error ? "error" : "loading"}
          title={t(
            denied
              ? "messageUnavailable"
              : contacts.error
                ? "loadFailed"
                : "load",
          )}
          action={
            contacts.error ? (
              <Button onClick={() => void contacts.refetch()}>
                {t("retry")}
              </Button>
            ) : undefined
          }
        />
      </ProfileDialog>
    ) : null;
  if (!contacts.data.people.length)
    return open ? (
      <ProfileDialog title={title} onClose={onClose}>
        <StatePanel kind="empty" title={t("messageUnavailable")} />
      </ProfileDialog>
    ) : null;
  return (
    <MessageInbox
      viewScope={`session:${cohortId}`}
      sessionCohortId={cohortId}
      initialRecipients={contacts.data.people}
      dialog={{ open, title, onClose }}
    />
  );
}

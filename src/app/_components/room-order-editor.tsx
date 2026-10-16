"use client";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import { FormActions, InlineNotice } from "./ui/patterns";
import { queuedApprovalId } from "~/lib/approval-outcome";

type RoomIdentity = { id: string; name: string };

/** Own one complete-order draft while the caller renders its existing ID-keyed room editors. */
export function RoomOrderEditor<Room extends RoomIdentity>({
  rooms,
  canEdit,
  canApply = false,
  onRefresh,
  children,
}: {
  rooms: Room[];
  canEdit: boolean;
  canApply?: boolean;
  onRefresh: () => Promise<RoomIdentity[]>;
  children: (room: Room, controls: ReactNode) => ReactNode;
}) {
  const t = useTranslations("roomOrder");
  const approvals = useTranslations("approvals");
  const [ids, setIds] = useState(() => rooms.map((room) => room.id));
  const [expectedIds, setExpectedIds] = useState(ids);
  const [readPending, setReadPending] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  const committed = useRef(false);
  const [accepted, setAccepted] = useState(false);
  const admitted = useRef(false);
  const queued = useRef(false);
  const movedControl = useRef<HTMLButtonElement | null>(null);
  const save = api.admin.reorderRooms.useMutation();
  const busy = save.isPending || readPending;
  const currentIds = new Set(rooms.map((room) => room.id));
  const catalogChanged =
    currentIds.size !== expectedIds.length ||
    expectedIds.some((id) => !currentIds.has(id));
  // Current room data appears once, including new rooms, without adopting a new version.
  const orderedRooms = [
    ...ids.flatMap((id) => rooms.find((room) => room.id === id) ?? []),
    ...rooms.filter((room) => !ids.includes(room.id)),
  ];
  useLayoutEffect(() => {
    // Keep the exact arrow when usable; at an endpoint use its enabled sibling.
    const control = movedControl.current;
    const target = control?.disabled
      ? control.parentElement?.querySelector<HTMLButtonElement>(
          "button:not(:disabled)",
        )
      : control;
    target?.focus({ preventScroll: true });
    movedControl.current = null;
  }, [ids]);
  const sync = async () => {
    setReadPending(true);
    setReloadError(false);
    try {
      const latest = await onRefresh();
      setIds(latest.map((room) => room.id));
      setExpectedIds(latest.map((room) => room.id));
      setReadFailed(false);
      committed.current = queued.current;
      setAccepted(queued.current);
      if (!queued.current) save.reset();
    } catch {
      if (committed.current) setReadFailed(true);
      else setReloadError(true);
    } finally {
      setReadPending(false);
    }
  };
  const move = (index: number, offset: number, control: HTMLButtonElement) => {
    if (
      !canEdit ||
      busy ||
      committed.current ||
      catalogChanged ||
      index + offset < 0 ||
      index + offset >= ids.length
    )
      return;
    movedControl.current = control;
    setIds((before) => {
      const next = [...before];
      [next[index], next[index + offset]] = [
        next[index + offset]!,
        next[index]!,
      ];
      return next;
    });
    setSaved(false);
  };
  return (
    <section className="space-y-4" aria-label={t("title")}>
      <p className="muted">{t("help")}</p>
      {catalogChanged && (
        <InlineNotice tone="warning">{t("catalogChanged")}</InlineNotice>
      )}
      {orderedRooms.map((room, index) => (
        <Fragment key={room.id}>
          {children(
            room,
            <>
              <Button
                aria-label={t("moveUpName", { name: room.name })}
                disabled={
                  !canEdit || busy || accepted || catalogChanged || index === 0
                }
                onClick={(event) => move(index, -1, event.currentTarget)}
              >
                ↑
              </Button>
              <Button
                aria-label={t("moveDownName", { name: room.name })}
                disabled={
                  !canEdit ||
                  busy ||
                  accepted ||
                  catalogChanged ||
                  index === orderedRooms.length - 1
                }
                onClick={(event) => move(index, 1, event.currentTarget)}
              >
                ↓
              </Button>
            </>,
          )}
        </Fragment>
      ))}
      <FormActions>
        <Button
          variant="primary"
          disabled={
            !canEdit ||
            busy ||
            accepted ||
            catalogChanged ||
            JSON.stringify(ids) === JSON.stringify(expectedIds)
          }
          onClick={async () => {
            if (
              !canEdit ||
              busy ||
              admitted.current ||
              committed.current ||
              catalogChanged
            )
              return;
            admitted.current = true;
            try {
              await save.mutateAsync({ ids, expectedIds });
              committed.current = true;
              setAccepted(true);
              setSaved(true);
              await sync();
            } catch (error) {
              if (queuedApprovalId(error)) {
                queued.current = true;
                committed.current = true;
                setAccepted(true);
              }
            } finally {
              admitted.current = false;
            }
          }}
        >
          {busy ? t("saving") : canApply ? t("save") : t("request")}
        </Button>
        <Button disabled={busy} onClick={() => void sync()}>
          {t("reload")}
        </Button>
      </FormActions>
      {saved && (
        <InlineNotice tone="success" announcement="status">
          {t("saved")}
        </InlineNotice>
      )}
      {save.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {approvals("queuedBody")}
        </InlineNotice>
      )}
      {save.error && !save.error.data?.approvalId && (
        <InlineNotice tone="error" announcement="alert">
          {save.error.message}
        </InlineNotice>
      )}
      {(readFailed || reloadError) && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={busy} onClick={() => void sync()}>
              {t("refresh")}
            </Button>
          }
        >
          {t(readFailed ? "refreshFailed" : "loadFailed")}
        </InlineNotice>
      )}
    </section>
  );
}

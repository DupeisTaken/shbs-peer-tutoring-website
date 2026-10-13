"use client";
import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import { FormActions, InlineNotice, SettingRow } from "./ui/patterns";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import { SummaryTable, TableAction, TableActions } from "./ui/summary-table";
import { queuedApprovalId } from "~/lib/approval-outcome";
type RoomIdentity = { id: string; name: string };
function RoomOrderDialogBody({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  // Register this owner's work once; never feed the aggregate dialog busy state back.
  useDialogPending(pending);
  return <div className="space-y-4">{children}</div>;
}
/** A staged complete order creates one auditable write; hidden room detail drafts stay keyed by ID. */
export function RoomOrderEditor({
  rooms,
  canEdit,
  canApply = false,
  onRefresh,
}: {
  rooms: RoomIdentity[];
  canEdit: boolean;
  canApply?: boolean;
  onRefresh: () => Promise<RoomIdentity[]>;
}) {
  const t = useTranslations("roomOrder");
  const [open, setOpen] = useState(false);
  const approvals = useTranslations("approvals");
  const [original, setOriginal] = useState(rooms);
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
  const save = api.admin.reorderRooms.useMutation();
  const busy = save.isPending || readPending;
  const sync = async () => {
    setReadPending(true);
    setReloadError(false);
    try {
      const latest = await onRefresh();
      setOriginal(latest);
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
  const move = (index: number, offset: number) => {
    if (!canEdit || busy || committed.current) return;
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
    <section className="card space-y-4 p-5">
      <SettingRow
        label={t("title")}
        description={t("help")}
        control={
          <Button disabled={!canEdit || busy} onClick={() => setOpen(true)}>
            {t("open")}
          </Button>
        }
      />
      {open && (
        <ProfileDialog
          title={t("title")}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <RoomOrderDialogBody pending={busy}>
            <SummaryTable label={t("title")}>
              <thead>
                <tr>
                  <th>{t("room")}</th>
                  <th className="table-actions-heading">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {ids.map((id, index) => (
                  <tr key={id}>
                    <td>
                      {original.find((room) => room.id === id)?.name ?? id}
                    </td>
                    <TableActions>
                      <TableAction
                        disabled={!canEdit || busy || accepted || index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={t("moveUpName", {
                          name:
                            original.find((room) => room.id === id)?.name ?? id,
                        })}
                      >
                        {t("up")}
                      </TableAction>
                      <TableAction
                        disabled={
                          !canEdit ||
                          busy ||
                          accepted ||
                          index === ids.length - 1
                        }
                        onClick={() => move(index, 1)}
                        aria-label={t("moveDownName", {
                          name:
                            original.find((room) => room.id === id)?.name ?? id,
                        })}
                      >
                        {t("down")}
                      </TableAction>
                    </TableActions>
                  </tr>
                ))}
              </tbody>
            </SummaryTable>
            <FormActions>
              <Button
                variant="primary"
                disabled={
                  !canEdit ||
                  busy ||
                  accepted ||
                  JSON.stringify(ids) === JSON.stringify(expectedIds)
                }
                onClick={async () => {
                  if (!canEdit || busy || admitted.current || committed.current)
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
          </RoomOrderDialogBody>
        </ProfileDialog>
      )}
    </section>
  );
}

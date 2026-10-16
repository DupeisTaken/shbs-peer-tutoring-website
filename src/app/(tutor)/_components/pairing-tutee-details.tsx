"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { TableAction } from "~/app/_components/ui/summary-table";
import { useDialogBusy } from "~/app/_components/ui/modal";
import { useDialog } from "~/app/_components/confirm-dialog";
import { StudentScheduleAction } from "./student-schedule-action";

type Props = {
  pairingId: string;
  tuteeId: string;
  name: string;
  subject: string;
  active: boolean;
  row?: RouterOutputs["studentWorkflow"]["tutorRoster"][number];
  pendingRequest?: RouterOutputs["tutor"]["myTuteeRemovalRequests"][number];
  ready: boolean;
  failed: boolean;
  onRetry: () => void;
};

/** Read the dialog's aggregate busy state without registering it as another write. */
function DialogControls({
  children,
}: {
  children: (busy: boolean) => ReactNode;
}) {
  return children(useDialogBusy());
}

/** One retained owner per assignment: closing the reader never serializes or loses
 * either independent reason draft. Tickets are prepared only in the nested review. */
export function PairingTuteeDetails(props: Props) {
  const { name, subject, pairingId, tuteeId, row, pendingRequest, active } =
    props;
  const t = useTranslations();
  const format = useFormatter();
  const { confirm, dialog } = useDialog();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [reason, setReason] = useState("");
  const [scheduleReason, setScheduleReason] = useState("");
  const [lastAction, setLastAction] = useState<"request" | "recall" | null>(
    null,
  );
  const request = api.tutor.requestTuteeRemoval.useMutation({
    onSuccess: async () => {
      setComposing(false);
      setReason("");
      await utils.tutor.myTuteeRemovalRequests.invalidate();
    },
  });
  const recall = api.tutor.recallTuteeRemoval.useMutation({
    onSuccess: () => utils.tutor.myTuteeRemovalRequests.invalidate(),
  });
  const relayAllowed =
    active && props.ready && !props.failed && !row?.managed && !pendingRequest;
  const recallId =
    !props.failed && !row?.managed ? pendingRequest?.id : undefined;
  const eligibility = useRef({ relayAllowed, recallId, pending: false });
  useLayoutEffect(() => {
    // A confirmation may outlive a read/status transition. Check committed
    // current eligibility after awaiting, never the opener's old snapshot.
    eligibility.current = {
      relayAllowed,
      recallId,
      pending: request.isPending || recall.isPending,
    };
  }, [relayAllowed, recallId, request.isPending, recall.isPending]);
  const feedback =
    lastAction === "request"
      ? request
      : lastAction === "recall"
        ? recall
        : null;
  return (
    <>
      <TableAction
        onClick={() => setOpen(true)}
        aria-label={`${t("tablePatterns.details")}: ${name}`}
        aria-haspopup="dialog"
      >
        {t("tablePatterns.details")}
      </TableAction>
      {open && (
        <ProfileDialog
          title={`${name} · ${subject}`}
          onClose={() => setOpen(false)}
          pending={request.isPending || recall.isPending}
        >
          {dialog}
          {props.failed && (
            <div role="alert" className="mb-3 text-sm text-red-700">
              <p>{t("tutor.tasks.loadError")}</p>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={props.onRetry}
              >
                {t("tutor.tasks.retry")}
              </button>
            </div>
          )}
          {row ? (
            <StudentScheduleAction
              row={row}
              active={active && !props.failed}
              name={name}
              draft={{ value: scheduleReason, onChange: setScheduleReason }}
            />
          ) : (
            <p className="muted text-sm">
              {t(
                props.ready
                  ? "tutor.pairings.availabilityMissing"
                  : "tutor.pairings.loading",
              )}
            </p>
          )}
          {!row?.managed &&
            (!!pendingRequest ||
              (active && props.ready && !props.failed) ||
              !!feedback) && (
              <DialogControls>
                {(busy) => (
                  <section className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                    {pendingRequest ? (
                      <>
                        <p>
                          <span className="badge-amber">
                            {t("tutor.pairings.removalPending")}
                          </span>
                        </p>
                        {pendingRequest.eligibleAt && (
                          <p className="text-xs text-amber-800">
                            {t("tutor.tasks.recallDeadline", {
                              date: format.dateTime(pendingRequest.eligibleAt, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }),
                            })}
                          </p>
                        )}
                        {/* Existing pending relays remain recallable by inactive tutors. */}
                        <TableAction
                          disabled={busy || props.failed}
                          onClick={async () => {
                            if (
                              await confirm({
                                title: t("tutor.pairings.removalRecall"),
                                message: t("tutor.tasks.recallRemoval", {
                                  name,
                                  subject,
                                }),
                                confirmLabel: t("tutor.pairings.removalRecall"),
                                cancelLabel: t("common.cancel"),
                              })
                            ) {
                              if (
                                eligibility.current.pending ||
                                eligibility.current.recallId !==
                                  pendingRequest.id
                              )
                                return;
                              setLastAction("recall");
                              recall.mutate({ requestId: pendingRequest.id });
                            }
                          }}
                        >
                          {t("tutor.pairings.removalRecall")}
                        </TableAction>
                      </>
                    ) : active && props.ready && !props.failed ? (
                      composing ? (
                        <>
                          <p className="muted text-sm">
                            {t("tutor.pairings.removalHelp")}
                          </p>
                          <textarea
                            className="textarea w-full text-sm"
                            rows={2}
                            maxLength={1000}
                            aria-label={t(
                              "tutor.pairings.removalReasonPlaceholder",
                            )}
                            placeholder={t(
                              "tutor.pairings.removalReasonPlaceholder",
                            )}
                            value={reason}
                            disabled={busy}
                            onChange={(event) => setReason(event.target.value)}
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  !(await confirm({
                                    title: t("tutor.pairings.requestRemoval"),
                                    message: t("tutor.tasks.confirmRemoval", {
                                      name,
                                      subject,
                                    }),
                                    confirmLabel: t(
                                      "tutor.pairings.removalSubmit",
                                    ),
                                    cancelLabel: t("common.cancel"),
                                  }))
                                )
                                  return;
                                if (
                                  !eligibility.current.relayAllowed ||
                                  eligibility.current.pending
                                )
                                  return;
                                setLastAction("request");
                                request.mutate({
                                  pairingId,
                                  tuteeId,
                                  reason: reason.trim() || undefined,
                                });
                              }}
                            >
                              {t("tutor.pairings.removalSubmit")}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() => setComposing(false)}
                            >
                              {t("tutor.pairings.removalCancel")}
                            </button>
                          </div>
                        </>
                      ) : (
                        <TableAction
                          disabled={busy}
                          onClick={() => {
                            setComposing(true);
                            setLastAction(null);
                          }}
                        >
                          {t("tutor.pairings.requestRemoval")}
                        </TableAction>
                      )
                    ) : null}
                    {feedback?.error && (
                      <p role="alert" className="text-sm text-red-700">
                        {feedback.error.message}
                      </p>
                    )}
                    {feedback?.isSuccess && (
                      <p role="status" className="text-sm text-green-700">
                        {t(
                          lastAction === "request"
                            ? "tutor.tasks.removalSubmitted"
                            : "workflows.saved",
                        )}
                      </p>
                    )}
                  </section>
                )}
              </DialogControls>
            )}
        </ProfileDialog>
      )}
    </>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { TutorWorkloadPreference } from "~/app/_components/tutor-workload-preference";
import { AvailabilityEditor } from "./availability-editor";

/** Keep timetable and workload editing in an entrance card matching SubjectWillingness,
 * while retaining both independent form drafts across dialog close and reopen. */
export function TimeAvailability({ active }: { active: boolean }) {
  const t = useTranslations("dashboard.availability");
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const [workloadPending, setWorkloadPending] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const hiddenHostRef = useRef<HTMLDivElement>(null);
  const dialogBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Run after the modal is unmounted and the page is no longer inert, even in background tabs.
    if (!open && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!portalHost) return;
    // Move one stable portal container between the open dialog and hidden storage so
    // React never unmounts either independent form or discards its draft/recovery state.
    const container = open ? dialogBodyRef.current : hiddenHostRef.current;
    if (container && portalHost.parentNode !== container) {
      container.appendChild(portalHost);
    }
  }, [open, portalHost]);

  if (!active) {
    return (
      <section className="card p-4 sm:p-5">
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1 mb-4 max-w-xl text-sm leading-relaxed">
          {t("help")}
        </p>
        <TutorWorkloadPreference summaryOnly />
      </section>
    );
  }

  const openDialog = () => {
    setPortalHost((current) => current ?? document.createElement("div"));
    setOpen(true);
  };

  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
  };

  return (
    <section className="card flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0 flex-1">
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1 max-w-xl text-sm leading-relaxed">
          {t("help")}
        </p>
      </div>
      <button
        ref={trigger}
        type="button"
        className="btn-secondary min-h-11 shrink-0 gap-3 whitespace-normal lg:min-h-10"
        onClick={openDialog}
      >
        {t("edit")}
        <span aria-hidden="true">↗</span>
      </button>
      <div ref={hiddenHostRef} hidden />
      {open && (
        <ProfileDialog
          title={t("title")}
          onClose={close}
          size="wide"
          pending={availabilityPending || workloadPending}
        >
          <p className="muted mb-4 text-sm leading-relaxed">{t("help")}</p>
          <div ref={dialogBodyRef} />
        </ProfileDialog>
      )}
      {portalHost &&
        createPortal(
          <>
            <AvailabilityEditor onPendingChange={setAvailabilityPending} />
            {/* Independent sibling forms retain their own drafts and save recovery. */}
            <TutorWorkloadPreference
              embedded
              onPendingChange={setWorkloadPending}
            />
          </>,
          portalHost,
        )}
    </section>
  );
}

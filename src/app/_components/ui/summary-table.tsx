"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { Modal } from "./modal";
import { Button } from "./button";
import { ProfileDialog } from "../profile-dialog";

/** Summary cells stay brief; the last column owns every detail/editor entry.
 * The local scroll region preserves column relationships and keeps actions reachable.
 */
export function SummaryTable({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className="summary-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table
        aria-label={label}
        className={`data-table summary-table ${className}`}
      >
        {children}
      </table>
    </div>
  );
}

/** Keep the same text-link treatment and touch area for all row actions. */
export function TableAction({
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={`table-action-link ${className}`}
      {...props}
    />
  );
}

export function TableActions({ children }: { children: ReactNode }) {
  return (
    <td className="table-actions">
      <div className="table-action-list">{children}</div>
    </td>
  );
}

/** Detail content mounts only on demand; hidden rows do not run detail queries. */
export function TableDetails({
  label,
  title,
  children,
  longReader = false,
}: {
  label?: string;
  title: string;
  children: ReactNode;
  /** Large read details reuse the reachable header Close; short dialogs stay compact. */
  longReader?: boolean;
}) {
  const t = useTranslations("tablePatterns");
  const [open, setOpen] = useState(false);
  const text = label ?? t("details");
  const content = (
    <div className="space-y-4 text-left text-sm [overflow-wrap:anywhere] whitespace-normal">
      {children}
    </div>
  );
  return (
    <>
      <TableAction
        aria-label={`${text}: ${title}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {text}
      </TableAction>
      {open &&
        (longReader ? (
          <ProfileDialog
            title={title}
            size="wide"
            onClose={() => setOpen(false)}
          >
            {content}
          </ProfileDialog>
        ) : (
          createPortal(
            <Modal
              title={title}
              wide
              onClose={() => setOpen(false)}
              footer={
                <Button data-dialog-autofocus onClick={() => setOpen(false)}>
                  {t("close")}
                </Button>
              }
            >
              {content}
            </Modal>,
            document.body,
          )
        ))}
    </>
  );
}

"use client";

import type { ReactNode } from "react";
import { FormSection } from "./ui/patterns";
import { useDialogBusy } from "./ui/modal";

/** The fieldset lives inside the dialog provider, so a write in any independent
 * profile section freezes this draft without combining their forms or versions. */
export function ProfileEditSection({
  title,
  busy,
  children,
  actions,
  className,
}: {
  title: string;
  busy: boolean;
  children: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  const dialogBusy = useDialogBusy();
  return (
    <FormSection title={title} busy={busy || dialogBusy} actions={actions}>
      <div className={className ?? "space-y-4"}>{children}</div>
    </FormSection>
  );
}

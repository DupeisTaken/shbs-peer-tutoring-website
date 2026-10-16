"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";

export type CreationRiskKind = "tutor" | "tutee" | "pairing";

/** Mount a fresh gate for each opening. This acknowledgment opens an editor;
 * the feature still owns its retained draft, permissions and actual write. */
export function CreationRiskDialog({
  kind,
  onCancel,
  onContinue,
  continueDisabled = false,
}: {
  kind: CreationRiskKind;
  onCancel: () => void;
  onContinue: () => void | boolean;
  continueDisabled?: boolean;
}) {
  const t = useTranslations("admin.creationRisk");
  const [acknowledged, setAcknowledged] = useState(false);
  const settled = useRef(false);
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };
  return (
    <Modal
      title={t(`${kind}.title`)}
      description={t("warning")}
      onClose={cancel}
      footer={
        <>
          <Button data-dialog-autofocus onClick={cancel}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!acknowledged || continueDisabled}
            onClick={() => {
              // Exclude same-tick repeats even before React unmounts the gate.
              if (!acknowledged || continueDisabled || settled.current) return;
              // A feature can reject admission after a live permission/read
              // change. Keep cancellation and a later explicit retry available.
              if (onContinue() !== false) settled.current = true;
            }}
          >
            {t("continue")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p>{t(`${kind}.normal`)}</p>
        <p>{t(`${kind}.risk`)}</p>
        <p className="muted text-sm">{t("opensOnly")}</p>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-1 shrink-0"
          />
          <span>{t("acknowledgement")}</span>
        </label>
      </div>
    </Modal>
  );
}

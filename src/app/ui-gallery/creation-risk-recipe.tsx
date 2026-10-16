"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  CreationRiskDialog,
  type CreationRiskKind,
} from "~/app/_components/creation-risk-dialog";
import { Button } from "~/app/_components/ui/button";
import { Modal } from "~/app/_components/ui/modal";

/** No server work: retained feature state survives each fresh acknowledgment. */
export function CreationRiskRecipe() {
  const t = useTranslations("admin.creationRisk");
  const [kind, setKind] = useState<CreationRiskKind>("pairing");
  const [phase, setPhase] = useState<"gate" | "editor" | null>(null);
  const [draft, setDraft] = useState("");
  return (
    <section className="card space-y-4 p-5">
      <h2 className="section-title">{t("galleryTitle")}</h2>
      <p className="muted text-sm">{t("galleryHelp")}</p>
      <label className="block space-y-1">
        <span className="label">{t("galleryKind")}</span>
        <select
          className="input"
          value={kind}
          onChange={(event) => setKind(event.target.value as CreationRiskKind)}
        >
          <option value="pairing">{t("galleryPairing")}</option>
          <option value="tutee">{t("galleryTutee")}</option>
          <option value="tutor">{t("galleryTutor")}</option>
        </select>
      </label>
      <Button onClick={() => setPhase("gate")}>{t("galleryOpen")}</Button>
      {phase === "gate" && (
        <CreationRiskDialog
          kind={kind}
          onCancel={() => setPhase(null)}
          onContinue={() => setPhase("editor")}
        />
      )}
      {phase === "editor" && (
        <Modal
          title={t("galleryEditor")}
          onClose={() => setPhase(null)}
          footer={
            <Button onClick={() => setPhase(null)}>{t("galleryClose")}</Button>
          }
        >
          <label className="block space-y-1">
            <span className="label">{t("galleryDraft")}</span>
            <input
              data-dialog-autofocus
              className="input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        </Modal>
      )}
    </section>
  );
}

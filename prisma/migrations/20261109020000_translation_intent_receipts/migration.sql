BEGIN;

-- First terminal evidence wins. This ledger has no identity/draft cascade or TTL.
CREATE TABLE "TranslationIntentReceipt" (
  "actorId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "protocolVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "operation" TEXT,
  "mode" TEXT,
  "inputHash" TEXT,
  "draftId" TEXT,
  "cleared" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranslationIntentReceipt_pkey" PRIMARY KEY ("actorId", "intentId"),
  CONSTRAINT translation_intent_receipt_protocol CHECK ("protocolVersion" = 1),
  CONSTRAINT translation_intent_receipt_status CHECK ("status" IN ('ACCEPTED', 'STOPPED')),
  CONSTRAINT translation_intent_receipt_uuid CHECK (
    "intentId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT translation_intent_receipt_binding CHECK (
    ("status" = 'STOPPED' AND "operation" IS NULL AND "mode" IS NULL AND "inputHash" IS NULL)
    OR
    ("status" = 'ACCEPTED'
      AND "operation" IS NOT NULL
      AND "operation" IN ('localization.setString', 'home.setContent', 'home.setNewsTranslation', 'home.setSectionTranslation', 'home.setPageTitle')
      AND "mode" IS NOT NULL AND "mode" IN ('DRAFT', 'PUBLISH')
      AND "inputHash" IS NOT NULL AND "inputHash" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT translation_intent_receipt_result CHECK (
    ("status" = 'STOPPED' AND "draftId" IS NULL AND "cleared" IS NULL)
    OR
    ("status" = 'ACCEPTED'
      AND (("mode" = 'DRAFT' AND "draftId" IS NOT NULL AND length("draftId") > 0)
        OR ("mode" = 'PUBLISH' AND "draftId" IS NULL))
      AND (("operation" IN ('localization.setString', 'home.setContent') AND "cleared" IS NOT NULL
          AND ("mode" = 'PUBLISH' OR "cleared" = false))
        OR ("operation" IN ('home.setNewsTranslation', 'home.setSectionTranslation', 'home.setPageTitle') AND "cleared" IS NULL)))
  )
);

CREATE FUNCTION translation_intent_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Translation intent receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER translation_intent_receipt_immutable
  BEFORE UPDATE OR DELETE ON "TranslationIntentReceipt"
  FOR EACH ROW EXECUTE FUNCTION translation_intent_receipt_immutable();

COMMIT;

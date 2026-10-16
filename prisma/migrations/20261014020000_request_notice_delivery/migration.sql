BEGIN;
ALTER TABLE "EmailDelivery" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "EmailDelivery"
  ADD COLUMN "requestKind" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "requestVersion" INTEGER,
  ADD COLUMN "requestInvalid" BOOLEAN,
  ADD COLUMN "requestReason" TEXT,
  ADD COLUMN "requestSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "requestTimeZone" TEXT;
CREATE UNIQUE INDEX "EmailDelivery_requestKind_requestId_requestVersion_key"
  ON "EmailDelivery"("requestKind", "requestId", "requestVersion");
-- Ordinary account mail retains its FK/ownership checks. Essential request mail
-- snapshots the submitted mailbox and never expands into account secondary copies.
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_request_source_check" CHECK (
  (category <> 'request_service' AND "userId" IS NOT NULL) OR
  (category = 'request_service' AND "userId" IS NULL AND
   "requestKind" IS NOT NULL AND "requestKind" IN ('application', 'survey', 'signup') AND "requestId" IS NOT NULL AND
   "requestVersion" IS NOT NULL AND "requestVersion" > 0 AND "requestInvalid" IS NOT NULL AND
   "requestReason" IS NOT NULL AND "requestTimeZone" IS NOT NULL)
);
COMMIT;

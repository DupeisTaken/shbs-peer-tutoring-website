-- School receipts carry only the report FK, never a public-request payload.
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_school_context_check"
  CHECK (category <> 'school_hours' OR context IS NULL);

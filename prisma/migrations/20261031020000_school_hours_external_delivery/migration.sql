-- School instructions have their own frozen report FK instead of an account or
-- public-request identity. Keep all existing account/request admission checks.
ALTER TABLE "EmailDelivery" DROP CONSTRAINT "EmailDelivery_request_source_check";
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_request_source_check" CHECK (
  (category NOT IN ('request_service', 'school_hours') AND "userId" IS NOT NULL) OR
  (category = 'request_service' AND "userId" IS NULL AND
   "requestKind" IS NOT NULL AND "requestKind" IN ('application', 'survey', 'signup') AND "requestId" IS NOT NULL AND
   "requestVersion" IS NOT NULL AND "requestVersion" > 0 AND "requestInvalid" IS NOT NULL AND
   "requestReason" IS NOT NULL AND "requestTimeZone" IS NOT NULL) OR
  (category = 'school_hours' AND "userId" IS NULL AND "schoolHoursReportId" IS NOT NULL AND
   "monthlyHoursReportId" IS NULL AND "requestKind" IS NULL AND "requestId" IS NULL AND
   "requestVersion" IS NULL AND "requestInvalid" IS NULL AND "requestReason" IS NULL AND
   "requestSubmittedAt" IS NULL AND "requestTimeZone" IS NULL)
);

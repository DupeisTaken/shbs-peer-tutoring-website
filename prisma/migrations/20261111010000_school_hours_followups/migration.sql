ALTER TABLE "EmailDelivery"
  ADD COLUMN "schoolHoursBatch" TEXT NOT NULL DEFAULT 'initial',
  ADD COLUMN "schoolHoursScheduledFor" TIMESTAMP(3),
  ADD COLUMN "schoolHoursIntentHash" TEXT;

DROP INDEX "EmailDelivery_schoolHoursReportId_recipient_key";
CREATE UNIQUE INDEX "EmailDelivery_schoolHoursReportId_recipient_schoolHoursBatc_key"
  ON "EmailDelivery"("schoolHoursReportId", "recipient", "schoolHoursBatch");

-- An initial delivery cannot masquerade as a scheduled follow-up (or vice versa).
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "school_hours_followup_schedule"
  CHECK (("schoolHoursBatch" = 'initial' AND "schoolHoursScheduledFor" IS NULL AND "schoolHoursIntentHash" IS NULL)
    OR ("schoolHoursBatch" <> 'initial' AND "schoolHoursReportId" IS NOT NULL
      AND "schoolHoursScheduledFor" IS NOT NULL AND "schoolHoursIntentHash" IS NOT NULL));

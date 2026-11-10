ALTER TABLE "EmailDelivery"
  ADD COLUMN "schoolHoursSendKey" TEXT NOT NULL DEFAULT 'initial',
  ADD COLUMN "schoolHoursReminderSourceId" TEXT,
  ADD COLUMN "schoolHoursScheduledFor" TIMESTAMP(3),
  ADD COLUMN "schoolHoursReminderLinkVersion" INTEGER,
  ADD COLUMN "schoolHoursReminderIntentHash" TEXT,
  ADD COLUMN "schoolHoursLinkOpenedAt" TIMESTAMP(3);

DROP INDEX "EmailDelivery_schoolHoursReportId_recipient_key";
CREATE UNIQUE INDEX "EmailDelivery_school_recipient_send_key"
  ON "EmailDelivery"("schoolHoursReportId", "recipient", "schoolHoursSendKey");
CREATE INDEX "EmailDelivery_schoolHoursReminderSourceId_createdAt_idx"
  ON "EmailDelivery"("schoolHoursReminderSourceId", "createdAt");
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_schoolHoursReminderSourceId_fkey"
  FOREIGN KEY ("schoolHoursReminderSourceId") REFERENCES "EmailDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Initial evidence stays unchanged; a reminder has one exact source/time/intent.
-- Request-specific context remains forbidden by the existing school context guard.
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "school_recipient_reminder_shape" CHECK (
  ("schoolHoursSendKey" = 'initial' AND "schoolHoursReminderSourceId" IS NULL
    AND "schoolHoursScheduledFor" IS NULL AND "schoolHoursReminderLinkVersion" IS NULL
    AND "schoolHoursReminderIntentHash" IS NULL)
  OR (category = 'school_hours' AND event = 'school_hours_reminder'
    AND "schoolHoursReportId" IS NOT NULL AND "schoolHoursReminderSourceId" IS NOT NULL
    AND "schoolHoursSendKey" LIKE 'reminder:%' AND "schoolHoursScheduledFor" IS NOT NULL
    AND "schoolHoursReminderLinkVersion" IS NOT NULL AND "schoolHoursReminderLinkVersion" > 0
    AND "schoolHoursReminderIntentHash" IS NOT NULL)
);

CREATE TABLE "SchoolHoursSchedule" (
  "id" TEXT NOT NULL DEFAULT 'program', "enabled" BOOLEAN NOT NULL DEFAULT false,
  "recipientEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai', "includeStatistics" BOOLEAN NOT NULL DEFAULT false,
  "dateOverrides" JSONB NOT NULL DEFAULT '{}', "version" INTEGER NOT NULL DEFAULT 0,
  "baselineVersion" INTEGER NOT NULL DEFAULT 0, "openingBaseline" JSONB,
  "openingReviewedAt" TIMESTAMP(3), "headReportId" TEXT,
  "nextMonth" TEXT, "nextDueAt" TIMESTAMP(3), "lastGenerationError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolHoursSchedule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SchoolHoursReport" (
  "id" TEXT NOT NULL, "scheduleId" TEXT NOT NULL, "month" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "predecessorId" TEXT, "supersedesId" TEXT, "supersededById" TEXT,
  "configVersion" INTEGER NOT NULL, "baselineVersion" INTEGER NOT NULL, "timeZone" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "dueAt" TIMESTAMP(3),
  "snapshot" JSONB NOT NULL, "sourceBaseline" JSONB NOT NULL, "intendedRecipients" TEXT[] NOT NULL,
  "contentHash" TEXT NOT NULL, "generationKey" TEXT NOT NULL, "generationHash" TEXT NOT NULL,
  "generatedById" TEXT, "reason" TEXT, "linkTokenHash" TEXT NOT NULL,
  "linkVersion" INTEGER NOT NULL DEFAULT 1, "linkRevokedAt" TIMESTAMP(3),
  CONSTRAINT "SchoolHoursReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolHoursReport_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "SchoolHoursSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SchoolHoursReport_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "SchoolHoursReport_linkVersion_check" CHECK ("linkVersion" > 0)
);
CREATE UNIQUE INDEX "SchoolHoursReport_generationKey_key" ON "SchoolHoursReport"("generationKey");
CREATE UNIQUE INDEX "SchoolHoursReport_scheduleId_month_revision_key" ON "SchoolHoursReport"("scheduleId", "month", "revision");
CREATE INDEX "SchoolHoursReport_generatedAt_idx" ON "SchoolHoursReport"("generatedAt");
ALTER TABLE "EmailDelivery" ADD COLUMN "schoolHoursReportId" TEXT;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_schoolHoursReportId_fkey" FOREIGN KEY ("schoolHoursReportId") REFERENCES "SchoolHoursReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "EmailDelivery_schoolHoursReportId_recipient_key" ON "EmailDelivery"("schoolHoursReportId", "recipient");

-- Preserve historical evidence while retiring the superseded unsent overview workflow.
UPDATE "MonthlyHoursSchedule" SET enabled = false, "nextReportMonth" = NULL, "nextDueAt" = NULL;
UPDATE "EmailDelivery" SET status = 'SKIPPED', "completedAt" = CURRENT_TIMESTAMP,
  "leaseUntil" = NULL, "lastError" = 'WORKFLOW_REPLACED'
  WHERE category = 'monthly_hours' AND status IN ('PENDING', 'SENDING', 'FAILED', 'BLOCKED');

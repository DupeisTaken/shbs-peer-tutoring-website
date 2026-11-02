CREATE TABLE "MonthlyHoursSchedule" (
  "id" TEXT NOT NULL DEFAULT 'program',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "recipientUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dayOfMonth" INTEGER NOT NULL DEFAULT 3,
  "localTime" TEXT NOT NULL DEFAULT '09:00',
  "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "version" INTEGER NOT NULL DEFAULT 0,
  "firstReportMonth" TEXT,
  "nextReportMonth" TEXT,
  "nextDueAt" TIMESTAMP(3),
  "lastGenerationError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonthlyHoursSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MonthlyHoursSchedule_day_check" CHECK ("dayOfMonth" BETWEEN 1 AND 28)
);
CREATE TABLE "MonthlyHoursReport" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "configVersion" INTEGER NOT NULL,
  "timeZone" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3),
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contentHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "intendedRecipients" JSONB NOT NULL,
  "reason" TEXT,
  "generatedById" TEXT,
  "generationKey" TEXT NOT NULL,
  "generationHash" TEXT NOT NULL,
  CONSTRAINT "MonthlyHoursReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MonthlyHoursReport_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MonthlyHoursSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MonthlyHoursReport_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "MonthlyHoursReport_generationKey_key" ON "MonthlyHoursReport"("generationKey");
CREATE UNIQUE INDEX "MonthlyHoursReport_scheduleId_month_revision_key" ON "MonthlyHoursReport"("scheduleId", "month", "revision");
CREATE INDEX "MonthlyHoursReport_generatedAt_idx" ON "MonthlyHoursReport"("generatedAt");
ALTER TABLE "EmailDelivery" ADD COLUMN "monthlyHoursReportId" TEXT;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_monthlyHoursReportId_fkey" FOREIGN KEY ("monthlyHoursReportId") REFERENCES "MonthlyHoursReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "EmailDelivery_monthlyHoursReportId_recipient_key" ON "EmailDelivery"("monthlyHoursReportId", "recipient");

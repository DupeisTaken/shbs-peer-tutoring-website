-- Staff-only recipient annotations are separate from immutable reports and delivery addresses.
ALTER TABLE "SchoolHoursSchedule"
ADD COLUMN "recipientLabels" JSONB NOT NULL DEFAULT '{}';

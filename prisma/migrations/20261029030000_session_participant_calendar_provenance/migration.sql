-- Preserve per-learner agreements when an explicit return shares an ordinary cohort.
ALTER TABLE "SessionPlanParticipant"
  ADD COLUMN "scheduleOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "calendarSuppressed" BOOLEAN NOT NULL DEFAULT false;

-- Existing wholly rescheduled cohorts already establish the same provenance.
UPDATE "SessionPlanParticipant" p SET "scheduleOverride" = true
FROM "SessionPlanCohort" c WHERE p."cohortId"=c.id AND c.rescheduled;

-- A learner may have explicitly returned to a still-ordinary shared cohort.
-- Applied request evidence retains that individual provenance even in that case.
UPDATE "SessionPlanParticipant" p SET "scheduleOverride" = true
WHERE EXISTS (
  SELECT 1 FROM "SessionPlanningRequest" r WHERE r."planId"=p."planId"
    AND r.kind='RESCHEDULE' AND r.status='ACCEPTED'
    AND r."participantIds" @> jsonb_build_array(p."tuteeId")
);

-- Legacy source-invalidated ordinary cohorts were calendar/availability tombstones.
-- Only the current shared school resolver will decide whether they can be restored.
UPDATE "SessionPlanParticipant" p SET "calendarSuppressed" = true
FROM "SessionPlanCohort" c JOIN "SessionPlan" l ON l.id=c."planId"
WHERE p."cohortId"=c.id AND c."sourceInvalidated" AND c.status='CANCELLED'
  AND l.kind='REGULAR' AND NOT c.rescheduled AND p.status='SCHEDULED';

-- Cancellation uses the existing request/offer/response history. Widen only the
-- request contracts; existing plans, commitments and attendance remain intact.
ALTER TABLE "SessionPlanningRequest"
  DROP CONSTRAINT "SessionPlanningRequest_kind_check",
  ADD CONSTRAINT "SessionPlanningRequest_kind_check"
    CHECK ("kind" IN ('RESCHEDULE', 'EXTRA', 'CANCEL')),
  DROP CONSTRAINT "SessionPlanningRequest_status_check",
  ADD CONSTRAINT "SessionPlanningRequest_status_check"
    CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'STALE', 'SPLIT_REQUESTED', 'SPLIT'));

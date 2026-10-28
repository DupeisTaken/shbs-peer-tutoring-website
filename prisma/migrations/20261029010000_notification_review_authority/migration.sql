BEGIN;

-- Review ownership is selected by Admin-first fan-out with Head fallback. Both
-- ranks may review ordinary domain requests; deployment-only proposals retain
-- their distinct Head event. This predicate governs enqueue and role rechecks.
CREATE OR REPLACE FUNCTION notification_review_role(recipient_role TEXT, evt TEXT)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT notification_review_event(evt) AND
    (recipient_role = 'HEAD' OR
      (recipient_role = 'ADMIN' AND evt <> 'management_head_review_pending'));
$$;

-- Do not recategorize or requeue historical deliveries: their participant/reviewer
-- distinction and completed/opted-out state are immutable delivery evidence.
-- Explicit source-aware reconciliation owns newly required reviewer notices.
COMMIT;

BEGIN;

ALTER TABLE "ProgramSettings" ADD COLUMN "notificationLocks" JSONB NOT NULL DEFAULT '{}';

-- Requirements overlay choices at enqueue time. Personal preferences are never
-- backfilled or rewritten, so removing a requirement restores the saved choice.
CREATE OR REPLACE FUNCTION notification_email_enabled(uid TEXT, topic TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT s."notificationLocks"->topic->'emailLocked' = 'true'::jsonb
    FROM "ProgramSettings" s WHERE s.id='program'),false)
    OR COALESCE((SELECT p."emailEnabled" FROM "NotificationPreference" p WHERE p."userId"=uid AND p.category=topic),
      CASE topic WHEN 'messages' THEN u."emailMessages" WHEN 'reviews' THEN u."emailReviewRequests"
        WHEN 'reminders' THEN u."emailEventReminders" ELSE u."emailInfo" END, false)
  FROM "User" u WHERE u.id=uid;
$$;

COMMIT;

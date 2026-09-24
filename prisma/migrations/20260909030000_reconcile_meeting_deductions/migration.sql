-- Upgrade existing installations as well as new attendance writes. Only reserved system
-- meeting IDs are rebuilt. Manual adjustments and other penalties are preserved.
BEGIN;
DELETE FROM "ServiceHourAdjustment" WHERE starts_with("id", 'mtgabs_');

-- Match reconcileMeetingHours: Q1/Q2 and Q3/Q4 share their respective allowance,
-- excused/exempt rows do not consume it, and timestamps are stored as UTC.
WITH absences AS (
  SELECT a."tutorId", a."meetingId", m."date", t."schoolYear", t."quarter",
    row_number() OVER (
      PARTITION BY a."tutorId", t."schoolYear",
        CASE WHEN t."quarter" IN ('Q1', 'Q2') THEN 1 ELSE 2 END
      ORDER BY m."date", a."id"
    ) AS absence_number
  FROM "MeetingAttendance" a
  JOIN "TutorMeeting" m ON m."id" = a."meetingId"
  JOIN "Term" t ON t."id" = m."termId"
  WHERE a."status" = 'UNEXCUSED_ABSENT'
)
INSERT INTO "ServiceHourAdjustment"
  ("id", "tutorId", "month", "schoolYear", "quarter", "type", "amount", "reason")
SELECT 'mtgabs_' || "meetingId" || '_' || "tutorId", "tutorId",
  to_char("date", 'YYYY-MM'), "schoolYear", "quarter", 'PUNISHMENT', 0.25,
  'Unexcused meeting absence beyond the semester allowance of three'
FROM absences WHERE absence_number > 3;
COMMIT;

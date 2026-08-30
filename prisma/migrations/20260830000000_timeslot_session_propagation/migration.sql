-- Preserve the catalog slot used by each attendance session. Existing rows inherit the slot
-- currently assigned to their pairing; future submissions stamp the association directly.
ALTER TABLE "Session" ADD COLUMN "timeSlotId" TEXT;

UPDATE "Session" AS session
SET "timeSlotId" = pairing."timeSlotId"
FROM "Pairing" AS pairing
WHERE session."pairingId" = pairing."id";

-- Merged siblings share the primary session's actual clock window, even when their own pairing
-- normally meets in a different slot. Associate the whole block with the primary pairing's slot
-- so a later edit cannot split one recorded block across different times.
UPDATE "Session" AS session
SET "timeSlotId" = primary_pairing."timeSlotId"
FROM "Session" AS primary_session
JOIN "Pairing" AS primary_pairing ON primary_session."pairingId" = primary_pairing."id"
WHERE session."mergeGroupId" = primary_session."id";

CREATE INDEX "Session_timeSlotId_idx" ON "Session"("timeSlotId");

ALTER TABLE "Session"
ADD CONSTRAINT "Session_timeSlotId_fkey"
FOREIGN KEY ("timeSlotId") REFERENCES "TimeSlot"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

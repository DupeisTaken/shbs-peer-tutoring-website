ALTER TYPE "TutorStatus" ADD VALUE IF NOT EXISTS 'TRANSFERRED';
CREATE TABLE "SchoolDeparture" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "reason" TEXT CHECK ("reason" IN ('GRADUATED','TRANSFERRED')),
 "effectiveAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "confirmedById" TEXT, "source" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "observerRevoked" BOOLEAN NOT NULL DEFAULT false, "tutorDerived" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE "SchoolDepartureEvent" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "action" TEXT NOT NULL, "actorId" TEXT, "source" TEXT NOT NULL, "explanation" TEXT NOT NULL,
 "revision" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SchoolDepartureEvent_userId_revision_key" ON "SchoolDepartureEvent"("userId","revision");

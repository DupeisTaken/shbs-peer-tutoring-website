-- Existing participant/event identities and credits are unchanged. This table contains
-- only short-lived invitations and is deliberately absent from the record-transfer allowlist.
CREATE TABLE "TuteeHistoryInvitation" (
  "tuteeId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "expectedUpdatedAt" TIMESTAMP(3) NOT NULL,
  "issuedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TuteeHistoryInvitation_pkey" PRIMARY KEY ("tuteeId"),
  CONSTRAINT "TuteeHistoryInvitation_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TuteeHistoryInvitation_tokenHash_key" ON "TuteeHistoryInvitation"("tokenHash");

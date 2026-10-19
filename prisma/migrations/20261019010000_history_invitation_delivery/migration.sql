-- Delivery admission is durable but cannot be redeemed. Publication and the exact
-- predecessor replacement happen together only after SMTP accepts the recipient.
CREATE TYPE "TuteeHistoryInvitationAttemptStatus" AS ENUM ('ADMITTED', 'PUBLISHED', 'DELIVERY_FAILED', 'SUPERSEDED');
CREATE TABLE "TuteeHistoryInvitationAttempt" (
  "id" TEXT NOT NULL,
  "sequence" SERIAL NOT NULL,
  "tuteeId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "predecessorFingerprint" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "expectedUpdatedAt" TIMESTAMP(3) NOT NULL,
  "issuedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "TuteeHistoryInvitationAttemptStatus" NOT NULL DEFAULT 'ADMITTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "TuteeHistoryInvitationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TuteeHistoryInvitationAttempt_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TuteeHistoryInvitationAttempt_tokenHash_key" ON "TuteeHistoryInvitationAttempt"("tokenHash");
CREATE UNIQUE INDEX "TuteeHistoryInvitationAttempt_sequence_key" ON "TuteeHistoryInvitationAttempt"("sequence");
CREATE INDEX "TuteeHistoryInvitationAttempt_tuteeId_sequence_idx" ON "TuteeHistoryInvitationAttempt"("tuteeId", "sequence");
-- Locking writers make admission exclusive. Keep that invariant even for a future
-- writer that accidentally omits the namespace/tutee locks.
CREATE UNIQUE INDEX "TuteeHistoryInvitationAttempt_one_admitted" ON "TuteeHistoryInvitationAttempt"("tuteeId") WHERE "status" = 'ADMITTED';

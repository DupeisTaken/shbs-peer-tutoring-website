CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requesterId" TEXT NOT NULL,
  "requesterName" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "targets" JSONB NOT NULL,
  "state" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewerId" TEXT,
  "reviewerName" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3)
);
CREATE INDEX "ApprovalRequest_state_createdAt_id_idx" ON "ApprovalRequest"("state", "createdAt", "id");
CREATE INDEX "ApprovalRequest_requesterId_createdAt_id_idx" ON "ApprovalRequest"("requesterId", "createdAt", "id");
-- The correction workflow already supplies the same JSONB evidence column.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "details" JSONB, ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ACTION', ADD COLUMN "operation" TEXT, ADD COLUMN "approvalId" TEXT;
CREATE INDEX "AuditLog_userId_createdAt_id_idx" ON "AuditLog"("userId", "createdAt", "id");
CREATE INDEX "AuditLog_kind_createdAt_id_idx" ON "AuditLog"("kind", "createdAt", "id");
CREATE INDEX "AuditLog_approvalId_idx" ON "AuditLog"("approvalId");

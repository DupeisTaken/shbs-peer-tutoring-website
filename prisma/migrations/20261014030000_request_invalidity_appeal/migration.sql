CREATE TABLE "RequestInvalidityAppeal" (
  id TEXT NOT NULL PRIMARY KEY,
  "noticeId" TEXT NOT NULL,
  body TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  "resolvedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "decisionReason" TEXT,
  CONSTRAINT "RequestInvalidityAppeal_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "EmailDelivery"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequestInvalidityAppeal_state_check" CHECK (status IN ('PENDING', 'DECLINED', 'CLEARED'))
);
CREATE UNIQUE INDEX "RequestInvalidityAppeal_noticeId_key" ON "RequestInvalidityAppeal"("noticeId");

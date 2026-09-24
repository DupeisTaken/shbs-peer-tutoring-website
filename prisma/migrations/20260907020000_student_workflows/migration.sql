-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STUDENT';

-- AlterTable
ALTER TABLE "InterviewAssignment" ADD COLUMN     "attended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Patrol" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Tutee" ADD COLUMN     "intakeTermId" TEXT;

-- AlterTable
ALTER TABLE "TutorApplication" ADD COLUMN     "interviewCompletedAt" TIMESTAMP(3),
ADD COLUMN     "interviewDurationMin" INTEGER,
ADD COLUMN     "interviewQuarter" "Quarter",
ADD COLUMN     "interviewSchoolYear" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "studentId" TEXT;

-- CreateTable
CREATE TABLE "StudentSignup" (
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "StudentSignup_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "PolicyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSettings" (
    "id" TEXT NOT NULL DEFAULT 'program',
    "shareFeedbackWithTutors" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StudentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentFeedback" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAppeal" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationDraft" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcceptance_userId_slug_revision_key" ON "PolicyAcceptance"("userId", "slug", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "StudentFeedback_studentId_sessionId_key" ON "StudentFeedback"("studentId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAppeal_cardId_key" ON "StudentAppeal"("cardId");

-- CreateIndex
CREATE INDEX "DirectMessage_recipientId_createdAt_idx" ON "DirectMessage"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_senderId_recipientId_createdAt_idx" ON "DirectMessage"("senderId", "recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DirectMessage_senderId_clientKey_key" ON "DirectMessage"("senderId", "clientKey");

-- CreateIndex
CREATE INDEX "TranslationDraft_state_createdAt_idx" ON "TranslationDraft"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Tutee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

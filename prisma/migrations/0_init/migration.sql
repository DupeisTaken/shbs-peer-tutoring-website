-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'CREW', 'TUTOR', 'COORDINATOR', 'ADMIN', 'HEAD');

-- CreateEnum
CREATE TYPE "ProgramFeatureKey" AS ENUM ('CREW', 'DISCIPLINE', 'MEETINGS', 'INTERVIEWS', 'SERVICE_HOURS', 'QUARTER_SYSTEM', 'VIEWER_SIGNUP', 'EMAIL_2FA');

-- CreateEnum
CREATE TYPE "AppealState" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "Quarter" AS ENUM ('Q1', 'Q2', 'Q3', 'Q4');

-- CreateEnum
CREATE TYPE "TutorStatus" AS ENUM ('ACTIVE', 'PENDING', 'GRADUATED', 'OPTED_OUT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TuteeStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SessionTutorStatus" AS ENUM ('PRESENT', 'RESCHEDULED', 'EXTRA', 'TUTOR_ABSENT');

-- CreateEnum
CREATE TYPE "TuteeAttendanceStatus" AS ENUM ('PRESENT', 'EXCUSED_ABSENT', 'UNEXCUSED_ABSENT');

-- CreateEnum
CREATE TYPE "MeetingAttendanceStatus" AS ENUM ('PRESENT', 'EXCUSED_ABSENT', 'UNEXCUSED_ABSENT', 'EXEMPT');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('PUNISHMENT', 'EXTRA');

-- CreateEnum
CREATE TYPE "TutorRequestKind" AS ENUM ('OPT_OUT', 'REENTRY');

-- CreateEnum
CREATE TYPE "TutorRequestState" AS ENUM ('PENDING', 'RECALLED', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "RegistrationCodeKind" AS ENUM ('TUTOR', 'CREW');

-- CreateEnum
CREATE TYPE "TuteeRequestState" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'RECALLED', 'REINSTATED');

-- CreateEnum
CREATE TYPE "TuteeRemovalKind" AS ENUM ('VOLUNTARY', 'PUNISHMENT');

-- CreateEnum
CREATE TYPE "CrewStatus" AS ENUM ('ACTIVE', 'OPTED_OUT', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CrewApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CrewRequestKind" AS ENUM ('OPT_OUT', 'REENTRY');

-- CreateEnum
CREATE TYPE "CrewRequestState" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'RECALLED');

-- CreateEnum
CREATE TYPE "Headcount" AS ENUM ('ZERO', 'ONE', 'TWO', 'THREE', 'FOUR_PLUS');

-- CreateEnum
CREATE TYPE "SessionFlagState" AS ENUM ('PENDING', 'DISMISSED', 'WARNED', 'PENALIZED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "TutorApplicationStatus" AS ENUM ('PENDING', 'INTERVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CardColor" AS ENUM ('YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "CardSource" AS ENUM ('TUTOR', 'AUTO');

-- CreateEnum
CREATE TYPE "CardReviewStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('LOGIN_2FA', 'PASSWORD_RESET', 'PASSWORD_CHANGE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'TUTOR',
    "canTranslate" BOOLEAN NOT NULL DEFAULT false,
    "crewStatus" "CrewStatus",
    "gradeLevel" INTEGER,
    "affiliation" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "tutorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "MessageOverride" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramFeature" (
    "key" "ProgramFeatureKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pendingEnabled" BOOLEAN,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramFeature_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ViewerSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "affiliation" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewerSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAppeal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "state" "AppealState" NOT NULL DEFAULT 'PENDING',
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "undoData" JSONB,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectLevel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "apScored" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Term" (
    "id" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "quarter" "Quarter" NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tutor" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "englishName" TEXT NOT NULL,
    "alternativeNames" TEXT,
    "username" TEXT,
    "email" TEXT,
    "status" "TutorStatus" NOT NULL DEFAULT 'ACTIVE',
    "gradeLevel" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tutor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorStatusRequest" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "kind" "TutorRequestKind" NOT NULL,
    "state" "TutorRequestState" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "eligibleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT,

    CONSTRAINT "TutorStatusRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "kind" "RegistrationCodeKind" NOT NULL DEFAULT 'TUTOR',
    "email" TEXT,
    "tutorId" TEXT,
    "applicationId" TEXT,
    "crewApplicationId" TEXT,
    "label" TEXT,
    "issuedById" TEXT,
    "issuedByName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pendingEmail" TEXT,
    "emailCodeHash" TEXT,
    "emailCodeExpiresAt" TIMESTAMP(3),
    "emailCodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailVerifiedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "levelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tutee" (
    "id" TEXT NOT NULL,
    "englishName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "preferredContact" TEXT,
    "gradeLevel" TEXT,
    "notes" TEXT,
    "status" "TuteeStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstChoiceId" TEXT,
    "secondChoiceId" TEXT,
    "signedRulebook" BOOLEAN NOT NULL DEFAULT false,
    "signatureName" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tutee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TuteeRemovalRequest" (
    "id" TEXT NOT NULL,
    "tuteeId" TEXT NOT NULL,
    "kind" "TuteeRemovalKind" NOT NULL DEFAULT 'VOLUNTARY',
    "pairingId" TEXT,
    "requestedByTutorId" TEXT,
    "reason" TEXT,
    "state" "TuteeRequestState" NOT NULL DEFAULT 'PENDING',
    "eligibleAt" TIMESTAMP(3),
    "removedPeriodKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT,

    CONSTRAINT "TuteeRemovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorAvailability" (
    "tutorId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,

    CONSTRAINT "TutorAvailability_pkey" PRIMARY KEY ("tutorId","slotId")
);

-- CreateTable
CREATE TABLE "TuteeAvailability" (
    "tuteeId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,

    CONSTRAINT "TuteeAvailability_pkey" PRIMARY KEY ("tuteeId","slotId")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "patrolOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomUnavailability" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pairing" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tutorId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "roomId" TEXT,
    "timeSlotId" TEXT,

    CONSTRAINT "Pairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingTutee" (
    "pairingId" TEXT NOT NULL,
    "tuteeId" TEXT NOT NULL,

    CONSTRAINT "PairingTutee_pkey" PRIMARY KEY ("pairingId","tuteeId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "tutorStatus" "SessionTutorStatus" NOT NULL DEFAULT 'PRESENT',
    "tutorAbsentReason" TEXT,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "ratingPreparedness" INTEGER,
    "ratingParticipation" INTEGER,
    "ratingUnderstanding" INTEGER,
    "ratingBehavior" INTEGER,
    "ratingProgress" INTEGER,
    "comments" TEXT,
    "month" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "quarter" "Quarter" NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "shFactor" INTEGER NOT NULL,
    "shCount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergeGroupId" TEXT,
    "pairingId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "actualRoomId" TEXT,
    "online" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewApplication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "gradeLevel" INTEGER,
    "preferredContact" TEXT,
    "message" TEXT,
    "status" "CrewApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionComment" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewStatusRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CrewRequestKind" NOT NULL,
    "state" "CrewRequestState" NOT NULL DEFAULT 'PENDING',
    "eligibleAt" TIMESTAMP(3),
    "reason" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewStatusRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patrol" (
    "id" TEXT NOT NULL,
    "crewUserId" TEXT NOT NULL,
    "termId" TEXT,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patrol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolObservation" (
    "id" TEXT NOT NULL,
    "patrolId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "headcount" "Headcount" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatrolObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionFlag" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "expected" INTEGER NOT NULL,
    "observed" INTEGER NOT NULL,
    "state" "SessionFlagState" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT,

    CONSTRAINT "SessionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTutee" (
    "sessionId" TEXT NOT NULL,
    "tuteeId" TEXT NOT NULL,
    "status" "TuteeAttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "absenceReason" TEXT,

    CONSTRAINT "SessionTutee_pkey" PRIMARY KEY ("sessionId","tuteeId")
);

-- CreateTable
CREATE TABLE "TutorMeeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "termId" TEXT,

    CONSTRAINT "TutorMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendance" (
    "id" TEXT NOT NULL,
    "status" "MeetingAttendanceStatus" NOT NULL,
    "reason" TEXT,
    "excusedAt" TIMESTAMP(3),
    "meetingId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,

    CONSTRAINT "MeetingAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceHourAdjustment" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "quarter" "Quarter" NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tutorId" TEXT NOT NULL,

    CONSTRAINT "ServiceHourAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorApplication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "preferredContact" TEXT,
    "contactVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "TutorApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "interviewAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByTutorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSubjectIntent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "taken" BOOLEAN NOT NULL DEFAULT false,
    "grade" TEXT,
    "hasApScore" BOOLEAN NOT NULL DEFAULT false,
    "apScore" TEXT,
    "selfStudied" BOOLEAN NOT NULL DEFAULT false,
    "selfStudyNote" TEXT,

    CONSTRAINT "ApplicationSubjectIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewAssignment" (
    "applicationId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "isHead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewAssignment_pkey" PRIMARY KEY ("applicationId","tutorId")
);

-- CreateTable
CREATE TABLE "InterviewVote" (
    "applicationId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "accept" BOOLEAN NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewVote_pkey" PRIMARY KEY ("applicationId","tutorId")
);

-- CreateTable
CREATE TABLE "PolicyFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDocument" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyArchive" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" TEXT,
    "archivedByName" TEXT,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplinaryCard" (
    "id" TEXT NOT NULL,
    "tuteeId" TEXT NOT NULL,
    "color" "CardColor" NOT NULL,
    "source" "CardSource" NOT NULL DEFAULT 'TUTOR',
    "reason" TEXT,
    "reviewStatus" "CardReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "issuedByTutorId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplinaryCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementAck" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementAck_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateTable
CREATE TABLE "EmailVerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL DEFAULT 'LOGIN_2FA',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_tutorId_key" ON "User"("tutorId");

-- CreateIndex
CREATE INDEX "MessageOverride_locale_idx" ON "MessageOverride"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "MessageOverride_locale_key_key" ON "MessageOverride"("locale", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerSignup_email_key" ON "ViewerSignup"("email");

-- CreateIndex
CREATE INDEX "AccountAppeal_userId_idx" ON "AccountAppeal"("userId");

-- CreateIndex
CREATE INDEX "AccountAppeal_state_idx" ON "AccountAppeal"("state");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectLevel_name_key" ON "SubjectLevel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Term_schoolYear_quarter_key" ON "Term"("schoolYear", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_username_key" ON "Tutor"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_email_key" ON "Tutor"("email");

-- CreateIndex
CREATE INDEX "Tutor_status_idx" ON "Tutor"("status");

-- CreateIndex
CREATE INDEX "TutorStatusRequest_tutorId_idx" ON "TutorStatusRequest"("tutorId");

-- CreateIndex
CREATE INDEX "TutorStatusRequest_state_idx" ON "TutorStatusRequest"("state");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationCode_code_key" ON "RegistrationCode"("code");

-- CreateIndex
CREATE INDEX "RegistrationCode_tutorId_idx" ON "RegistrationCode"("tutorId");

-- CreateIndex
CREATE INDEX "RegistrationCode_applicationId_idx" ON "RegistrationCode"("applicationId");

-- CreateIndex
CREATE INDEX "RegistrationCode_crewApplicationId_idx" ON "RegistrationCode"("crewApplicationId");

-- CreateIndex
CREATE INDEX "RegistrationCode_usedAt_idx" ON "RegistrationCode"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");

-- CreateIndex
CREATE INDEX "Tutee_status_idx" ON "Tutee"("status");

-- CreateIndex
CREATE INDEX "TuteeRemovalRequest_tuteeId_idx" ON "TuteeRemovalRequest"("tuteeId");

-- CreateIndex
CREATE INDEX "TuteeRemovalRequest_state_idx" ON "TuteeRemovalRequest"("state");

-- CreateIndex
CREATE INDEX "TimeSlot_dayOfWeek_startMin_idx" ON "TimeSlot"("dayOfWeek", "startMin");

-- CreateIndex
CREATE INDEX "TutorAvailability_slotId_idx" ON "TutorAvailability"("slotId");

-- CreateIndex
CREATE INDEX "TuteeAvailability_slotId_idx" ON "TuteeAvailability"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_name_key" ON "Room"("name");

-- CreateIndex
CREATE INDEX "RoomUnavailability_roomId_idx" ON "RoomUnavailability"("roomId");

-- CreateIndex
CREATE INDEX "Pairing_tutorId_idx" ON "Pairing"("tutorId");

-- CreateIndex
CREATE INDEX "Pairing_termId_idx" ON "Pairing"("termId");

-- CreateIndex
CREATE INDEX "PairingTutee_tuteeId_idx" ON "PairingTutee"("tuteeId");

-- CreateIndex
CREATE INDEX "Session_tutorId_month_idx" ON "Session"("tutorId", "month");

-- CreateIndex
CREATE INDEX "Session_tutorId_schoolYear_quarter_idx" ON "Session"("tutorId", "schoolYear", "quarter");

-- CreateIndex
CREATE INDEX "Session_schoolYear_quarter_idx" ON "Session"("schoolYear", "quarter");

-- CreateIndex
CREATE INDEX "Session_pairingId_idx" ON "Session"("pairingId");

-- CreateIndex
CREATE INDEX "Session_mergeGroupId_idx" ON "Session"("mergeGroupId");

-- CreateIndex
CREATE INDEX "Session_actualRoomId_idx" ON "Session"("actualRoomId");

-- CreateIndex
CREATE INDEX "CrewApplication_status_idx" ON "CrewApplication"("status");

-- CreateIndex
CREATE INDEX "CrewStatusRequest_userId_idx" ON "CrewStatusRequest"("userId");

-- CreateIndex
CREATE INDEX "CrewStatusRequest_state_idx" ON "CrewStatusRequest"("state");

-- CreateIndex
CREATE INDEX "Patrol_crewUserId_idx" ON "Patrol"("crewUserId");

-- CreateIndex
CREATE INDEX "Patrol_termId_idx" ON "Patrol"("termId");

-- CreateIndex
CREATE INDEX "PatrolObservation_roomId_observedAt_idx" ON "PatrolObservation"("roomId", "observedAt");

-- CreateIndex
CREATE INDEX "PatrolObservation_patrolId_idx" ON "PatrolObservation"("patrolId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionFlag_sessionId_key" ON "SessionFlag"("sessionId");

-- CreateIndex
CREATE INDEX "SessionFlag_state_idx" ON "SessionFlag"("state");

-- CreateIndex
CREATE INDEX "SessionFlag_tutorId_idx" ON "SessionFlag"("tutorId");

-- CreateIndex
CREATE INDEX "SessionTutee_tuteeId_idx" ON "SessionTutee"("tuteeId");

-- CreateIndex
CREATE INDEX "MeetingAttendance_tutorId_idx" ON "MeetingAttendance"("tutorId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendance_meetingId_tutorId_key" ON "MeetingAttendance"("meetingId", "tutorId");

-- CreateIndex
CREATE INDEX "ServiceHourAdjustment_tutorId_month_idx" ON "ServiceHourAdjustment"("tutorId", "month");

-- CreateIndex
CREATE INDEX "ServiceHourAdjustment_tutorId_schoolYear_quarter_idx" ON "ServiceHourAdjustment"("tutorId", "schoolYear", "quarter");

-- CreateIndex
CREATE INDEX "TutorApplication_status_idx" ON "TutorApplication"("status");

-- CreateIndex
CREATE INDEX "ApplicationSubjectIntent_applicationId_idx" ON "ApplicationSubjectIntent"("applicationId");

-- CreateIndex
CREATE INDEX "InterviewAssignment_tutorId_idx" ON "InterviewAssignment"("tutorId");

-- CreateIndex
CREATE INDEX "InterviewVote_tutorId_idx" ON "InterviewVote"("tutorId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDocument_slug_locale_key" ON "PolicyDocument"("slug", "locale");

-- CreateIndex
CREATE INDEX "PolicyArchive_slug_locale_archivedAt_idx" ON "PolicyArchive"("slug", "locale", "archivedAt");

-- CreateIndex
CREATE INDEX "DisciplinaryCard_tuteeId_idx" ON "DisciplinaryCard"("tuteeId");

-- CreateIndex
CREATE INDEX "DisciplinaryCard_reviewStatus_idx" ON "DisciplinaryCard"("reviewStatus");

-- CreateIndex
CREATE INDEX "Announcement_active_idx" ON "Announcement"("active");

-- CreateIndex
CREATE INDEX "AnnouncementAck_userId_idx" ON "AnnouncementAck"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_userId_idx" ON "EmailVerificationCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAppeal" ADD CONSTRAINT "AccountAppeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorStatusRequest" ADD CONSTRAINT "TutorStatusRequest_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationCode" ADD CONSTRAINT "RegistrationCode_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "SubjectLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tutee" ADD CONSTRAINT "Tutee_firstChoiceId_fkey" FOREIGN KEY ("firstChoiceId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tutee" ADD CONSTRAINT "Tutee_secondChoiceId_fkey" FOREIGN KEY ("secondChoiceId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TuteeRemovalRequest" ADD CONSTRAINT "TuteeRemovalRequest_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorAvailability" ADD CONSTRAINT "TutorAvailability_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorAvailability" ADD CONSTRAINT "TutorAvailability_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimeSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TuteeAvailability" ADD CONSTRAINT "TuteeAvailability_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TuteeAvailability" ADD CONSTRAINT "TuteeAvailability_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimeSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomUnavailability" ADD CONSTRAINT "RoomUnavailability_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "TimeSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingTutee" ADD CONSTRAINT "PairingTutee_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "Pairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingTutee" ADD CONSTRAINT "PairingTutee_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "Pairing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_actualRoomId_fkey" FOREIGN KEY ("actualRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewStatusRequest" ADD CONSTRAINT "CrewStatusRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patrol" ADD CONSTRAINT "Patrol_crewUserId_fkey" FOREIGN KEY ("crewUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patrol" ADD CONSTRAINT "Patrol_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolObservation" ADD CONSTRAINT "PatrolObservation_patrolId_fkey" FOREIGN KEY ("patrolId") REFERENCES "Patrol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolObservation" ADD CONSTRAINT "PatrolObservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFlag" ADD CONSTRAINT "SessionFlag_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFlag" ADD CONSTRAINT "SessionFlag_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTutee" ADD CONSTRAINT "SessionTutee_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTutee" ADD CONSTRAINT "SessionTutee_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorMeeting" ADD CONSTRAINT "TutorMeeting_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "TutorMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHourAdjustment" ADD CONSTRAINT "ServiceHourAdjustment_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorApplication" ADD CONSTRAINT "TutorApplication_decidedByTutorId_fkey" FOREIGN KEY ("decidedByTutorId") REFERENCES "Tutor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSubjectIntent" ADD CONSTRAINT "ApplicationSubjectIntent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "TutorApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSubjectIntent" ADD CONSTRAINT "ApplicationSubjectIntent_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewAssignment" ADD CONSTRAINT "InterviewAssignment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "TutorApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewAssignment" ADD CONSTRAINT "InterviewAssignment_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewVote" ADD CONSTRAINT "InterviewVote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "TutorApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewVote" ADD CONSTRAINT "InterviewVote_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDocument" ADD CONSTRAINT "PolicyDocument_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryCard" ADD CONSTRAINT "DisciplinaryCard_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryCard" ADD CONSTRAINT "DisciplinaryCard_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryCard" ADD CONSTRAINT "DisciplinaryCard_issuedByTutorId_fkey" FOREIGN KEY ("issuedByTutorId") REFERENCES "Tutor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryCard" ADD CONSTRAINT "DisciplinaryCard_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAck" ADD CONSTRAINT "AnnouncementAck_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAck" ADD CONSTRAINT "AnnouncementAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationCode" ADD CONSTRAINT "EmailVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


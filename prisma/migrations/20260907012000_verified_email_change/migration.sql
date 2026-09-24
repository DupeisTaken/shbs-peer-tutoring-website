ALTER TYPE "VerificationPurpose" ADD VALUE 'EMAIL_CHANGE';
ALTER TABLE "EmailVerificationCode" ADD COLUMN "targetEmail" TEXT;

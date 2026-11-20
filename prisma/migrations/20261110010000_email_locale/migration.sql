-- Existing recipients have no persisted UI locale to infer. English is the explicit
-- delivery default; accounts can choose Chinese independently of email consent.
-- Source rows retain the public request's language across retries and invitations.
BEGIN;

ALTER TABLE "User" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "User_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "ViewerSignup" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "ViewerSignup_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "CrewSignupVerification" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "CrewSignupVerification_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "CrewApplication" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "CrewApplication_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "TutorApplication" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "TutorApplication_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "StudentSurvey" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "StudentSurvey_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "StudentSignupIntent" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "StudentSignupIntent_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "AccountInvitation" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "AccountInvitation_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "TuteeHistoryInvitation" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "TuteeHistoryInvitation_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));
ALTER TABLE "HistoricalRecordInvitation" ADD COLUMN "emailLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "HistoricalRecordInvitation_emailLocale_check" CHECK ("emailLocale" IN ('en', 'zh'));

COMMIT;

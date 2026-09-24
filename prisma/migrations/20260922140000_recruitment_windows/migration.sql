-- Preserve the existing opening time and default-open intake behavior.
ALTER TABLE "Term"
ADD COLUMN "signupEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "signupClosesAt" TIMESTAMP(3),
ADD COLUMN "tutorSignupEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "tutorSignupOpensAt" TIMESTAMP(3),
ADD COLUMN "tutorSignupClosesAt" TIMESTAMP(3),
ADD COLUMN "tutorSignupPreviewUrl" TEXT;
ALTER TABLE "Term" ADD CONSTRAINT "tutee_window_order" CHECK ("signupClosesAt" IS NULL OR "signupOpensAt" IS NULL OR "signupClosesAt" > "signupOpensAt"),
ADD CONSTRAINT "tutor_window_order" CHECK ("tutorSignupClosesAt" IS NULL OR "tutorSignupOpensAt" IS NULL OR "tutorSignupClosesAt" > "tutorSignupOpensAt");

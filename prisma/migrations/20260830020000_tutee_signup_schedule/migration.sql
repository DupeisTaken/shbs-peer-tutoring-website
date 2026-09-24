-- Store the public tutee-signup opening window on each program term so every quarter can be
-- scheduled independently. Null preserves the existing "open immediately" behavior.
ALTER TABLE "Term"
ADD COLUMN "signupOpensAt" TIMESTAMP(3),
ADD COLUMN "signupPreviewUrl" TEXT;

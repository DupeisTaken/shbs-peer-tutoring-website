-- Additive enum change preserves outstanding tutor/crew invitations and their history.
ALTER TYPE "RegistrationCodeKind" ADD VALUE 'ADMIN';
ALTER TYPE "RegistrationCodeKind" ADD VALUE 'COORDINATOR';

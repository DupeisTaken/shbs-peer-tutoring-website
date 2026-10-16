import type { DomainDb } from "~/server/transactions";
import {
  issueRegistrationCode,
  setEmailVerification,
} from "~/server/auth/registration";
import {
  deliverAccountInvitation,
  verifyAccountInvitation,
} from "~/server/auth/account-invitations";

/** Rehearse the real recipient/source-bound invitation contract; callers capture
 * only synthetic mail and retain the original proof to test later retirement. */
export async function verifiedStaffInvitation(
  db: DomainDb,
  issuerId: string,
  email: string,
  readCode: () => string,
) {
  const issued = await issueRegistrationCode({
    kind: "CREW",
    email,
    issuedById: issuerId,
  });
  const initial = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const challenge = await setEmailVerification(initial, email);
  if (!challenge.ok) throw new Error("Expected synthetic recipient challenge");
  const row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const invitation = await deliverAccountInvitation(db, {
    kind: "CREW",
    email,
    code: challenge.emailCode,
    sourceKey: `staff:${row.id}:${row.emailCodeHash}`,
    source: { type: "staff", id: row.id, challenge: row.emailCodeHash! },
  });
  const verified = await verifyAccountInvitation(db, {
    ...invitation,
    email,
    code: readCode(),
  });
  return { invitationId: invitation.invitationId, proof: verified.proof };
}

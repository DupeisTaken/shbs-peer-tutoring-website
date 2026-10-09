"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { auth, signIn, signOut } from "~/server/auth";
import { db } from "~/server/db";
import { inspectAccountInvitation } from "~/server/auth/account-invitations";

/** Mailbox-proof login is a separate, single-use Auth.js exchange. A failed session
 * response never repeats the participation write; the UI offers sign-in recovery. */
export async function invitationSignIn(input: {
  invitationId: string;
  proof: string;
}) {
  const parsed = z
    .object({
      invitationId: z.string().min(1).max(128),
      proof: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(input);
  const session = await auth();
  const details = await inspectAccountInvitation(db, {
    ...parsed,
    userId: session?.user.id,
  });
  if (!details.requiresSignIn) return { signedIn: true, mfaRequired: false };
  if (details.mfaRequired) return { signedIn: false, mfaRequired: true };
  try {
    await signIn("credentials", {
      intent: "account_invitation",
      ...parsed,
      redirect: false,
    });
    return { signedIn: true, mfaRequired: false };
  } catch (error) {
    if (error instanceof AuthError)
      return { signedIn: false, mfaRequired: false };
    throw error;
  }
}

/** Explicit account switch retains the invitation destination without trusting an external URL. */
export async function switchInvitationAccount(invitationId: string) {
  const id = z.string().min(1).max(128).parse(invitationId);
  await signOut({
    redirectTo: `/signin?callbackUrl=${encodeURIComponent(`/register?invitation=${id}`)}`,
  });
}

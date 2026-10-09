"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { auth, signIn, signOut } from "~/server/auth";
import { db } from "~/server/db";
import {
  inspectAccountInvitation,
  invitationEmailOwner,
  redeemAccountInvitation,
} from "~/server/auth/account-invitations";

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
  async function acceptedSession() {
    if (
      details.kind === "LOGIN" &&
      !details.needsPassword &&
      !details.completed
    ) {
      const owner = await invitationEmailOwner(db, details.email);
      if (!owner) throw new Error("Invitation recipient changed");
      await redeemAccountInvitation(
        db,
        { ...parsed, reviewed: true, firstName: "", lastName: "" },
        owner.id,
        true,
      );
      return { signedIn: true, mfaRequired: false, completedLogin: true };
    }
    return {
      signedIn: true,
      mfaRequired: false,
      completedLogin: details.completed && details.kind === "LOGIN",
    };
  }
  if (!details.requiresSignIn) return acceptedSession();
  if (details.mfaRequired) return { signedIn: false, mfaRequired: true };
  try {
    await signIn("credentials", {
      intent: "account_invitation",
      ...parsed,
      redirect: false,
    });
    return acceptedSession();
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

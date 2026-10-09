"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { cookies } from "next/headers";
import { auth, signIn, signOut } from "~/server/auth";
import { db } from "~/server/db";
import {
  inspectAccountInvitation,
  invitationEmailOwner,
  redeemAccountInvitation,
} from "~/server/auth/account-invitations";

/** Keep the verified-browser handoff out of URLs and JavaScript storage. The code
 * is shareable authorization; only this short-lived HttpOnly cookie carries proof. */
export async function rememberInvitation(input: {
  invitationId: string;
  proof: string;
}) {
  const parsed = z
    .object({
      invitationId: z
        .string()
        .regex(/^[a-z0-9]+$/i)
        .max(128),
      proof: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(input);
  await inspectAccountInvitation(db, parsed);
  (await cookies()).set(`invitation-${parsed.invitationId}`, parsed.proof, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/register",
    maxAge: 15 * 60,
  });
}

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
      completedLogin: Boolean(details.completed && details.kind === "LOGIN"),
    };
  }
  if (!details.requiresSignIn) return acceptedSession();
  if (details.mfaRequired)
    return { signedIn: false, mfaRequired: true, completedLogin: false };
  try {
    await signIn("credentials", {
      intent: "account_invitation",
      ...parsed,
      redirect: false,
    });
    return acceptedSession();
  } catch (error) {
    if (error instanceof AuthError)
      return { signedIn: false, mfaRequired: false, completedLogin: false };
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

/**
 * Step-up re-authentication for dangerous admin actions.
 *
 * Some operations (assigning/transferring the head, changing a user's role, deleting an account)
 * are high-impact and irreversible enough that we re-verify the *caller's own* password right
 * before they run — even though they're already signed in. The admin UI collects the password in
 * a confirmation dialog and passes it as `confirmPassword`; the mutation calls this first.
 *
 * Node runtime only (touches the database + scrypt). Never import into edge code.
 */
import { TRPCError } from "@trpc/server";

import { db } from "~/server/db";
import { verifyPassword } from "./password";

/**
 * Throw unless `password` matches the signed-in user's current password. Used to gate dangerous
 * mutations behind an identity confirmation. Fails closed: a passwordless account (e.g. one that
 * never finished setup) cannot perform these actions until it sets a password.
 */
export async function assertCallerPassword(userId: string, password: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Set a password on your account before performing this action.",
    });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Password is incorrect." });
  }
}

"use server";
import { signOut } from "~/server/auth";

/** Explicit POST-only account switching retains the invitation. Tokens are data in one
 * fixed local destination; neither malformed inputs nor a forwarded URL can redirect off-site. */
export async function switchHistoryAccount(token: string): Promise<void> {
  const destination = /^[a-f0-9]{64}$/.test(token)
    ? `/history/claim?token=${token}`
    : "/history/claim";
  await signOut({ redirectTo: destination });
}

"use server";

import { signOut } from "~/server/auth";

/** Sign the current user out and return them to the public landing page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

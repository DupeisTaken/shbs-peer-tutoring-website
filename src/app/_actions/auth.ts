"use server";

import { signOut } from "~/server/auth";

/** Sign the current user out and return them to the public landing page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

/** Explicit account switching on shared devices; never sign a user out from a GET request. */
export async function switchToStudentSignin(): Promise<void> {
  await signOut({ redirectTo: "/signin" });
}

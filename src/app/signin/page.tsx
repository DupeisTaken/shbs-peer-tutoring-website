import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  // Already signed in — send them home (which routes to the right area by role).
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#1e1b4b] to-[#0f172a] text-white">
      <div className="container flex max-w-sm flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">SHBS Peer Tutoring</h1>
        <p className="text-white/70">Sign in to continue.</p>
        <SignInForm />
      </div>
    </main>
  );
}

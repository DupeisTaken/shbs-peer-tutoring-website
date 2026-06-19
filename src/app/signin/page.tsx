import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  // Already signed in — send them home (which routes to the right area by role).
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Team sign-in
        </h1>
        <p className="muted mt-1">Tutors, coordinators, and admins sign in to continue.</p>
        <div className="card mt-6 p-6 text-left">
          <SignInForm />
        </div>
        <p className="muted mt-6">
          Looking for a tutor?{" "}
          <Link href="/signup" className="link">
            Request one here
          </Link>
        </p>
        <p className="mt-2">
          <Link href="/" className="link">
            ← Back to main page
          </Link>
        </p>
      </div>
    </main>
  );
}

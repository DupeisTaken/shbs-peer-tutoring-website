import Link from "next/link";

import { auth } from "~/server/auth";
import { SignOutButton } from "~/app/_components/sign-out-button";

export default async function Home() {
  const session = await auth();
  const isElevated =
    session?.role === "ADMIN" || session?.role === "COORDINATOR";
  const homeHref = isElevated ? "/admin" : "/dashboard";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl text-center">
        <span className="badge-slate mb-4">SHBS Peer Tutoring</span>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Peer tutoring, organized.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          Pairings, attendance, and service-hour tracking for tutors — and a simple way
          for students to request help.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {session?.user ? (
            <>
              <Link href={homeHref} className="btn-primary">
                {isElevated ? "Go to admin →" : "Go to dashboard →"}
              </Link>
              <SignOutButton className="btn-secondary" />
            </>
          ) : (
            <>
              <Link href="/signup" className="btn-primary">
                Request a tutor
              </Link>
              <Link href="/signin" className="btn-secondary">
                Tutor / staff sign in
              </Link>
            </>
          )}
        </div>

        {session?.user && (
          <p className="muted mt-6">
            Signed in as <span className="font-medium text-slate-700">{session.user.name}</span>
          </p>
        )}
      </div>
    </main>
  );
}

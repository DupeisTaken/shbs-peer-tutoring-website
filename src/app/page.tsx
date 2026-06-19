import Link from "next/link";

import { auth } from "~/server/auth";

export default async function Home() {
  const session = await auth();
  const isElevated =
    session?.role === "ADMIN" || session?.role === "COORDINATOR";
  const homeHref = isElevated ? "/admin" : "/dashboard";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#1e1b4b] to-[#0f172a] text-white">
      <div className="container flex max-w-2xl flex-col items-center justify-center gap-8 px-4 py-16 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          SHBS Peer Tutoring
        </h1>
        <p className="text-lg text-white/70">
          Attendance, pairings, and service-hour tracking for peer tutors.
        </p>

        {session?.user ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-white/80">
              Signed in as <span className="font-semibold">{session.user.name}</span>
            </p>
            <div className="flex gap-3">
              <Link
                href={homeHref}
                className="rounded-full bg-white/15 px-8 py-3 font-semibold transition hover:bg-white/25"
              >
                {isElevated ? "Go to admin →" : "Go to dashboard →"}
              </Link>
              <Link
                href="/api/auth/signout"
                className="rounded-full bg-white/10 px-8 py-3 font-semibold transition hover:bg-white/20"
              >
                Sign out
              </Link>
            </div>
          </div>
        ) : (
          <Link
            href="/signin"
            className="rounded-full bg-white/15 px-10 py-3 font-semibold transition hover:bg-white/25"
          >
            Sign in
          </Link>
        )}
      </div>
    </main>
  );
}

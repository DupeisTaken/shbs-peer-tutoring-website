import Link from "next/link";

import { auth } from "~/server/auth";
import { SignOutButton } from "~/app/_components/sign-out-button";

export default async function Home() {
  const session = await auth();
  const isElevated =
    session?.role === "ADMIN" || session?.role === "COORDINATOR";
  const homeHref = isElevated ? "/admin" : "/dashboard";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl text-center">
        <span className="badge-slate mb-4">SHBS Peer Tutoring</span>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Peer tutoring, organized.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          Pairings, attendance, and service-hour tracking for tutors — and a simple way for
          students to request help.
        </p>

        {session?.user ? (
          <div className="mt-10 flex flex-col items-center gap-4">
            <Link href={homeHref} className="btn-primary">
              {isElevated ? "Go to admin →" : "Go to dashboard →"}
            </Link>
            <p className="muted">
              Signed in as{" "}
              <span className="font-medium text-slate-700">{session.user.name}</span>
            </p>
            <SignOutButton className="btn-secondary btn-sm" />
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ActionCard
              href="/signup"
              title="Request a tutor"
              body="Students: sign up for help and pick your courses and availability."
              cta="Tutee signup"
              primary
            />
            <ActionCard
              href="/tutor-signup"
              title="Become a tutor"
              body="Apply to tutor: pick your courses and grades; we'll arrange an interview."
              cta="Tutor application"
            />
            <ActionCard
              href="/signin"
              title="Team sign-in"
              body="Existing tutors, coordinators, and admins sign in here."
              cta="Tutor / admin login"
            />
          </div>
        )}
      </div>
    </main>
  );
}

function ActionCard({
  href,
  title,
  body,
  cta,
  primary = false,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`card flex flex-col p-5 text-left transition hover:shadow-md ${
        primary ? "ring-1 ring-indigo-200" : ""
      }`}
    >
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="muted mt-1 flex-1">{body}</p>
      <span
        className={`mt-4 text-sm font-semibold ${
          primary ? "text-indigo-600" : "text-slate-600"
        }`}
      >
        {cta} →
      </span>
    </Link>
  );
}

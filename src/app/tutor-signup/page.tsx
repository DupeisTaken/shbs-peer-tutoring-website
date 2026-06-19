import Link from "next/link";

import { TutorSignupForm } from "./tutor-signup-form";

export const metadata = {
  title: "Become a tutor · SHBS Peer Tutoring",
};

export default function TutorSignupPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <Link href="/" className="link text-sm">
        ← Back to main page
      </Link>
      <div className="mb-8 text-center">
        <h1 className="page-title">Apply to become a peer tutor</h1>
        <p className="muted mt-2">
          Tell us which courses you&apos;d like to tutor. The coordinator team reviews every
          application and arranges an interview before you join.
        </p>
      </div>

      <TutorSignupForm />

      <p className="muted mt-6 text-center">
        Already a tutor?{" "}
        <Link href="/signin" className="link">
          Sign in
        </Link>
      </p>
    </main>
  );
}

import Link from "next/link";

import { SignupForm } from "./signup-form";
import { APP_TITLE } from "~/lib/branding";

export const metadata = {
  title: `Request a tutor · ${APP_TITLE}`,
};

export default function SignupPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <Link href="/" className="link text-sm">
        ← Back to main page
      </Link>
      <div className="mb-8 text-center">
        <h1 className="page-title">Request a peer tutor</h1>
        <p className="muted mt-2">
          Tell us what you&apos;d like help with and when you&apos;re free. A coordinator
          will review your request and match you with a tutor.
        </p>
      </div>

      <SignupForm />
    </main>
  );
}

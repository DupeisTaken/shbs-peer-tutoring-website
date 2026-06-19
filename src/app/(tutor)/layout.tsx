import { redirect } from "next/navigation";

import { auth } from "~/server/auth";

/**
 * Gates the entire tutor section. Requires an authenticated user linked to a Tutor record.
 * Authorization is enforced here on the server (in addition to the middleware and per-procedure
 * checks) — never trust the client.
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/signin");
  if (!session.tutorId) redirect("/");

  return <>{children}</>;
}

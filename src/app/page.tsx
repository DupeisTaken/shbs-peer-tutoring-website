import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { LandingView } from "~/app/_components/landing-view";

export default async function Home() {
  // Signed-in users skip the landing page and go straight to their area.
  const session = await auth();
  if (session?.user) {
    const account = await db.user.findUnique({ where: { id: session.user.id }, select: { suspendedAt: true } });
    if (account?.suspendedAt) redirect("/suspended");
    if (session.role === "STUDENT") redirect("/student");
    const adminArea =
      session.role === "HEAD" ||
      session.role === "ADMIN" ||
      session.role === "COORDINATOR" ||
      session.role === "VIEWER";
    // Crew-only logins reach only the patrol portal.
    redirect(
      adminArea ? "/admin" : session.role === "CREW" ? "/patrol" : "/dashboard",
    );
  }

  return <LandingView />;
}

import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { LandingView } from "~/app/_components/landing-view";

export default async function Home() {
  // Signed-in users skip the landing page and go straight to their area.
  const session = await auth();
  if (session?.user) {
    const adminArea =
      session.role === "HEAD" ||
      session.role === "ADMIN" ||
      session.role === "COORDINATOR" ||
      session.role === "VIEWER";
    // Crew-only logins reach only the patrol portal.
    redirect(adminArea ? "/admin" : session.role === "CREW" ? "/patrol" : "/dashboard");
  }

  return <LandingView />;
}

import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { LandingView } from "~/app/_components/landing-view";

export default async function Home() {
  // Signed-in users skip the landing page and go straight to their area.
  const session = await auth();
  if (session?.user) {
    const account = await db.user.findUnique({
      where: { id: session.user.id },
      select: { suspendedAt: true, studentId: true, tuteeMember: true },
    });
    if (account?.suspendedAt) redirect("/suspended");
    // Neutral alumni logins land on personal evidence without a current-consent detour.
    if (session.role === "STUDENT")
      redirect(
        account && !account.studentId && !account.tuteeMember
          ? "/history"
          : "/student",
      );
    const adminArea =
      session.role === "HEAD" ||
      session.role === "ADMIN" ||
      session.role === "COORDINATOR" ||
      session.role === "VIEWER";
    // A transferred tutor can retain the TUTOR role while its execution link is
    // revoked. Route that login to history, avoiding a tutor-layout redirect loop.
    redirect(
      adminArea
        ? "/admin"
        : session.role === "CREW"
          ? "/patrol"
          : session.tutorId
            ? "/dashboard"
            : "/history",
    );
  }

  return <LandingView />;
}

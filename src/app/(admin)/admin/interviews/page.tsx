import { redirect } from "next/navigation";
import { auth } from "~/server/auth";

/** Page access mirrors the visible staff navigation; procedure checks remain authoritative. */
export default async function InterviewsPage() {
  const session = await auth();
  if (!session || !["HEAD", "ADMIN", "COORDINATOR"].includes(session.role))
    redirect("/");
  // Retain old staff links; historical records now belong to Tutor Applications.
  redirect("/admin/applications#interview-records");
}

import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { ManagementActions } from "~/app/_components/management-actions";

export default async function ApprovalPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!["HEAD", "ADMIN", "COORDINATOR"].includes(session.role))
    redirect("/admin");
  return <ManagementActions reviewer={session.role !== "COORDINATOR"} />;
}

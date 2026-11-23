import { pageMetadata } from "~/server/branding-metadata";
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { ManagementActions } from "~/app/_components/management-actions";

export async function generateMetadata() {
  return pageMetadata("approvals.title");
}

export default async function ApprovalPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!["HEAD", "ADMIN", "COORDINATOR"].includes(session.role))
    redirect("/admin");
  return <ManagementActions reviewer={session.role !== "COORDINATOR"} />;
}

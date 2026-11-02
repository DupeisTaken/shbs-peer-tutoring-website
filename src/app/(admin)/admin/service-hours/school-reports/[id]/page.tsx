import { redirect } from "next/navigation";
import { SchoolHoursReport } from "~/app/_components/school-hours-report";
import { auth } from "~/server/auth";
import { accountPortalAccess } from "~/server/portal-access";

export default async function SchoolReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const access = await accountPortalAccess(session.user.id);
  if (!access.canReadManagement || access.managementReadOnly)
    redirect("/admin/service-hours");
  const { id } = await params;
  return <SchoolHoursReport id={id} />;
}

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InterviewManagement } from "~/app/_components/interview-management";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

/** Page access mirrors the visible staff navigation; procedure checks remain authoritative. */
export default async function InterviewsPage() {
  const session = await auth();
  if (!session || !["HEAD", "ADMIN", "COORDINATOR"].includes(session.role))
    redirect("/");
  const features = await getFeatures(db);
  if (!features.INTERVIEWS) redirect("/admin/applications");
  const t = await getTranslations("workflows");
  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("interviewComplete")}</h1>
      <InterviewManagement />
    </div>
  );
}

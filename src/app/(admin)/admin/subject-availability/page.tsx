import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { SubjectAvailability } from "~/app/_components/subject-availability";

/** Subject approval and teaching intent remain independent of interview enablement. */
export default async function SubjectAvailabilityPage() {
  const session = await auth();
  if (!session || !["HEAD", "ADMIN", "COORDINATOR"].includes(session.role))
    redirect("/");
  const t = await getTranslations("subjectAvailability");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-1 max-w-3xl">{t("intro")}</p>
      </div>
      <SubjectAvailability />
    </div>
  );
}

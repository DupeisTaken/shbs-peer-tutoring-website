import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

/** Tutor-meetings module gate — when switched off on /admin/program, the page is unreachable. */
export default async function MeetingsLayout({ children }: { children: React.ReactNode }) {
  const features = await getFeatures(db);
  if (!features.MEETINGS) redirect("/admin");
  return <>{children}</>;
}

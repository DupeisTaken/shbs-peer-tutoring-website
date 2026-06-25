import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

/** Service-hours module gate — when switched off (presence-only program), this page is hidden. */
export default async function ServiceHoursLayout({ children }: { children: React.ReactNode }) {
  const features = await getFeatures(db);
  if (!features.SERVICE_HOURS) redirect("/admin");
  return <>{children}</>;
}

import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

/** Hour-adjustments gate — part of the service-hours module; hidden when it's switched off. */
export default async function HourAdjustmentsLayout({ children }: { children: React.ReactNode }) {
  const features = await getFeatures(db);
  if (!features.SERVICE_HOURS) redirect("/admin");
  return <>{children}</>;
}

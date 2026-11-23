import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { pageMetadata } from "~/server/branding-metadata";
import { getFeatures } from "~/server/program/features";

export async function generateMetadata() {
  return pageMetadata("admin.nav.links.hourAdjustments");
}

/** Hour-adjustments gate — part of the service-hours module; hidden when it's switched off. */
export default async function HourAdjustmentsLayout({ children }: { children: React.ReactNode }) {
  const features = await getFeatures(db);
  if (!features.SERVICE_HOURS) redirect("/admin");
  return <>{children}</>;
}

import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { pageMetadata } from "~/server/branding-metadata";
import { getFeatures } from "~/server/program/features";

export async function generateMetadata() {
  return pageMetadata("admin.nav.links.serviceHours");
}

/** Service-hours module gate — when switched off (presence-only program), this page is hidden. */
export default async function ServiceHoursLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const features = await getFeatures(db);
  if (!features.SERVICE_HOURS) redirect("/admin");
  return <>{children}</>;
}

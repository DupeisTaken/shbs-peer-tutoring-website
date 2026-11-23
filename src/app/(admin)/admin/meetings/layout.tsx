import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { pageMetadata } from "~/server/branding-metadata";
import { getFeatures } from "~/server/program/features";

export async function generateMetadata() {
  return pageMetadata("admin.nav.links.tutorMeetings");
}

/** Tutor-meetings module gate — when switched off on /admin/program, the page is unreachable. */
export default async function MeetingsLayout({ children }: { children: React.ReactNode }) {
  const features = await getFeatures(db);
  if (!features.MEETINGS) redirect("/admin");
  return <>{children}</>;
}

import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

/** Discipline module gate — when switched off on /admin/program, the page is unreachable. */
export default async function DisciplineLayout({ children }: { children: React.ReactNode }) {
  const features = await getFeatures(db);
  if (!features.DISCIPLINE) redirect("/admin");
  return <>{children}</>;
}

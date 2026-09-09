import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

/** Keep the review route out of the UI for users who are not current translators. */
export default async function TranslationReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const elevated = ["HEAD", "ADMIN", "COORDINATOR"].includes(session.role);
  if (!elevated) {
    const me = await db.user.findUnique({
      where: { id: session.user.id },
      select: { canTranslate: true },
    });
    if (!me?.canTranslate) redirect("/");
  }

  return children;
}

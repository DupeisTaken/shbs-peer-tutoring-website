import "server-only";

import { helpAccess } from "~/lib/help/access";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

/** Resolve afresh for every page, image and PDF request. Never cache an account's
 * help allowlist across requests or infer permissions from a client-selected role. */
export async function getHelpAccess() {
  const session = await auth();
  if (!session?.user) return helpAccess(null);
  const [account, features] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        suspendedAt: true,
        mergedIntoId: true,
        tutorAccessRevoked: true,
        tutor: { select: { status: true } },
        crewStatus: true,
        canTranslate: true,
        schoolDeparture: true,
      },
    }),
    getFeatures(db),
  ]);
  return helpAccess(account, features.CREW);
}

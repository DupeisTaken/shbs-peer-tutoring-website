import { db } from "./db";
import { portalAccess } from "~/lib/portal-access";

/** Fresh server state is shared by page guards and APIs; never cache across requests. */
export async function accountPortalAccess(userId: string) {
  const account = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      tutorAccessRevoked: true,
      schoolDeparture: true,
    },
  });
  return portalAccess(account);
}

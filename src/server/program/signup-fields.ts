import type { PrismaClient } from "../../../generated/prisma";
import { signupSettings } from "~/lib/signup-fields";

/** Read per submission, not from a process cache: an open form must obey the latest settings. */
export async function getSignupSettings(db: Pick<PrismaClient, "programSettings">) {
  const settings = await db.programSettings.findUnique({ where: { id: "program" } });
  return signupSettings(settings?.signupFields);
}

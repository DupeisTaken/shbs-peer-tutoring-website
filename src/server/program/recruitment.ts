import type { PrismaClient } from "../../../generated/prisma";
import { recruitmentWindow, type RecruitmentAudience } from "~/lib/recruitment";

/** Public metadata contains only schedule settings, never participant responses. */
export async function getRecruitment(
  db: Pick<PrismaClient, "term">,
  audience: RecruitmentAudience,
) {
  const term = await db.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  return {
    ...recruitmentWindow(term, audience),
    serverNow: new Date().toISOString(),
  };
}

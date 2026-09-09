import type { Prisma } from "../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { notifyAdmins } from "~/server/notifications/create";
/** Public tables are never written by translator-only accounts. Staff review an immutable proposal. */
export async function proposeTranslation(
  db: TransactionDb,
  session: { role: string; user: { id: string } },
  operation: string,
  payload: Prisma.InputJsonValue,
) {
  if (["HEAD", "ADMIN", "COORDINATOR"].includes(session.role)) return false;
  await db.translationDraft.create({
    data: { authorId: session.user.id, operation, payload },
  });
  await notifyAdmins(
    { title: "Translation awaiting review", link: "/translation-review" },
    undefined,
    db,
  );
  return true;
}

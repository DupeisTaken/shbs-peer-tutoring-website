import type { Prisma } from "../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { notifyAdmins } from "~/server/notifications/create";
import {
  TRANSLATION_BASELINE,
  translationBaseline,
  withTranslationWrite,
} from "./translation-destination";
import { z } from "zod";
/** Public tables are never written by translator-only accounts. Staff review an immutable proposal. */
export async function proposeTranslation(
  db: TransactionDb,
  session: { role: string; user: { id: string } },
  operation: string,
  payload: Prisma.InputJsonValue,
) {
  if (["HEAD", "ADMIN", "COORDINATOR"].includes(session.role)) return false;
  await withTranslationWrite(db, async (tx) => {
    const fields = z.record(z.unknown()).parse(payload);
    const baseline = await translationBaseline(tx, operation, fields);
    await tx.translationDraft.create({
      data: {
        authorId: session.user.id,
        operation,
        payload: {
          ...fields,
          [TRANSLATION_BASELINE]: baseline,
        },
      },
    });
    await notifyAdmins(
      { title: "Translation awaiting review", link: "/translation-review" },
      undefined,
      tx,
    );
  });
  return true;
}

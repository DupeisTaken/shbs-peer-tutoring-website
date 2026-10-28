import { notificationInAppEvent } from "~/lib/notification-details";
import type { Prisma } from "../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { notifyAdmins } from "~/server/notifications/create";
import {
  TRANSLATION_BASELINE,
  translationBaseline,
  withTranslationWrite,
} from "./translation-destination";
import { z } from "zod";
import { approvalNotificationDetail } from "~/lib/approval-notification-detail";
import { notificationLabel } from "~/lib/notification-facts";
/** Translators, including Coordinators, submit immutable drafts. Only Admin/Head publish. */
export async function proposeTranslation(
  db: TransactionDb,
  session: { role: string; user: { id: string } },
  operation: string,
  payload: Prisma.InputJsonValue,
) {
  if (["HEAD", "ADMIN"].includes(session.role)) return false;
  await withTranslationWrite(db, async (tx) => {
    const fields = z.record(z.string(), z.unknown()).parse(payload);
    const baseline = await translationBaseline(tx, operation, fields);
    const action = approvalNotificationDetail(operation, {}, {}, "pending");
    const news = operation === "home.setNewsTranslation" && typeof fields.postId === "string" ? await tx.newsTranslation.findUnique({ where: { postId_locale: { postId: fields.postId, locale: "en" } }, select: { title: true } }) : null;
    const section = operation === "home.setSectionTranslation" && typeof fields.sectionId === "string" ? await tx.landingSectionTranslation.findUnique({ where: { sectionId_locale: { sectionId: fields.sectionId, locale: "en" } }, select: { title: true } }) : null;
    const page = operation === "home.setPageTitle" && typeof fields.id === "string" ? await tx.customPage.findUnique({ where: { id: fields.id }, select: { slug: true } }) : null;
    const destination = [news?.title, section?.title, page?.slug, fields.key, fields.slug, fields.postId, fields.sectionId, fields.pageId].find((value) => typeof value === "string");
    const target = typeof destination === "string" ? notificationLabel(destination) : "—";
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
      {
        ...notificationInAppEvent("translation_review_pending", undefined, {
          en: `${action.en} Translation target: ${target}${typeof fields.locale === "string" ? ` (${fields.locale})` : ""}. Awaiting review; not published.`,
          zh: `${action.zh} 翻译目标：${target}${typeof fields.locale === "string" ? `（${fields.locale}）` : ""}。待审核，尚未发布。`,
        }),
        title: "Translation awaiting review",
        link: "/localization?view=review",
      },
      undefined,
      tx,
    );
  });
  return true;
}

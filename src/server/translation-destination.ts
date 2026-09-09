import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { fingerprint } from "./approvals";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { isHomeFieldKey, storageLocale } from "./home/content";
import { isLocale } from "~/i18n/config";

export const TRANSLATION_BASELINE = "_destinationBaseline";
const baselineSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Translation writes are infrequent. One lock covers absent rows, parent deletion and
 * locale deletion as well as all five text targets, including approval replay. */
export function withTranslationWrite<T>(
  db: DomainDb,
  work: (tx: TransactionDb) => Promise<T>,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "translation:destinations");
    return work(tx);
  });
}

/** Snapshot only the text that can be overwritten. Parent existence detects deletion;
 * the full page-title map matters because that mutation writes the whole JSON value. */
async function destination(
  db: TransactionDb,
  operation: string,
  payload: unknown,
) {
  const fields = z.record(z.unknown()).parse(payload);
  const locale = z.string().parse(fields.locale);
  switch (operation) {
    case "localization.setString": {
      const key = z.string().parse(fields.key);
      return {
        language: isLocale(locale)
          ? "builtin"
          : await db.language.findUnique({
              where: { code: locale },
              select: { code: true, createdAt: true },
            }),
        value: await db.messageOverride.findUnique({
          where: { locale_key: { locale, key } },
        }),
      };
    }
    case "home.setContent": {
      const key = z.string().parse(fields.key);
      if (!isHomeFieldKey(key))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unknown content key.",
        });
      return db.homeContent.findUnique({
        where: { key_locale: { key, locale: storageLocale(key, locale) } },
      });
    }
    case "home.setNewsTranslation": {
      const postId = z.string().parse(fields.postId);
      return {
        parent: await db.newsPost.findUnique({
          where: { id: postId },
          select: { id: true },
        }),
        value: await db.newsTranslation.findUnique({
          where: { postId_locale: { postId, locale } },
        }),
      };
    }
    case "home.setSectionTranslation": {
      const sectionId = z.string().parse(fields.sectionId);
      return {
        parent: await db.landingSection.findUnique({
          where: { id: sectionId },
          select: { id: true },
        }),
        value: await db.landingSectionTranslation.findUnique({
          where: { sectionId_locale: { sectionId, locale } },
        }),
      };
    }
    case "home.setPageTitle":
      return db.customPage.findUnique({
        where: { id: z.string().parse(fields.id) },
        select: { id: true, title: true },
      });
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unknown translation target.",
      });
  }
}

export async function translationBaseline(
  db: TransactionDb,
  operation: string,
  payload: unknown,
) {
  return {
    version: 1 as const,
    fingerprint: fingerprint(await destination(db, operation, payload)),
  };
}

/** Legacy drafts retain their evidence. Never invent a current baseline for an old proposal. */
export async function assertTranslationCurrent(
  db: TransactionDb,
  operation: string,
  payload: unknown,
) {
  const fields = z.record(z.unknown()).parse(payload);
  const baseline = baselineSchema.safeParse(fields[TRANSLATION_BASELINE]);
  if (!baseline.success)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This older draft has no saved destination version. Reject it, reload the current text, and submit a new draft.",
    });
  const current = await translationBaseline(db, operation, payload);
  if (current.fingerprint !== baseline.data.fingerprint)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The destination text changed after this draft was submitted. Reject this draft, reload the current text, and submit a new draft.",
    });
}

/** Fingerprints are internal concurrency evidence, not content displayed in the review UI. */
export function visibleTranslationPayload(payload: unknown) {
  const fields = z.record(z.unknown()).parse(payload);
  const { [TRANSLATION_BASELINE]: baseline, ...visible } = fields;
  return {
    payload: visible,
    needsResubmission: !baselineSchema.safeParse(baseline).success,
  };
}

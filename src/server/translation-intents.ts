import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import type { TranslationIntentReceipt } from "../../generated/prisma";
import {
  TRANSLATION_OPERATIONS,
  translationBusinessInputs,
  translationIntentEnvelope,
  type AcceptedTranslationReceipt,
  type TranslationIntentEnvelope,
  type TranslationIntentMode,
  type TranslationIntentReference,
  type TranslationOperation,
  type TranslationReceiptResult,
} from "~/lib/translation-intent";
import { databaseScope, translationPublicationScope } from "./db-scope";
import { lockUsernameNamespace } from "./auth/username-namespace";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import {
  requireTranslationLocale,
  withTranslationWrite,
} from "./translation-destination";
import { isHomeFieldKey } from "./home/content";

type TrustedRequest = {
  actorId: string;
  sessionVersion: number | undefined;
  historyAccessRevision: number | undefined;
};
export type TranslationBusinessResult = { ok: true; cleared?: boolean };
export type TranslationWorkResult = {
  result: TranslationBusinessResult;
  draftId?: string;
};
export type TranslationSetterResult = TranslationBusinessResult & {
  receipt?: AcceptedTranslationReceipt;
};

function captureRequest(session: Session): TrustedRequest {
  // Capture authenticated primitive values BEFORE waiting. A post-wait database
  // read cannot invent the session/history generations this request presented.
  return {
    actorId: session.user.id,
    sessionVersion: session.sessionVersion,
    historyAccessRevision: session.historyAccessRevision,
  };
}

async function currentActor(db: DomainDb, request: TrustedRequest) {
  const actor = await db.user.findUnique({
    where: { id: request.actorId },
    select: {
      id: true,
      name: true,
      role: true,
      canTranslate: true,
      sessionVersion: true,
      historyAccessRevision: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
      suspendedAt: true,
    },
  });
  if (
    !actor ||
    actor.mergedIntoId ||
    actor.recoveryVoidedAt ||
    !Number.isSafeInteger(request.sessionVersion) ||
    request.sessionVersion! < 0 ||
    !Number.isSafeInteger(request.historyAccessRevision) ||
    request.historyAccessRevision! < 0 ||
    actor.sessionVersion !== request.sessionVersion ||
    actor.historyAccessRevision !== request.historyAccessRevision
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Account access changed. Sign in again before continuing.",
    });
  if (actor.suspendedAt)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account is suspended.",
    });
  return actor;
}

async function lockIntentActor(tx: TransactionDb, request: TrustedRequest) {
  // Keyed TOP-LEVEL entry only: N -> D -> account-profile -> User. Do not call
  // this from a destination callback or internal review already holding D.
  await lockUsernameNamespace(tx);
  await lockEntity(tx, "translation:destinations");
  await lockEntity(tx, `account-profile:${request.actorId}`);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${request.actorId} FOR UPDATE`;
  return currentActor(tx, request);
}

function sameActor(session: Session, actorId: string) {
  if (actorId !== session.user.id)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This translation request belongs to another account.",
    });
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;

/** Only v1 Zod-parsed business values belong in the binding, never a generated
 * destination baseline, transport envelope, mutable role or login generation. */
export function translationIntentInputHash(
  operation: TranslationOperation,
  mode: TranslationIntentMode,
  business: Record<string, unknown>,
): string {
  const parsedBusiness = translationBusinessInputs[operation].parse(business);
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({ version: 1, operation, mode, business: parsedBusiness }),
      ),
    )
    .digest("hex");
}

function acceptedReceipt(
  row: TranslationIntentReceipt,
  replayed: boolean,
): AcceptedTranslationReceipt {
  if (
    row.status !== "ACCEPTED" ||
    row.protocolVersion !== 1 ||
    !TRANSLATION_OPERATIONS.includes(row.operation as TranslationOperation) ||
    (row.mode !== "DRAFT" && row.mode !== "PUBLISH")
  )
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The saved translation receipt is unavailable.",
    });
  return {
    status: "ACCEPTED",
    version: 1,
    intentId: row.intentId,
    operation: row.operation as TranslationOperation,
    mode: row.mode,
    outcome: row.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
    acceptedAt: row.createdAt,
    draftId: row.draftId,
    cleared: row.cleared,
    replayed,
  };
}

function historicalResult(
  row: TranslationIntentReceipt,
  replayed = true,
): TranslationReceiptResult {
  if (row.status === "ACCEPTED") return acceptedReceipt(row, replayed);
  if (row.status === "STOPPED" && row.protocolVersion === 1)
    return {
      status: "STOPPED",
      version: 1,
      intentId: row.intentId,
      stoppedAt: row.createdAt,
    };
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The saved translation receipt is unavailable.",
  });
}

function replay(
  row: TranslationIntentReceipt,
  operation: TranslationOperation,
  envelope: TranslationIntentEnvelope,
  inputHash: string,
): TranslationSetterResult {
  if (row.status === "STOPPED")
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This translation request was stopped. Use a new request for a deliberate new edit.",
    });
  if (
    row.protocolVersion !== envelope.version ||
    row.operation !== operation ||
    row.mode !== envelope.mode ||
    row.inputHash !== inputHash
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This translation request already records different intent. Keep its original input or use a new request.",
    });
  const receipt = acceptedReceipt(row, true);
  return {
    ok: true,
    ...(row.cleared === null ? {} : { cleared: row.cleared }),
    receipt,
  };
}

/** Keyed first admission requires real targets before draft creation. Legacy and
 * internal callers deliberately retain their existing destination semantics. */
async function validateFirstDestination(
  tx: TransactionDb,
  operation: TranslationOperation,
  business: Record<string, unknown>,
) {
  await requireTranslationLocale(tx, String(business.locale));
  if (operation === "home.setContent" && !isHomeFieldKey(String(business.key)))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unknown content key.",
    });
  const parent =
    operation === "home.setNewsTranslation"
      ? await tx.newsPost.findUnique({
          where: { id: String(business.postId) },
          select: { id: true },
        })
      : operation === "home.setSectionTranslation"
        ? await tx.landingSection.findUnique({
            where: { id: String(business.sectionId) },
            select: { id: true },
          })
        : operation === "home.setPageTitle"
          ? await tx.customPage.findUnique({
              where: { id: String(business.id) },
              select: { id: true },
            })
          : true;
  if (!parent)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The translation destination no longer exists.",
    });
}

/** Dispatch BEFORE the caller's old destination wrapper. Keyless/internal
 * publication never acquires N; internal review never consumes an author key. */
export async function dispatchTranslationWrite(options: {
  db: DomainDb;
  session: Session;
  operation: TranslationOperation;
  intent: TranslationIntentEnvelope | undefined;
  business: Record<string, unknown>;
  work: (
    tx: TransactionDb,
    actorSession: Session,
  ) => Promise<TranslationWorkResult>;
}): Promise<TranslationSetterResult> {
  const { db, session, operation, business, work } = options;
  if (!options.intent || translationPublicationScope.getStore())
    return withTranslationWrite(
      db,
      async (tx) => (await work(tx, session)).result,
    );
  const envelope = translationIntentEnvelope.parse(options.intent);
  sameActor(session, envelope.actorId);
  const request = captureRequest(session);
  const inputHash = translationIntentInputHash(
    operation,
    envelope.mode,
    business,
  );
  const where = {
    actorId_intentId: { actorId: request.actorId, intentId: envelope.id },
  };
  const existing = await db.translationIntentReceipt.findUnique({ where });
  if (existing) {
    await currentActor(db, request);
    return replay(existing, operation, envelope, inputHash);
  }
  return inTransaction(db, async (tx) =>
    databaseScope.run(tx, async () => {
      const actor = await lockIntentActor(tx, request);
      const terminal = await tx.translationIntentReceipt.findUnique({ where });
      if (terminal) return replay(terminal, operation, envelope, inputHash);
      const mode =
        actor.role === "HEAD" || actor.role === "ADMIN" ? "PUBLISH" : "DRAFT";
      if (!actor.canTranslate || actor.role === "VIEWER")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Translation access required.",
        });
      if (mode !== envelope.mode)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Translation authority changed. Start a new request with the current submission mode.",
        });
      await validateFirstDestination(tx, operation, business);
      const result = await work(tx, {
        ...session,
        role: actor.role,
        user: { ...session.user, id: actor.id, name: actor.name },
      });
      if ((mode === "DRAFT") !== !!result.draftId)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The translation result could not be recorded.",
        });
      const row = await tx.translationIntentReceipt.create({
        data: {
          actorId: actor.id,
          intentId: envelope.id,
          protocolVersion: 1,
          status: "ACCEPTED",
          operation,
          mode,
          inputHash,
          draftId: result.draftId ?? null,
          cleared: result.result.cleared ?? null,
        },
      });
      return { ...result.result, receipt: acceptedReceipt(row, false) };
    }),
  );
}

/** Metadata-only query; no namespace guard update and no ownership traversal. */
export async function getTranslationIntent(
  db: DomainDb,
  session: Session,
  reference: TranslationIntentReference,
): Promise<TranslationReceiptResult> {
  sameActor(session, reference.actorId);
  await currentActor(db, captureRequest(session));
  const row = await db.translationIntentReceipt.findUnique({
    where: { actorId_intentId: reference },
  });
  return row
    ? historicalResult(row)
    : { status: "NOT_RECORDED", version: 1, intentId: reference.intentId };
}

/** Deny-only stop shares first-admission locks; it never reverses accepted work. */
export async function stopTranslationIntent(
  db: DomainDb,
  session: Session,
  reference: TranslationIntentReference,
): Promise<TranslationReceiptResult> {
  sameActor(session, reference.actorId);
  const request = captureRequest(session);
  return inTransaction(db, async (tx) =>
    databaseScope.run(tx, async () => {
      await lockIntentActor(tx, request);
      const where = { actorId_intentId: reference };
      const existing = await tx.translationIntentReceipt.findUnique({ where });
      if (existing) return historicalResult(existing);
      const row = await tx.translationIntentReceipt.create({
        data: {
          actorId: reference.actorId,
          intentId: reference.intentId,
          protocolVersion: 1,
          status: "STOPPED",
        },
      });
      return historicalResult(row);
    }),
  );
}

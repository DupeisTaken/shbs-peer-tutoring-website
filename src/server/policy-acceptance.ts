import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";

/** A revision hashes every published locale, so a changed translation also requires consent.
 * Acceptance stores the exact snapshot rather than relying on mutable editor rows. */
export async function publishedPolicy(tx: TransactionDb, slug: string) {
  const documents = await tx.policyDocument.findMany({
    where: { slug },
    orderBy: { locale: "asc" },
    select: { locale: true, title: true, body: true, version: true },
  });
  if (!documents.some((d) => d.locale === "en" && d.body.trim())) return null;
  const revision = createHash("sha256")
    .update(JSON.stringify(documents))
    .digest("hex");
  return { slug, revision, documents };
}

/** Participation fails closed; read-only setup checks use publishedPolicy instead. */
export async function currentPolicy(tx: TransactionDb, slug: string) {
  const policy = await publishedPolicy(tx, slug);
  if (!policy)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The team must publish the policy before participation opens.",
    });
  return policy;
}
export async function requirePolicy(
  tx: TransactionDb,
  userId: string,
  slug: string,
) {
  const policy = await currentPolicy(tx, slug);
  const accepted = await tx.policyAcceptance.findUnique({
    where: {
      userId_slug_revision: { userId, slug, revision: policy.revision },
    },
  });
  if (!accepted)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Read and accept the current policy before participating.",
    });
}

/** A missing publication is expected during initial setup, not a failed network read. */
export async function publicSignupPolicy(
  tx: TransactionDb,
  slug: string,
  locale?: string,
) {
  const policy = await publishedPolicy(tx, slug);
  if (!policy) return null;
  const english = policy.documents.find((d) => d.locale === "en")!;
  const document =
    policy.documents.find((d) => d.locale === locale && d.body.trim()) ??
    english;
  return { ...document, revision: policy.revision };
}

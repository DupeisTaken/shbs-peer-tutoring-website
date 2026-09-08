import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";

/** A revision hashes every published locale, so a changed translation also requires consent.
 * Acceptance stores the exact snapshot rather than relying on mutable editor rows. */
export async function currentPolicy(tx: TransactionDb, slug: string) {
  const documents = await tx.policyDocument.findMany({
    where: { slug },
    orderBy: { locale: "asc" },
    select: { locale: true, title: true, body: true, version: true },
  });
  if (!documents.some((d) => d.locale === "en"))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The team must publish the policy before participation opens.",
    });
  const revision = createHash("sha256")
    .update(JSON.stringify(documents))
    .digest("hex");
  return { slug, revision, documents };
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

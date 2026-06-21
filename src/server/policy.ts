import { type db as DbClient } from "~/server/db";

/**
 * Fetch a policy document in the requested UI locale, falling back to the English ("en")
 * version when the requested language hasn't been translated. Policies are stored one row
 * per (slug, locale); see PolicyDocument in schema.prisma and /admin/policies.
 */
export async function localizedPolicy(
  db: typeof DbClient,
  slug: string,
  locale?: string,
): Promise<{ title: string; body: string } | null> {
  const select = { title: true, body: true } as const;
  const trimmed = locale?.trim();
  const wanted = trimmed && trimmed.length > 0 ? trimmed : "en";
  const exact = await db.policyDocument.findUnique({
    where: { slug_locale: { slug, locale: wanted } },
    select,
  });
  if (exact) return exact;
  if (wanted === "en") return null;
  return db.policyDocument.findUnique({
    where: { slug_locale: { slug, locale: "en" } },
    select,
  });
}

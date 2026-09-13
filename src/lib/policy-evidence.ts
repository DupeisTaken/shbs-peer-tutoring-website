export type PolicySlug = "tutee-policy" | "tutor-policy";

/** Preserve existing student tickets; tutor consent uses a distinct target namespace. */
export function policyActionTarget(slug: string, revision: string) {
  return slug === "tutee-policy" ? revision : `${slug}:${revision}`;
}

/** Capabilities may coexist: management or crew accounts can also be participants. */
export function applicablePolicySlugs(user: {
  studentId: string | null;
  tutorId: string | null;
}): PolicySlug[] {
  return [
    ...(user.studentId ? ["tutee-policy" as const] : []),
    ...(user.tutorId ? ["tutor-policy" as const] : []),
  ];
}

export type PolicySnapshotDocument = {
  locale: string;
  title: string;
  body: string;
  version: string | null;
};

/** Decode immutable evidence without substituting today's edited document text.
 * Older/unrecognized snapshots remain stored untouched and are labelled unavailable. */
export function policySnapshotDocuments(
  snapshot: unknown,
): PolicySnapshotDocument[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const doc = item as Record<string, unknown>;
    if (
      typeof doc.locale !== "string" ||
      typeof doc.title !== "string" ||
      typeof doc.body !== "string"
    )
      return [];
    return [
      {
        locale: doc.locale,
        title: doc.title,
        body: doc.body,
        version: typeof doc.version === "string" ? doc.version : null,
      },
    ];
  });
}

export function localizedSnapshot(
  documents: PolicySnapshotDocument[],
  locale: string,
) {
  return (
    documents.find((doc) => doc.locale === locale) ??
    documents.find((doc) => doc.locale === "en") ??
    documents[0]
  );
}

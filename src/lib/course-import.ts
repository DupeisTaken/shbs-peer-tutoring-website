import { z } from "zod";

/** Portable group names and level names; database IDs never belong in import files. */
export const courseImportInput = z
  .object({
    groups: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            offerings: z
              .array(
                z
                  .object({
                    baseName: z.string().trim().min(1).max(160),
                    level: z.string().trim().min(1).nullable(),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine(({ groups }, ctx) => {
    if (
      groups.reduce((count, group) => count + group.offerings.length, 0) > 500
    )
      ctx.addIssue({
        code: "custom",
        message: "Import at most 500 offerings at a time.",
      });
    const names = new Set<string>();
    groups.forEach((group, index) => {
      const name = group.name.toLowerCase();
      if (names.has(name))
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "name"],
          message: "Each group name must appear only once.",
        });
      names.add(name);
      const levels = group.offerings.map(
        (offer) => offer.level?.toLowerCase() ?? null,
      );
      if (new Set(levels).size !== levels.length)
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "offerings"],
          message: "Choose each level only once per group.",
        });
    });
  });

export const MAX_IMPORT_BYTES = 1024 * 1024;

export function parseCourseImport(text: string) {
  // BOMs are common in files saved from Windows editors.
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  const result = courseImportInput.safeParse(value);
  if (!result.success) {
    // Surface concise file locations instead of Zod's internal error-object dump.
    throw new Error(
      result.error.issues
        .slice(0, 3)
        .map((issue) => {
          const location = issue.path
            .map((part) => (typeof part === "number" ? `[${part + 1}]` : part))
            .join(".");
          return `${location || "File"}: ${issue.message}`;
        })
        .join("; "),
    );
  }
  return result.data;
}

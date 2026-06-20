/**
 * Optimistic concurrency for high-risk admin actions, so simultaneous coordinators can't
 * clobber each other. The contended records (Tutee, TutorApplication, DisciplinaryCard) carry
 * an `@updatedAt` token; a mutation passes the value it last read as `expectedUpdatedAt` and
 * guards its write with `where: { id, updatedAt: expectedUpdatedAt }`. If no row matches,
 * someone else changed it first — we reject with CONFLICT and the client refreshes.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

/** Reusable input field: the row version (updatedAt) the client last saw. */
export const expectedUpdatedAt = z.coerce.date();

/** Throw the standard "changed since you loaded it" conflict. */
export function staleConflict(): never {
  throw new TRPCError({
    code: "CONFLICT",
    message: "This changed since you loaded it — refresh and try again.",
  });
}

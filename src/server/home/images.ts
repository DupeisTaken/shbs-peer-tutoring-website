import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * Image-upload policy + the auth gate shared by the upload route handler. Editing the landing page
 * (text + news + images) is open to the same set as the in-app translator tools: elevated staff
 * (HEAD/ADMIN/COORDINATOR) or any user an admin has flagged `canTranslate` (mirrors
 * `translatorProcedure`). The serve route (`/api/images/[id]`) is public — landing images are public.
 */

const ELEVATED_ROLES = ["HEAD", "ADMIN", "COORDINATOR"];

/** Accepted raster types. SVG is intentionally excluded (it can carry scripts). */
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export function isAllowedImageType(mime: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime);
}

/** Whether the current session may edit landing content; returns the editor's display name. */
export async function authorizeHomeEditor(): Promise<{ ok: boolean; name: string | null }> {
  const session = await auth();
  if (!session?.user) return { ok: false, name: null };
  const name = session.user.name ?? null;
  if (ELEVATED_ROLES.includes(session.role ?? "")) return { ok: true, name };
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { canTranslate: true },
  });
  return { ok: Boolean(me?.canTranslate), name };
}

/** The roster ID survives account creation, unlike a User ID or a displayed name. */
export const tutorDirectoryAnchor = (tutorId: string) =>
  `tutor-${encodeURIComponent(tutorId)}`;

export const tutorDirectoryHref = (tutorId: string) =>
  `/admin/users#${tutorDirectoryAnchor(tutorId)}`;

/** URL input selects only an exact row returned by the authorized directory read. */
export function tutorIdFromDirectoryHash(hash: string): string | null {
  if (!hash.startsWith("#tutor-")) return null;
  try {
    const id = decodeURIComponent(hash.slice("#tutor-".length));
    return id && id.length <= 200 ? id : null;
  } catch {
    return null;
  }
}

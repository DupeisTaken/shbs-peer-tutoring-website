import { getTranslations } from "next-intl/server";

import { signOutAction } from "~/app/_actions/auth";

/**
 * Sign-out control rendered as a server-action form (works in server components,
 * no client session provider needed). Used in the tutor and admin shells.
 */
export async function SignOutButton({ className }: { className?: string }) {
  const t = await getTranslations();
  return (
    <form action={signOutAction}>
      <button type="submit" className={className ?? "btn-secondary btn-sm w-full"}>
        {t("components.signOut.label")}
      </button>
    </form>
  );
}

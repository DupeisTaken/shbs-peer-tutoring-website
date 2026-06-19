import { signOutAction } from "~/app/_actions/auth";

/**
 * Sign-out control rendered as a server-action form (works in server components,
 * no client session provider needed). Used in the tutor and admin shells.
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={className ?? "btn-secondary btn-sm w-full"}>
        Sign out
      </button>
    </form>
  );
}

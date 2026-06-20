import { SignOutButton } from "~/app/_components/sign-out-button";

/** First letters of the first and last words of a name (max 2), uppercased. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Top-right user menu: an avatar circle (initials) that opens a dropdown with the user's
 * name / username / email and a sign-out control. Built on a native <details>/<summary>
 * so it works in a server component without any client-side JavaScript.
 */
export function UserAvatar({
  name,
  username,
  email,
  role,
}: {
  name: string;
  username?: string | null;
  email?: string | null;
  role?: string;
}) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white ring-2 ring-white transition group-open:ring-indigo-200">
          {initials(name)}
        </span>
      </summary>

      <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <div className="border-b border-slate-100 pb-2">
          <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
          {username && (
            <p className="muted truncate text-xs">@{username}</p>
          )}
          {email && <p className="muted truncate text-xs">{email}</p>}
          {role && (
            <span className="badge-slate mt-2 inline-block text-[10px]">{role}</span>
          )}
        </div>
        <div className="pt-2">
          <SignOutButton />
        </div>
      </div>
    </details>
  );
}

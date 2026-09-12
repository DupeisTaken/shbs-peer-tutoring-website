"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";

const Identity = createContext<string | null>(null);
export const AdminPreferenceIdentity = Identity.Provider;
const changed = "admin-notice-preference";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changed, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changed, callback);
  };
}

/** Browser preferences are namespaced to the authenticated account, never a shared device. */
export function DismissibleNotice({
  noticeId,
  title,
  helpLabel,
  dismissLabel,
  children,
}: {
  noticeId: string;
  title: string;
  helpLabel: string;
  dismissLabel: string;
  children: React.ReactNode;
}) {
  const userId = useContext(Identity);
  const key = userId ? `shbs:notice:${userId}:${noticeId}` : null;
  const [fallback, setFallback] = useState<{
    key: string | null;
    hidden: boolean;
  } | null>(null);
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return key ? localStorage.getItem(key) === "dismissed" : false;
      } catch {
        return false;
      }
    },
    () => false,
  );
  const dismissed = fallback?.key === key ? fallback.hidden : stored;
  const update = (hide: boolean) => {
    try {
      if (key) {
        if (hide) localStorage.setItem(key, "dismissed");
        else localStorage.removeItem(key);
      }
    } catch {
      setFallback({ key, hidden: hide });
    }
    window.dispatchEvent(new Event(changed));
  };
  return dismissed ? (
    <button
      type="button"
      className="link text-sm"
      onClick={() => update(false)}
    >
      {helpLabel}
    </button>
  ) : (
    <aside className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
      <div className="flex items-center justify-between gap-4">
        <p className="font-semibold">{title}</p>
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-label={dismissLabel}
          onClick={() => update(true)}
        >
          ×
        </button>
      </div>
      {children}
    </aside>
  );
}

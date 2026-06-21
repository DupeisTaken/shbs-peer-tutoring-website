"use client";

import { createContext, useContext } from "react";

/**
 * Whether the current admin session is the read-only VIEWER role. Server-side, viewers can't
 * call any mutation (see `viewerProcedure` vs `adminProcedure`) and their PII is masked — this
 * context just lets client pages hide/disable controls that would otherwise no-op for them.
 */
const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

/** True when the signed-in admin-area user is a read-only VIEWER. */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

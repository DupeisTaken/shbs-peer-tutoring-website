"use client";
import { useState } from "react";

/** Personal history retains cached evidence only for transport failures. A denied
 * ownership read stays concealed until an authoritative read succeeds again. */
export function useHistoryReadDenial(query: {
  error: unknown;
  isSuccess: boolean;
  isFetching: boolean;
}) {
  const error = query.error as {
    message?: string;
    data?: { code?: string };
  } | null;
  const denied = [
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "HISTORY_NOT_FOUND",
  ].some((code) => error?.data?.code === code || error?.message === code);
  const [latched, setLatched] = useState(false);
  // Reconcile the latch before committing children, so denial cannot reveal
  // cached evidence for a frame and transport failures cannot clear it.
  const nextLatched =
    denied ||
    (latched && !(query.isSuccess && !query.isFetching && !query.error));
  if (latched !== nextLatched) setLatched(nextLatched);
  return nextLatched;
}

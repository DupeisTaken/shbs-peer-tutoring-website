"use client";
import { useEffect, useState } from "react";

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
  useEffect(() => {
    if (denied) setLatched(true);
    else if (query.isSuccess && !query.isFetching && !query.error)
      setLatched(false);
  }, [denied, query.isSuccess, query.isFetching, query.error]);
  return denied || latched;
}

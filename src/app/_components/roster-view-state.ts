"use client";
import { useSessionViewState } from "./session-view-state";
import { viewEnum, viewFields } from "~/lib/session-view-state";
import type { Sort } from "./sortable";

/** Only table presentation enters session storage; identity/editor drafts stay
 * with each roster's existing form owner and version snapshot. */
export function useRosterSort(
  id: string,
  keys: readonly string[],
  defaultKey: string,
  enabled: boolean,
): Sort {
  const [sort, setSort] = useSessionViewState({
    id,
    initialState: { key: defaultKey, dir: "asc" as "asc" | "desc" },
    parse: viewFields<{ key: string; dir: "asc" | "desc" }>({
      key: viewEnum(keys),
      dir: viewEnum(["asc", "desc"]),
    }),
    enabled,
  });
  return {
    ...sort,
    toggle: (key) =>
      setSort((before) => ({
        key,
        dir: before.key === key && before.dir === "asc" ? "desc" : "asc",
      })),
  };
}

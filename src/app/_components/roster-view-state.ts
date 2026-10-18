"use client";
import { useSessionViewState } from "./session-view-state";
import { viewEnum, viewFields } from "~/lib/session-view-state";
import { nextSort, type Sort, type SortDir } from "./sortable";

/** Only table presentation enters session storage; identity/editor drafts stay
 * with each roster's existing form owner and version snapshot. */
export function useRosterSort(
  id: string,
  keys: readonly string[],
  defaultKey: string,
  enabled: boolean,
): Sort {
  const [sort, setSort] = useSessionViewState<{ key: string; dir: SortDir }>({
    id,
    initialState: { key: defaultKey, dir: "none" },
    parse: viewFields<{ key: string; dir: SortDir }>({
      key: viewEnum(keys),
      dir: viewEnum(["asc", "desc", "none"]),
    }),
    enabled,
  });
  return {
    ...sort,
    toggle: (key) => setSort((before) => nextSort(before, key)),
  };
}

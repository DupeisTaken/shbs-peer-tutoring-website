"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "~/app/_components/ui/button";

export type SortDir = "asc" | "desc" | "none";
export type Sort = {
  key: string;
  dir: SortDir;
  toggle: (key: string) => void;
};

/** One atomic transition also handles rapid clicks without stale state. */
export function nextSort(before: Pick<Sort, "key" | "dir">, key: string) {
  const dir: SortDir =
    before.key !== key || before.dir === "none"
      ? "asc"
      : before.dir === "asc"
        ? "desc"
        : "none";
  return { key, dir };
}

/** No sort preserves the feature's incoming order, including later refreshes. */
export function useSort(defaultKey = "", defaultDir: SortDir = "none"): Sort {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  return {
    ...sort,
    toggle: (key) => setSort((before) => nextSort(before, key)),
  };
}

/** Locale-aware comparator (numeric-aware) for use inside an array sort. */
export function compare(
  a: string | number,
  b: string | number,
  locale?: string,
): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), locale, {
    numeric: true,
    sensitivity: "base",
  });
}

/** A clickable `<th>` that drives the shared sort state and shows the active direction. */
export function SortHeader({
  sort,
  sortKey,
  children,
  ...props
}: {
  sort: Sort;
  sortKey: string;
  children: React.ReactNode;
} & ComponentProps<"th">) {
  const active = sort.key === sortKey && sort.dir !== "none";
  return (
    // Announce direction on the column itself; decorative arrows do not enter the action's name.
    <th
      {...props}
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <Button
        variant="ghost"
        size="compact"
        onClick={() => sort.toggle(sortKey)}
        className="table-sort-button group gap-1 px-1 text-xs font-semibold tracking-wide text-inherit uppercase hover:text-slate-700"
      >
        {children}
        <span
          aria-hidden="true"
          className={
            active
              ? "text-accent-600"
              : "text-slate-500 group-hover:text-slate-700"
          }
        >
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Button>
    </th>
  );
}

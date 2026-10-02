"use client";

import { useState } from "react";
import { Button } from "~/app/_components/ui/button";

export type SortDir = "asc" | "desc";
export type Sort = {
  key: string;
  dir: SortDir;
  toggle: (key: string) => void;
};

/** Sort state for a table. Clicking the active column flips direction; a new column resets to asc. */
export function useSort(defaultKey: string, defaultDir: SortDir = "asc"): Sort {
  const [key, setKey] = useState(defaultKey);
  const [dir, setDir] = useState<SortDir>(defaultDir);
  const toggle = (next: string) => {
    if (next === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setKey(next);
      setDir("asc");
    }
  };
  return { key, dir, toggle };
}

/** Locale-aware comparator (numeric-aware) for use inside an array sort. */
export function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** A clickable `<th>` that drives the shared sort state and shows the active direction. */
export function SortHeader({
  sort,
  sortKey,
  children,
}: {
  sort: Sort;
  sortKey: string;
  children: React.ReactNode;
}) {
  const active = sort.key === sortKey;
  return (
    // Announce direction on the column itself; decorative arrows do not enter the action's name.
    <th
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <Button
        variant="ghost"
        size="compact"
        onClick={() => sort.toggle(sortKey)}
        className="group gap-1 px-1 text-xs font-semibold tracking-wide text-inherit uppercase hover:text-slate-700"
      >
        {children}
        <span
          aria-hidden="true"
          className={
            active
              ? "text-accent-600"
              : "text-slate-300 group-hover:text-slate-400"
          }
        >
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Button>
    </th>
  );
}

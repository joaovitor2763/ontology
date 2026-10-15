"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/shared/lib/cn";

export type ClientSort =
  | "name-asc"
  | "name-desc"
  | "entry-desc"
  | "entry-asc"
  | "cycle-asc"
  | "cycle-desc";

export function ClientSortHead({
  kind,
  label,
  sort,
  onSort,
  className,
}: {
  kind: "name" | "entry" | "cycle";
  label: string;
  sort: ClientSort | null;
  onSort: (sort: ClientSort) => void;
  className?: string;
}) {
  const active = sort?.startsWith(kind) ?? false;
  const direction = active ? (sort?.endsWith("asc") ? "asc" : "desc") : null;
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  const next = active
    ? (`${kind}-${direction === "asc" ? "desc" : "asc"}` as ClientSort)
    : kind === "name"
      ? "name-asc"
      : kind === "entry"
      ? "entry-desc"
      : "cycle-asc";
  return (
    <th
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className={cn("px-3 py-2.5 font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(next)}
        className="inline-flex items-center gap-1 hover:text-ink"
      >
        {label}
        <Icon aria-hidden className="h-3.5 w-3.5 opacity-50" />
      </button>
    </th>
  );
}

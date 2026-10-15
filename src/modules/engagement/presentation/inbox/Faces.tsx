"use client";
import { AvatarGroup } from "@/shared/ui/primitives";
import { initials, isPraxis } from "./helpers";

export function Faces({ names, tint }: { names: string[]; tint?: string }) {
  return (
    <AvatarGroup
      people={names.map((name) => ({
        name,
        initials: initials(name),
        tint: isPraxis(name) ? undefined : tint,
      }))}
    />
  );
}

"use client";
import { setLinkComponent } from "@g4ai/ds";
import Link from "next/link";

/** Registra o `Link` do Next nos componentes do G4OS-DS que recebem `href`. */
setLinkComponent(Link);

export function DsSetup() {
  return null;
}

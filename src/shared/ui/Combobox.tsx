"use client";

import { Combobox as DsCombobox } from "@g4ai/ds";
import type { ComponentProps } from "react";

export type { ComboboxOption } from "@g4ai/ds";

type Props = ComponentProps<typeof DsCombobox>;

/**
 * Seleção com busca (sem acento) para listas de entidades, do G4OS-DS;
 * `multiple` mostra os escolhidos como chips removíveis. Como no `Select`,
 * `label` é só o nome acessível por padrão (`hideLabel={false}` desenha o
 * rótulo acima).
 */
export function Combobox({ hideLabel = true, ...props }: Props) {
  return <DsCombobox hideLabel={hideLabel} {...props} />;
}

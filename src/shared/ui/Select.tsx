"use client";

import { Select as DsSelect } from "@g4ai/ds";
import type { ComponentProps } from "react";

export type { SelectOption } from "@g4ai/ds";

type Props = ComponentProps<typeof DsSelect>;

/**
 * Lista curta e fixa (status, prioridade, tipo), do G4OS-DS. Listas longas de
 * entidades usam `Combobox`. Neste app o rótulo fica com o `FieldBlock` ou com
 * o texto ao redor, então `label` é só o nome acessível por padrão; passe
 * `hideLabel={false}` para o DS desenhar o rótulo acima do campo.
 */
export function Select({ hideLabel = true, ...props }: Props) {
  return <DsSelect hideLabel={hideLabel} {...props} />;
}

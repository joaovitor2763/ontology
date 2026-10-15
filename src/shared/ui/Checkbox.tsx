"use client";

import { Checkbox as DsCheckbox } from "@g4ai/ds";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof DsCheckbox>;

/**
 * Caixa de seleção do G4OS-DS. Aqui o padrão é só a caixa, com `label` como
 * nome acessível (seleção de linha, filtro com texto ao lado), como sempre foi
 * neste app. Para o rótulo ao lado da caixa, passe `hideLabel={false}`.
 */
export function Checkbox({ hideLabel = true, ...props }: Props) {
  return <DsCheckbox hideLabel={hideLabel} {...props} />;
}

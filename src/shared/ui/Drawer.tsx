"use client";

import { Drawer as DsDrawer } from "@g4ai/ds";
import type { ComponentProps } from "react";

/** Rótulo + controle, classes de campo e de área de texto: as do G4OS-DS. */
export { areaClass, FieldBlock, fieldClass } from "@g4ai/ds";

type Props = ComponentProps<typeof DsDrawer>;

/**
 * Painel lateral do G4OS-DS (`<dialog>` nativo: foco preso, Esc fecha, arrastar
 * até o fundo não fecha). Um drawer nunca abre outro drawer.
 *
 * O rodapé do DS é uma linha flexível alinhada à direita. Aqui muitos rodapés
 * já trazem a própria `div` de layout (`justify-between`, avisos à esquerda),
 * então essa `div` ocupa a largura toda, como antes; botões soltos num
 * fragmento ficam à direita, como no DS.
 */
export function Drawer({ footer, ...props }: Props) {
  return (
    <DsDrawer
      {...props}
      footer={
        footer ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-3 [&>div]:flex-1 [&>div]:flex-wrap [&>div]:gap-3">
            {footer}
          </div>
        ) : undefined
      }
    />
  );
}

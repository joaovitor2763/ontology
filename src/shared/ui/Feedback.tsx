import { notify as dsNotify } from "@g4ai/ds";

/**
 * Confirmação de uma ação local concluída, nunca de um clique ou envio sozinho.
 * Delega ao `notify` do G4OS-DS; o `<Toaster />` do DS (montado pelo AppShell)
 * mostra o toast: um por vez, 6,5 s, pausa no hover/foco, "Desfazer" opcional.
 */
export function notify(message: string, undo?: () => void) {
  dsNotify(message, undo);
}

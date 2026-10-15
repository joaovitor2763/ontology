/**
 * Modal (decisão curta, poucos campos, prévia) e ConfirmDialog (ação
 * destrutiva ou irreversível; substitui `window.confirm`). Vêm do G4OS-DS com
 * a mesma API: portal dentro do Drawer aberto, `onClose` em Esc/fundo/fechar,
 * `footer` alinhado à direita, `tone="danger"` com botão rose preenchido.
 */
export { ConfirmDialog, Modal } from "@g4ai/ds";

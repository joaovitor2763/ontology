/**
 * Um padrão único para gestos que esperam o servidor, vindo do G4OS-DS e
 * compatível com `useConfirmedOperation` (mesma forma: busy, pending, error,
 * uncertain, busyLabel, retry, reset).
 *
 * Enquanto confirma, quem informa é o próprio botão (`OperationButton`), com
 * rótulo de progresso e o formulário bloqueado; nada aparece e some ao lado.
 * Sucesso vira toast, dito pelo hook. Só o erro ganha bloco (`OperationFeedback`),
 * com "Verificar alteração" para resposta incerta e "Tentar novamente" para recusa.
 */
export { OperationButton, OperationFeedback } from "@g4ai/ds";

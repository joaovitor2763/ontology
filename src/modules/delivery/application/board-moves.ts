/**
 * Decisões puras sobre um movimento de tarefa no quadro: quando a recusa é
 * definitiva, quando reenviar sobre a revisão nova e como nomear a falha.
 */
export type MoveFailure = { status?: number; code?: string };

/** Só a troca de status pode ser reenviada sobre outra revisão: não carrega nada lido da anterior. */
export function isStatusOnlyPatch(patch: object) {
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'status';
}

/** Outra gravação no mesmo cliente trocou a revisão: um movimento de status é reenviado uma vez. */
export function shouldResendMove(failure: MoveFailure, patch: object, resent: boolean) {
  return !resent && failure.status === 409 && failure.code === 'snapshot_changed' && isStatusOnlyPatch(patch);
}

/** Resposta 4xx: o servidor recusou e nada foi gravado; 5xx ou rede deixam a gravação incerta. */
export function isFinalRefusal(failure: MoveFailure) {
  return Boolean(failure.status && failure.status < 500);
}

function sentence(text: string) {
  const trimmed = text.trim() || 'não foi possível salvar';
  const lowered = trimmed.charAt(0).toLocaleLowerCase('pt-BR') + trimmed.slice(1);
  return /[.!?…]$/.test(lowered) ? lowered : `${lowered}.`;
}

/** «Título» não foi movida: causa. Movimento é troca de status; o resto é atualização. */
export function taskFailureMessage(titles: readonly string[], patch: object, cause: string) {
  const verb = 'status' in patch ? 'movida' : 'atualizada';
  const subject = titles.length === 1 ? `«${titles[0]}» não foi ${verb}`
    : titles.length > 1 ? `${titles.length} tarefas não foram ${verb}s` : `A tarefa não foi ${verb}`;
  return `${subject}: ${sentence(cause)}`;
}

/** Enquanto uma gravação incerta espera "Tentar novamente", o próximo arrasto diz qual tarefa ficou e por quê. */
export function blockedMoveMessage(title: string, pendingError: string) {
  return `«${title}» não foi movida: resolva antes a falha pendente. ${pendingError}`.trim();
}

/** Gestos em fila descartados porque o anterior falhou. */
export function droppedMovesMessage(moves: readonly { title: string; patch: object }[]) {
  if (!moves.length) return '';
  const verb = moves.every(move => 'status' in move.patch) ? 'movida' : 'atualizada';
  const names = moves.length <= 3 ? moves.map(move => `«${move.title}»`).join(', ')
    : `${moves.length} tarefas`;
  return `${names} ${moves.length === 1 ? `não foi ${verb}` : `não foram ${verb}s`}: a alteração anterior falhou.`;
}

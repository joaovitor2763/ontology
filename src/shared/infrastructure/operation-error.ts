/**
 * Duas falhas diferentes pedem duas saídas diferentes.
 *
 * Recusa: o servidor rejeitou o comando (4xx), ou ele nem chegou a sair. A
 * gravação não aconteceu, repetir é seguro e a interface oferece "Tentar
 * novamente".
 *
 * Incerteza: o comando saiu e a confirmação não é confiável (rede, 5xx,
 * resposta ilegível).
 * Pode ter gravado. A interface oferece "Verificar alteração" — que repete a
 * mesma intenção com a mesma chave de idempotência — e "Revisar alteração".
 */
export class OperationRefused extends Error {
  readonly refused = true;
  /** O servidor recusou porque os dados mudaram (409): nada foi gravado e a tela precisa das versões atuais. */
  readonly conflict: boolean;
  constructor(message: string, options: { conflict?: boolean } = {}) {
    super(message);
    this.name = "OperationRefused";
    this.conflict = options.conflict === true;
  }
}

/** Uma falha só é incerta quando não é uma recusa conhecida. */
export function isUncertainFailure(failure: unknown): boolean {
  return !(failure instanceof OperationRefused);
}

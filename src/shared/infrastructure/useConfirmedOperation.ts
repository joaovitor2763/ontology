"use client";
import { useRef, useState } from "react";
import {
  discardProvisional,
  executeOperation,
  operationAttempt,
  showProvisionalNow,
  usesRemoteOperations,
} from "./operations.ts";
import { remoteOperationsSettled } from "./persistence.ts";
import { revalidateDocuments } from "./useLocalStorageState.ts";
import { isUncertainFailure, OperationRefused } from "./operation-error.ts";
import { notify } from "@/shared/ui/Feedback";

/**
 * Um gesto confirmado pelo servidor, com a mesma forma em toda a aplicação.
 *
 * `run(comando, entrada, local)` recebe a alteração local do contexto. No modo
 * navegador ela é a gravação; no modo remoto, com `optimistic`, ela vira o
 * valor provisório do documento enquanto o comando viaja — a tela responde na
 * hora e a resposta do servidor substitui o provisório. Falha descarta o
 * provisório, mostra a mensagem e deixa `retry()` repetir a mesma intenção com
 * a mesma chave de idempotência.
 *
 * Sem `optimistic` o comportamento é o anterior: a tela só muda depois da
 * confirmação. É o certo quando a identidade nasce no servidor (`tasks.create`,
 * `clients.create`, `meetings.create`), quando o gesto chama uma integração
 * (Google, WhatsApp, IA, upload) ou quando sai de um formulário com baseline
 * congelado. Um hook que mistura os dois casos nomeia em `optimistic` só os
 * comandos seguros.
 */
export type ConfirmedCommand = Parameters<typeof executeOperation>[0];

/**
 * O que a pessoa lê quando o gesto deu certo: um verbo no passado, e um
 * "Desfazer" só quando existe operação inversa segura.
 */
export type ConfirmedSuccess = { message: string; undo?: () => void };

export type ConfirmedOperationOptions = {
  /** Documentos observados quando o gesto sai de um formulário aberto. */
  baseline?: () => Record<string, string>;
  /** Recusa antes de enviar (permissão, por exemplo); devolve a mensagem. */
  guard?: (command: ConfirmedCommand, input: unknown) => string | null;
  /**
   * Aplica a alteração local enquanto o servidor confirma. `true` vale para o
   * hook inteiro; a lista vale só para os comandos nomeados, para hooks que
   * misturam gestos seguros com criação ou integração.
   */
  optimistic?: boolean | readonly ConfirmedCommand[];
  /** Verbo no passado do gesto confirmado, mostrado em toast. */
  success?: (command: ConfirmedCommand, input: unknown) => ConfirmedSuccess | string | null | undefined;
  /** Rótulo do botão enquanto o servidor confirma; "Salvando…" por padrão. */
  busyLabel?: string;
  /** Mensagem quando a falha não traz texto. */
  fallback?: string;
  /** Congela o baseline já na montagem, para telas sem gesto de abertura. */
  eager?: boolean;
  /**
   * Um gesto novo substitui a confirmação pendente em vez de repeti-la. Só para
   * gestos independentes entre si (mover um card, marcar um item), nunca para
   * formulários, onde a resposta incerta precisa ser verificada antes.
   */
  replacePending?: boolean;
};

export function useConfirmedOperation(options: ConfirmedOperationOptions = {}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const announce = useRef<(() => void) | null>(null);
  const lock = useRef(false);
  const request = useRef<null | (() => Promise<void>)>(null);
  const lastRefused = useRef(false);
  const baseline = useRef<Record<string, string> | null | undefined>(undefined);
  if (baseline.current === undefined)
    baseline.current = options.eager ? (options.baseline?.() ?? null) : null;
  const fallback = options.fallback ?? "Não foi possível confirmar a alteração.";

  /** Congela o que o formulário viu; chamado ao abrir a superfície de edição. */
  function begin() {
    baseline.current ??= options.baseline?.() ?? null;
  }
  function reset() {
    if (lock.current) return;
    request.current = null;
    lastRefused.current = false;
    baseline.current = null;
    announce.current = null;
    setPending(false);
    setError("");
    setUncertain(false);
  }
  async function retry(): Promise<string> {
    if (lock.current || !request.current) return "Aguarde a confirmação em andamento.";
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await request.current();
      request.current = null;
      lastRefused.current = false;
      baseline.current = null;
      setPending(false);
      setUncertain(false);
      announce.current?.();
      announce.current = null;
      return "";
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : fallback;
      lastRefused.current = !isUncertainFailure(failure);
      // Conflito: atualiza os documentos já, para "Tentar novamente" partir da versão atual.
      if (failure instanceof OperationRefused && failure.conflict) void revalidateDocuments();
      setUncertain(isUncertainFailure(failure));
      setError(message);
      return message;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function run(
    command: ConfirmedCommand,
    input: unknown,
    local: () => void | Promise<void>,
    confirmed?: () => void,
    before?: () => Promise<void>,
  ): Promise<string> {
    if (lock.current) return "Aguarde a confirmação em andamento.";
    // Só uma resposta incerta segura o próximo gesto (precisa ser verificada).
    // Uma recusa não gravou nada: um gesto novo substitui a intenção recusada
    // em vez de reenviá-la.
    if (request.current && !options.replacePending && !lastRefused.current) return retry();
    if (lastRefused.current) { request.current = null; lastRefused.current = false; }
    const refused = options.guard?.(command, input);
    if (refused) {
      setUncertain(false);
      setError(refused);
      return refused;
    }
    const body = structuredClone(input);
    const attempt = operationAttempt(command, body);
    /**
     * O provisório vai à frente do primeiro `await`, ainda dentro do evento,
     * quando nada pode mudar o documento antes do comando. O baseline é
     * recolhido depois dele — entre os dois não cabe nenhuma outra gravação, e
     * a comparação continua pegando qualquer mudança vinda de fora.
     *
     * Um formulário que congelou o baseline ao abrir (`begin`/`eager`) nunca
     * entra aqui: ali o provisório adiantado apagaria justamente a diferença
     * que o congelamento existe para detectar.
     */
    const applies = Array.isArray(options.optimistic)
      ? options.optimistic.includes(command)
      : options.optimistic === true;
    let preApplied =
      applies &&
      baseline.current == null &&
      !request.current &&
      !before &&
      remoteOperationsSettled() &&
      showProvisionalNow(command, () => void local());
    // Um formulário congelado (begin/eager) mantém o que viu; um gesto sem
    // congelamento relê a revisão atual depois de um conflito.
    const frozen = baseline.current != null;
    let expected = baseline.current ?? options.baseline?.();
    request.current = async () => {
      const shown = preApplied;
      preApplied = false;
      let queued = false;
      try {
        const remote = await usesRemoteOperations();
        // A partir daqui a fila responde pelo provisório, inclusive na falha.
        queued = remote && shown;
        if (remote) {
          await before?.();
          await executeOperation(
            command,
            body,
            attempt,
            expected ?? options.baseline?.(),
            applies ? () => void local() : undefined,
            shown,
          );
        } else {
          // Inalcançável hoje (só adiantamos com o modo remoto já resolvido);
          // fica explícito para que o provisório nunca seja aplicado duas vezes.
          if (shown) discardProvisional(command);
          await local();
        }
      } catch (failure) {
        if (shown && !queued) discardProvisional(command);
        if (!frozen && failure instanceof OperationRefused && failure.conflict) expected = undefined;
        throw failure;
      }
      confirmed?.();
    };
    const told = options.success?.(command, input);
    const success = typeof told === "string" ? { message: told } : told;
    announce.current = success ? () => notify(success.message, success.undo) : null;
    setPending(true);
    return retry();
  }
  return {
    busy,
    pending,
    error,
    /** A resposta se perdeu: verificar antes de repetir. */
    uncertain,
    busyLabel: options.busyLabel ?? "Salvando…",
    begin,
    reset,
    retry,
    run,
    setError,
  };
}

export type ConfirmedOperation = ReturnType<typeof useConfirmedOperation>;

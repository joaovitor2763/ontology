/**
 * Junta disparos seguidos do mesmo gatilho (foco e visibilidade chegam juntos ao
 * voltar à aba): enquanto uma execução está em curso, ou até `windowMs` depois
 * de ela começar, os disparos seguintes não repetem a leitura.
 */
export function coalesced(run: () => Promise<unknown>, windowMs = 1_000, now: () => number = Date.now) {
  let running: Promise<unknown> | null = null;
  let startedAt = -Infinity;
  return () => {
    if (running || now() - startedAt < windowMs) return;
    startedAt = now();
    const work = run().catch(() => undefined).finally(() => { running = null; });
    running = work;
  };
}

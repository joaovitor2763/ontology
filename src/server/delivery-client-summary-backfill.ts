import type { DeliverySnapshot } from '../modules/delivery/infrastructure/snapshot.ts';
import { buildClientSummary, summaryContext } from './delivery-client-summary.ts';
import { boardColumn, sameBoardColumn } from './delivery-client-summary-board.ts';

/**
 * Plano puro de `scripts/backfill-delivery-client-summary.mjs`: o resumo de
 * cada fatia da geração ativa, comparado com a linha gravada, e o SQL que grava
 * só o que falta ou está defasado.
 *
 * Cada linha se certifica sozinha (geração, revisão e encarnação da fatia, mais
 * os valores de cadastro e catálogo que registrou), então não há geração
 * invisível de várias linhas para trocar de uma vez: o `INSERT … SELECT` da
 * própria fatia é o CAS. Se a fatia andou entre a leitura e a gravação, nada é
 * gravado e o resumo continua defasado (o leitor usa a fatia); rodar de novo
 * resolve. Rodar duas vezes seguidas não grava nada na segunda.
 */
export type BackfillSlice = { company: string; revision: number; incarnation: string;
  snapshot: Partial<DeliverySnapshot> };
export type StoredSummaryRow = { company: string; authority_generation: string; source_revision: number;
  source_incarnation: string; inputs: string; body: string; board?: string | null };
/** `board` é a coluna de 0043 (`null` quando o resumo não tem a parte do quadro). */
export type SummaryBackfillRow = { company: string; revision: number; incarnation: string;
  state: 'current' | 'missing' | 'stale' | 'failed'; inputs?: string; body?: string; board?: string | null };

export function planSummaryBackfill(input: { generation: string; slices: BackfillSlice[];
  clientsRaw: unknown; catalogRaw: unknown; existing: StoredSummaryRow[] }): SummaryBackfillRow[] {
  const context = summaryContext(input.clientsRaw, input.catalogRaw);
  const stored = new Map(input.existing.map(row => [row.company, row]));
  return input.slices.map(slice => {
    const base = { company: slice.company, revision: slice.revision, incarnation: slice.incarnation };
    let summary;
    try {
      summary = buildClientSummary(context, slice.company, slice.snapshot);
    } catch {
      return { ...base, state: 'failed' as const };
    }
    const inputs = summary.inputs, body = JSON.stringify(summary.body);
    const board = boardColumn({ generation: input.generation, revision: slice.revision,
      incarnation: slice.incarnation }, summary);
    const row = stored.get(slice.company);
    // Linha sem a coluna do quadro (antes de 0043) ou em outro formato conta como defasada;
    // a coluna se compara pelo conteúdo, não pelos bytes comprimidos.
    const state = !row ? 'missing' as const
      : row.authority_generation === input.generation && row.source_revision === slice.revision &&
        row.source_incarnation === slice.incarnation && row.inputs === inputs && row.body === body &&
        sameBoardColumn(row.board, board)
        ? 'current' as const : 'stale' as const;
    return { ...base, state, inputs, body, board };
  });
}

const quote = (value: string | number) => typeof value === 'number' ? String(value)
  : `'${value.replaceAll("'", "''")}'`;

/** O mesmo comando de `clientSummaryStatement`, em texto para `wrangler d1 execute --file`. */
export function summaryBackfillSql(workspace: string, generation: string, row: SummaryBackfillRow,
  at = new Date().toISOString()) {
  if (row.inputs === undefined || row.body === undefined) throw new Error('Linha sem resumo calculado.');
  const board = row.board === undefined || row.board === null ? 'NULL' : quote(row.board);
  return `INSERT INTO delivery_client_summary
  (workspace_id,company,authority_generation,source_revision,source_incarnation,inputs,body,board,updated_at)
SELECT s.workspace_id,s.company,s.generation,s.revision,s.incarnation,${quote(row.inputs)},${quote(row.body)},${board},${quote(at)}
FROM delivery_client_snapshots s
WHERE s.workspace_id=${quote(workspace)} AND s.generation=${quote(generation)} AND s.company=${quote(row.company)}
  AND s.revision=${row.revision} AND s.incarnation=${quote(row.incarnation)}
ON CONFLICT(workspace_id,company) DO UPDATE SET
  authority_generation=excluded.authority_generation,source_revision=excluded.source_revision,
  source_incarnation=excluded.source_incarnation,inputs=excluded.inputs,body=excluded.body,
  board=excluded.board,updated_at=excluded.updated_at;`;
}

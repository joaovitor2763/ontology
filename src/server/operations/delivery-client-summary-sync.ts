import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { buildClientSummary, summaryContext, type ClientSummary } from '../delivery-client-summary.ts';
import { boardColumn } from '../delivery-client-summary-board.ts';
import { loadDocuments, prefetchDocuments } from './request-context.ts';

const CLIENTS = 'ontology.clients.v3', CATALOG = 'ontology.catalog.v2';

/** Uma fatia gravada por um comando: o corpo novo e a revisão/encarnação que ele terá. */
export type SliceWrite = { company: string; generation: string; revision: number;
  incarnation: string;
  /** O JSON exato gravado (texto, para nenhuma mutação posterior do objeto mudar o resumo). */
  plain: string };

/**
 * Todo comando que grava o corpo de uma fatia marca o comando SQL dessa
 * gravação aqui. `commitOperation` encontra as marcas entre os comandos do lote
 * e acrescenta, no mesmo `db.batch`, o resumo de cada fatia calculado com o
 * cadastro e o catálogo **depois** da escrita (os documentos que o próprio
 * commit grava valem sobre os da memória). Uma fatia gravada sem marca só
 * deixa o resumo defasado: a revisão muda e o leitor cai na fatia.
 */
const sliceWrites = new WeakMap<object, SliceWrite>();
export function markSliceWrite<T extends object>(db: D1Database, workspace: string, statement: T,
  write: SliceWrite): T {
  sliceWrites.set(statement, write);
  // Cadastro e catálogo do resumo chegam à memória da requisição antes do commit (sem ida a mais).
  prefetchDocuments(db, workspace, [CLIENTS, CATALOG]);
  return statement;
}
export const sliceWriteOf = (statement: object) => sliceWrites.get(statement);

/**
 * Grava o resumo só se a fatia está exatamente na revisão e na encarnação
 * calculadas (`INSERT … SELECT` da própria fatia): no lote do escritor isso é a
 * gravação que acabou de acontecer; no backfill, é o CAS contra uma escrita
 * concorrente. Linha antiga de outro cliente/geração é substituída. A coluna
 * `board` (0043) vai junto, com a identidade desta escrita.
 */
export function clientSummaryStatement(db: D1Database, workspace: string, write: Omit<SliceWrite, 'plain'>,
  summary: ClientSummary, at = new Date().toISOString()) {
  return db.prepare(`INSERT INTO delivery_client_summary
      (workspace_id,company,authority_generation,source_revision,source_incarnation,inputs,body,board,updated_at)
    SELECT s.workspace_id,s.company,s.generation,s.revision,s.incarnation,?,?,?,?
    FROM delivery_client_snapshots s
    WHERE s.workspace_id=? AND s.generation=? AND s.company=? AND s.revision=? AND s.incarnation=?
    ON CONFLICT(workspace_id,company) DO UPDATE SET
      authority_generation=excluded.authority_generation,source_revision=excluded.source_revision,
      source_incarnation=excluded.source_incarnation,inputs=excluded.inputs,body=excluded.body,
      board=excluded.board,updated_at=excluded.updated_at`)
    .bind(summary.inputs, JSON.stringify(summary.body), boardColumn(write, summary), at, workspace,
      write.generation, write.company, write.revision, write.incarnation);
}

/**
 * Os resumos das fatias marcadas em `statements`, até `budget` comandos (o
 * resto fica defasado, como as páginas efetivas). O cálculo nunca derruba a
 * escrita: um cliente que não projeta fica sem resumo e o leitor usa a fatia.
 */
export async function clientSummaryStatements(db: D1Database, workspace: string,
  statements: readonly D1PreparedStatement[], writes: readonly { key: string; value: unknown }[],
  budget: number): Promise<D1PreparedStatement[]> {
  const pending = new Map<string, SliceWrite>();
  for (const statement of statements) {
    const write = sliceWrites.get(statement);
    if (write) pending.set(write.company, write);
  }
  if (!pending.size || budget < 1) return [];
  const written = (key: string) => writes.find(write => write.key === key);
  const missing = [CLIENTS, CATALOG].filter(key => !written(key));
  const loaded = missing.length ? await loadDocuments(db, workspace, missing) : [];
  const valueOf = (key: string) => written(key)?.value ?? loaded[missing.indexOf(key)]?.value;
  const context = summaryContext(valueOf(CLIENTS), valueOf(CATALOG));
  const at = new Date().toISOString(), result: D1PreparedStatement[] = [];
  for (const write of pending.values()) {
    if (result.length >= budget) break;
    try {
      result.push(clientSummaryStatement(db, workspace, write,
        buildClientSummary(context, write.company,
          JSON.parse(write.plain) as Partial<DeliverySnapshot>), at));
    } catch {
      // Sem resumo: a revisão nova deixa o anterior defasado e o leitor projeta a fatia.
    }
  }
  return result;
}

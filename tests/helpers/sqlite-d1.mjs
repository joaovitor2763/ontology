import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function sqliteD1() {
  const sql = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter(f => f.endsWith(".sql")).sort())
    sql.exec(readFileSync(`migrations/${file}`, "utf8"));
  const db = {
    prepare(query) {
      let args = [];
      return {
        __query: query,
        bind(...values) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        // D1 devolve linhas também no batch; um SELECT em lote tem `results`.
        async run() {
          return /^\s*(?:SELECT|WITH\b)/i.test(query)
            ? { results: sql.prepare(query).all(...args), meta: {} }
            : { meta: sql.prepare(query).run(...args) };
        },
      };
    },
    async batch(statements) {
      const check = process.env.CHECK_CLIENT_SUMMARY === "0" ? null : summaryHeads(sql);
      sql.exec("BEGIN IMMEDIATE");
      const results = [];
      try {
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
      } catch (e) { sql.exec("ROLLBACK"); throw e; }
      // O commit já aconteceu: o erro não pode voltar por aqui (quem chama trataria como
      // falha de lote e acharia o recibo). Vira exceção não tratada, que derruba o teste.
      if (check) await checkClientSummaries(sql, check, statements)
        .catch(error => setImmediate(() => { throw error; }));
      return results;
    },
  };
  return { db, sql };
}

/** Revisões das fatias antes do lote, para a invariante do resumo. */
function summaryHeads(sql) {
  return new Map(sql.prepare(`SELECT workspace_id,generation,company,revision,incarnation
    FROM delivery_client_snapshots`).all()
    .map(row => [`${row.workspace_id}\u0000${row.generation}\u0000${row.company}`, `${row.revision}:${row.incarnation}`]));
}

/**
 * Invariante do resumo por cliente (0042), ligada em todos os testes que usam
 * este banco (`CHECK_CLIENT_SUMMARY=0` desliga): depois de um commit de
 * operação (lote com recibo), cada fatia `active` que mudou tem o resumo da
 * nova revisão, igual ao que a projeção daria — salvo quando o cadastro ou o
 * catálogo já não são os que o resumo registrou (o leitor recusa esse resumo).
 */
async function checkClientSummaries(sql, before, statements) {
  if (!statements.some(statement => /INSERT INTO operation_receipts/.test(statement.__query ?? ""))) return;
  const { decodeStateBody } = await import("../../src/server/state-body.ts");
  const { summaryContext, buildClientSummary } = await import("../../src/server/delivery-client-summary.ts");
  const { boardColumn, sameBoardColumn } = await import("../../src/server/delivery-client-summary-board.ts");
  for (const meta of sql.prepare("SELECT workspace_id,generation FROM delivery_client_shadow_meta WHERE mode='active'").all()) {
    const rows = sql.prepare(`SELECT s.company,s.revision,s.incarnation,s.body,c.inputs,c.body AS summary,c.board
      FROM delivery_client_snapshots s LEFT JOIN delivery_client_summary c ON c.workspace_id=s.workspace_id
        AND c.company=s.company AND c.authority_generation=s.generation AND c.source_revision=s.revision
        AND c.source_incarnation=s.incarnation
      WHERE s.workspace_id=? AND s.generation=?`).all(meta.workspace_id, meta.generation)
      .filter(row => before.get(`${meta.workspace_id}\u0000${meta.generation}\u0000${row.company}`) !==
        `${row.revision}:${row.incarnation}`);
    if (!rows.length) continue;
    const doc = async key => {
      const row = sql.prepare("SELECT body FROM state_documents WHERE workspace_id=? AND key=?").get(meta.workspace_id, key);
      return row ? decodeStateBody(row.body) : undefined;
    };
    const context = summaryContext(await doc("ontology.clients.v3"), await doc("ontology.catalog.v2"));
    for (const row of rows) {
      if (row.summary === null)
        throw new Error(`Resumo não gravado com a fatia de ${row.company} (revisão ${row.revision}).`);
      const expected = buildClientSummary(context, row.company, await decodeStateBody(row.body));
      if (expected.inputs !== row.inputs ||
          JSON.parse(row.summary).plan.followedId !== expected.body.plan.followedId) continue;
      if (JSON.stringify(expected.body) !== row.summary)
        throw new Error(`Resumo de ${row.company} difere da projeção da fatia (revisão ${row.revision}).`);
      // A coluna do quadro (0043) vem no mesmo comando, com a identidade desta escrita.
      if (!sameBoardColumn(row.board, boardColumn({ generation: meta.generation, revision: row.revision,
        incarnation: row.incarnation }, expected)))
        throw new Error(`Parte do quadro do resumo de ${row.company} difere da projeção (revisão ${row.revision}).`);
    }
  }
}

// Processo filho de `delivery-client-summary.test.mjs`: roda no fuso de `TZ` e
// imprime contador, fila e soma da carteira (admin), sem e com resumos (0042).
// Reuniões gravadas como instante ISO, relógio fixo às 23h40 de São Paulo
// (02h40 UTC do dia seguinte): o dia das regras e as bordas de reunião diferem
// entre os fusos do processo se alguém ler a hora local.
const FIXED = Date.parse("2026-10-07T02:40:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [FIXED])); }
  static now() { return FIXED; }
};
const { activeWorkspace, session, writeSummaries } = await import("./active-workspace.mjs");
const { readPortfolioSummary } = await import("../../src/server/operations/portfolio.ts");
const { readAlertQueue } = await import("../../src/server/operations/alert-queue.ts");
const { countAlerts } = await import("../../src/server/operations/alerts-count.ts");

const f = activeWorkspace({ extraClients: 40, now: new Date() });
const admin = session("admin");
const fresh = () => ({ DB: { prepare: f.db.prepare.bind(f.db), batch: f.db.batch.bind(f.db) } });
async function measure() {
  const portfolio = await readPortfolioSummary(fresh(), admin);
  return {
    count: (await countAlerts(fresh(), admin)).data.count,
    queue: (await readAlertQueue(fresh(), admin)).data.length,
    portfolio: Object.values(portfolio.data).reduce((sum, row) => sum + row.alertCount, 0),
  };
}
const slices = await measure();
writeSummaries(f);
const summaries = await measure();
f.sql.close();
console.log(JSON.stringify({ slices, summaries }));

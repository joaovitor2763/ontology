/**
 * Seleção em massa da fila de alertas. Regras puras, usadas pela lista e
 * pelos testes: a mesma identidade de alerta (cliente + ID) em todo lugar e a
 * separação entre o que a pessoa vê e o que ela pode marcar como visto.
 */
export type AlertRef = { company: string; id: string };

/** Uma linha da fila: o ID do alerta só é único dentro do cliente. */
export const alertKey = (alert: AlertRef) => `${alert.company}\u0000${alert.id}`;

/** O servidor aceita até este número de pares cliente/ID por lote. */
export const ALERT_BATCH_LIMIT = 1000;

/** Linhas por página na fila; a seleção pode ir além da página. */
export const ALERT_PAGE_SIZE = 50;

export function alertSelection<T extends AlertRef>(rows: readonly T[], selected: ReadonlySet<string>,
  canAcknowledge: (company: string) => boolean) {
  const allowed = new Map<string, boolean>();
  const may = (company: string) => {
    let value = allowed.get(company);
    if (value === undefined) allowed.set(company, value = canAcknowledge(company));
    return value;
  };
  const selectable = rows.filter(alert => may(alert.company));
  const selectedRows = selectable.filter(alert => selected.has(alertKey(alert)));
  const all = selectable.length > 0 && selectedRows.length === selectable.length;
  const blocked = rows.length - selectable.length;
  const count = blocked ? `${selectable.length} de ${rows.length} podem ser marcados por você` : String(selectable.length);
  return {
    selectable,
    selectedRows,
    all,
    some: selectedRows.length > 0 && !all,
    blocked,
    /** Rótulo do botão que seleciona a fila filtrada. */
    label: all ? 'Desmarcar filtrados' : `Selecionar filtrados (${count})`,
  };
}

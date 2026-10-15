/**
 * Deterministic pt-BR date formatting. `Intl` output differs between the
 * Workers runtime and browsers (abbreviations, punctuation), which breaks
 * hydration; these helpers produce the same text everywhere.
 */
export const MONTHS_LONG = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
export const WEEKDAYS_LONG = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
export const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Parses ISO date or date-time strings; date-only values are pinned to noon. */
export function toDate(value: string | Date) {
  if (value instanceof Date) return value;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
}

export function monthShort(d: Date) {
  return MONTHS_SHORT[d.getMonth()];
}
export function monthLong(d: Date) {
  return MONTHS_LONG[d.getMonth()];
}
export function weekdayShort(d: Date) {
  return WEEKDAYS_SHORT[d.getDay()];
}
export function weekdayLong(d: Date) {
  return WEEKDAYS_LONG[d.getDay()];
}
/** "09:30" */
export function timeOf(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "14 de set." */
export function dayMonthShort(d: Date) {
  return `${d.getDate()} de ${monthShort(d)}.`;
}
/** "14 de setembro" */
export function dayMonthLong(d: Date) {
  return `${d.getDate()} de ${monthLong(d)}`;
}
/** "14 de set. de 2026" */
export function dateShort(d: Date) {
  return `${dayMonthShort(d)} de ${d.getFullYear()}`;
}
/** "14 de set., 09:30" */
export function dateTimeShort(d: Date) {
  return `${dayMonthShort(d)}, ${timeOf(d)}`;
}
/** "seg., 14 de set." */
export function weekdayDateShort(d: Date) {
  return `${weekdayShort(d)}., ${dayMonthShort(d)}`;
}
/** "setembro de 2026" */
export function monthYearLong(d: Date) {
  return `${monthLong(d)} de ${d.getFullYear()}`;
}
/** "segunda-feira, 14 de setembro de 2026" */
export function dateFull(d: Date) {
  return `${weekdayLong(d)}, ${dayMonthLong(d)} de ${d.getFullYear()}`;
}
/** "segunda-feira, 14 de setembro" */
export function weekdayDateLong(d: Date) {
  return `${weekdayLong(d)}, ${dayMonthLong(d)}`;
}

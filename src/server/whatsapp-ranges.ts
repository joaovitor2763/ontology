export type ImportRange = { since: string; until: string };

/** Subtract fully imported windows, retaining a bounded recent reconciliation window. */
export function missingMessageRanges(
  requested: ImportRange,
  covered: ImportRange[],
  overlapMs: number,
): ImportRange[] {
  const start = Date.parse(requested.since), end = Date.parse(requested.until);
  const stableEnd = Math.max(start, end - overlapMs);
  const windows = covered
    .map((r) => [Math.max(start, Date.parse(r.since)), Math.min(stableEnd, Date.parse(r.until))])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const gaps: ImportRange[] = [];
  let cursor = start;
  const add = (a: number, b: number) => {
    if (b > a) gaps.push({ since: new Date(a).toISOString(), until: new Date(b).toISOString() });
  };
  for (const [a, b] of windows) {
    add(cursor, a);
    cursor = Math.max(cursor, b);
  }
  add(cursor, end);
  return gaps;
}

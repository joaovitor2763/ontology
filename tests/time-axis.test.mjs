import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDay,
  timelineSpan,
  cycleLanes,
} from "../src/shared/lib/time-axis.ts";
test("timeline dates include the final day and clip at period boundaries", () => {
  const oneDay = timelineSpan("2026-09-07", "2026-09-07", "2026-09-07", 14);
  assert.equal(oneDay.left, 0);
  assert.ok(Math.abs(oneDay.width - 100 / 14) < 1e-9);
  assert.deepEqual(timelineSpan("2026-09-01", "2026-09-30", "2026-09-07", 14), {
    left: 0,
    width: 100,
  });
  assert.equal(
    timelineSpan("2026-09-01", "2026-09-06", "2026-09-07", 14),
    null,
  );
  assert.equal(
    timelineSpan("2026-09-21", "2026-09-25", "2026-09-07", 14),
    null,
  );
  assert.equal(calendarDay("2026-03-09") - calendarDay("2026-03-08"), 1);
});
test("overlapping cycles occupy separate lanes without changing input order", () => {
  const cycles = [
    { id: "later", startsAt: "2026-09-15", endsAt: "2026-09-20" },
    { id: "first", startsAt: "2026-09-01", endsAt: "2026-09-14" },
    { id: "overlap", startsAt: "2026-09-14", endsAt: "2026-09-18" },
  ];
  const before = structuredClone(cycles);
  assert.deepEqual(
    cycleLanes(cycles).map((l) => l.map((c) => c.id)),
    [["first", "later"], ["overlap"]],
  );
  assert.deepEqual(cycles, before);
});

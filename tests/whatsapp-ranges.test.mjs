import test from 'node:test';
import assert from 'node:assert/strict';
import { missingMessageRanges } from '../src/server/whatsapp-ranges.ts';
const at = (n) => new Date(Date.UTC(2026, 0, n)).toISOString();
const range = (a,b) => ({since:at(a),until:at(b)});
test('message imports subtract merged coverage and retain only recent overlap', () => {
  assert.deepEqual(missingMessageRanges(range(1,30), [range(1,20),range(15,30)],86400000), [range(29,30)]);
  assert.deepEqual(missingMessageRanges(range(1,30), [],86400000), [range(1,30)]);
});
test('extending history fetches missing prefix and tail without repeating covered middle', () => {
  assert.deepEqual(missingMessageRanges(range(1,30), [range(10,25)],86400000), [range(1,10),range(25,30)]);
});
test('disjoint coverage preserves gaps and excludes outside windows', () => {
  assert.deepEqual(missingMessageRanges(range(1,30), [range(-10,-1),range(2,10),range(20,40)],86400000), [range(1,2),range(10,20),range(29,30)]);
});

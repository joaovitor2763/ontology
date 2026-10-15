import test from 'node:test';
import assert from 'node:assert/strict';
import { loadExecutionCycles } from '../src/modules/delivery/infrastructure/execution-cycles-collection.ts';

test('cycle collection retries a changed revision without publishing a partial view', async () => {
  let calls = 0;
  const result = await loadExecutionCycles({ fetcher: async () => {
    calls++;
    return calls === 1
      ? Response.json({ error: 'snapshot_changed' }, { status: 409 })
      : Response.json({ mode: 'active', cycles: [], tasks: [], milestoneNames: {},
        compatibilityVersion: 5, clientSnapshots: { acme: 'g:i:2' } });
  } });
  assert.equal(calls, 2);
  assert.equal(result.mode, 'active');
});

test('cycle collection rejects incomplete data and reuses a complete 304 revision', async () => {
  await assert.rejects(loadExecutionCycles({ fetcher: async () =>
    Response.json({ mode: 'active', cycles: [], tasks: [] }) }), /incompleta/);
  await assert.rejects(loadExecutionCycles({ fetcher: async () =>
    Response.json({ mode: 'active', cycles: [{ id: 'c', company: 'missing' }],
      tasks: [], milestoneNames: {}, compatibilityVersion: 1, clientSnapshots: {} }) }), /incompleta/);
  const current = { mode: 'active', cycles: [], tasks: [], milestoneNames: {},
    compatibilityVersion: 5, clientSnapshots: { acme: 'g:i:2' }, etag: '"g4-cycles:g:5:1:0"' };
  const result = await loadExecutionCycles({ current, fetcher: async (_url, options) => {
    assert.equal(options.headers['if-none-match'], current.etag);
    return new Response(null, { status: 304 });
  } });
  assert.equal(result, current);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveries } from '../src/modules/delivery/infrastructure/seed.ts';
import { selectDocumentTaskTitles } from '../src/server/operations/document-task-titles.ts';
import { loadDocumentTaskTitles } from '../src/modules/documents/infrastructure/task-titles.ts';

test('document links keep edited seed titles and tasks outside the selected plan', () => {
  const extra = { ...deliveries[0], id: 'doc-other-plan', title: 'Tarefa de outro plano',
    journeyId: 'other-plan' };
  const titles = selectDocumentTaskTitles(new Set([deliveries[0].id, extra.id, 'missing']), {
    statusMap: {}, extraTasks: [extra],
    taskPatches: { [deliveries[0].id]: { title: 'Título atualizado' } },
  });
  assert.equal(titles[deliveries[0].id], 'Título atualizado');
  assert.equal(titles[extra.id], 'Tarefa de outro plano');
  assert.equal(titles.missing, undefined);
});

test('over 1,000 document links publish only a complete matching snapshot', async () => {
  const ids = Array.from({ length: 1001 }, (_, index) => `task-${index}`);
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return Response.json({ snapshotVersion: 'active:g1:7',
      titles: Object.fromEntries(body.ids.map(id => [id, `Título ${id}`])) });
  };
  const loaded = await loadDocumentTaskTitles(ids, { fetcher });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ids.length, 1000);
  assert.equal(calls[1].ids.length, 1);
  assert.equal(calls[1].requireVersion, 'active:g1:7');
  assert.equal(Object.keys(loaded.values).length, 1001);
  assert.equal(loaded.values['task-1000'], 'Título task-1000');
  calls.length = 0;
  const unchanged = await loadDocumentTaskTitles(ids, { previous: loaded,
    fetcher: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return Response.json({ unchanged: true, snapshotVersion: 'active:g1:7' });
    } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ifVersion, 'active:g1:7');
  assert.equal(unchanged, loaded);
});

test('document title batches restart when the logical version changes', async () => {
  const ids = Array.from({ length: 1001 }, (_, index) => `task-${index}`);
  let calls = 0;
  const loaded = await loadDocumentTaskTitles(ids, { fetcher: async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    if (calls === 2) return Response.json({ message: 'Mudou' }, { status: 409 });
    return Response.json({ snapshotVersion: calls === 1 ? 'active:g1:1' : 'active:g1:2',
      titles: Object.fromEntries(body.ids.map(id => [id, `Título ${id}`])) });
  } });
  assert.equal(calls, 4);
  assert.equal(loaded.version, 'active:g1:2');
  assert.equal(Object.keys(loaded.values).length, 1001);
});

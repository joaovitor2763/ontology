import test from 'node:test';
import assert from 'node:assert/strict';
import { loadExecutionBoard } from '../src/modules/delivery/infrastructure/execution-board-collection.ts';
import { encodeBoardTasks } from '../src/modules/delivery/infrastructure/execution-board-wire.ts';

const table = (tasks) => encodeBoardTasks(tasks);

test('board loader retries a changed revision and publishes only the complete response', async () => {
  const calls = [];
  const result = await loadExecutionBoard({ fetcher: async (url, options) => {
    calls.push([url, options.cache]);
    return calls.length === 1
      ? Response.json({ error: 'snapshot_changed' }, { status: 409 })
      : Response.json({ mode: 'active', taskTable: table([{ id: 't1', company: 'acme', title: 'Uma',
        status: 'fila', dueAt: '', checklist: [{ title: 'a', done: false }] }]), cycles: [], referenceTasks: [],
        compatibilityVersion: 7, clientSnapshots: { acme: 'g:i:2' } });
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(([url, cache]) => [url, cache]),
    [['/api/execution/board?formato=tabela', 'no-store'], ['/api/execution/board?formato=tabela', 'no-store']]);
  assert.equal(result.mode, 'active');
  assert.equal(result.clientSnapshots.acme, 'g:i:2');
  assert.deepEqual(result.tasks, [{ id: 't1', company: 'acme', title: 'Uma', status: 'fila', dueAt: '',
    checklist: [{ title: 'a', done: false }] }]);
  assert.equal('taskTable' in result, false);
});

test('board loader refuses incomplete data and does not treat an integrity error as legacy', async () => {
  await assert.rejects(loadExecutionBoard({ fetcher: async () =>
    Response.json({ mode: 'active', taskTable: table([]), cycles: [], compatibilityVersion: 1 }) }),
  /incompleta/);
  await assert.rejects(loadExecutionBoard({ fetcher: async () =>
    Response.json({ mode: 'active', taskTable: table([{ id: 't1', company: 'missing' }]), cycles: [], referenceTasks: [],
      compatibilityVersion: 1, clientSnapshots: {} }) }), /incompleta/);
  // Sem tabela nem lista de objetos, ou tabela corrompida: incompleta, nunca um quadro vazio.
  await assert.rejects(loadExecutionBoard({ fetcher: async () =>
    Response.json({ mode: 'active', cycles: [], referenceTasks: [],
      compatibilityVersion: 1, clientSnapshots: {} }) }), /incompleta/);
  await assert.rejects(loadExecutionBoard({ fetcher: async () =>
    Response.json({ mode: 'active', tasks: [{ id: 't1', company: 'missing' }], cycles: [], referenceTasks: [],
      compatibilityVersion: 1, clientSnapshots: { acme: 'g:i:1' } }) }), /incompleta/);
  const broken = table([{ id: 't1', company: 'acme', title: 'x' }]);
  broken.rows[0][2] = 99;
  await assert.rejects(loadExecutionBoard({ fetcher: async () =>
    Response.json({ mode: 'active', taskTable: broken, cycles: [], referenceTasks: [],
      compatibilityVersion: 1, clientSnapshots: { acme: 'g:i:1' } }) }), /incompleta/);
  await assert.rejects(loadExecutionBoard({ fetcher: async () =>
    Response.json({ error: 'execution_snapshot_incomplete', message: 'A execução está sendo atualizada.' },
      { status: 503 }) }), /sendo atualizada/);
  assert.deepEqual(await loadExecutionBoard({ fetcher: async () =>
    Response.json({ mode: 'legacy' }) }), { mode: 'legacy' });
});

test('a Worker still on the previous version answers with objects; the board keeps only its fields', async () => {
  const result = await loadExecutionBoard({ fetcher: async () => Response.json({ mode: 'active',
    tasks: [{ id: 't1', company: 'acme', title: 'Uma', status: 'fila', dueAt: '', hours: 3, comments: [] }],
    cycles: [], referenceTasks: [], compatibilityVersion: 2, clientSnapshots: { acme: 'g:i:1' } }) });
  assert.deepEqual(result.tasks, [{ id: 't1', company: 'acme', title: 'Uma', status: 'fila', dueAt: '' }]);
});

test('board revalidation reuses a complete revision after 304', async () => {
  const current = { mode: 'active', tasks: [], cycles: [], referenceTasks: [],
    compatibilityVersion: 3, clientSnapshots: { acme: 'g:i:3' }, etag: '"g4-board-tabela:g:3:2:4"' };
  const result = await loadExecutionBoard({ current, fetcher: async (_url, options) => {
    assert.equal(options.headers['if-none-match'], current.etag);
    return new Response(null, { status: 304 });
  } });
  assert.equal(result, current);
});

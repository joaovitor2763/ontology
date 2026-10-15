import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientCycleCollection, loadClientDeliveryCollection, loadClientExecutionWorkspace } from '../src/modules/delivery/infrastructure/client-collection.ts';

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

test('client board loads complete pages under one client revision', async () => {
  const tasks = Array.from({ length: 101 }, (_, i) => ({ id: `task-${i}` }));
  const visited = [];
  const fetcher = async input => {
    const url = new URL(input, 'https://delivery.test');
    visited.push(url);
    assert.equal(url.searchParams.get('company'), 'one');
    if (url.pathname.endsWith('/cycles')) {
      // The first cycles page starts with the first tasks page, unguarded;
      // the loader compares their revisions instead.
      assert.equal(url.searchParams.get('expectedClientSnapshot'), null);
      return response({ data: [{ id: 'cycle-one' }], total: 1,
        snapshotVersion: 52, clientSnapshot: 'generation:one:2', nextCursor: null });
    }
    if (url.searchParams.has('cursor')) {
      assert.equal(url.searchParams.get('expectedClientSnapshot'), 'generation:one:2');
      return response({ data: tasks.slice(100), total: 101,
        snapshotVersion: 53, clientSnapshot: 'generation:one:2', nextCursor: null });
    }
    return response({ data: tasks.slice(0, 100), total: 101,
      snapshotVersion: 51, clientSnapshot: 'generation:one:2', nextCursor: '100' });
  };
  const result = await loadClientDeliveryCollection('one', { fetcher });
  assert.equal(result.tasks.length, 101);
  assert.deepEqual(result.cycles.map(cycle => cycle.id), ['cycle-one']);
  assert.equal(result.clientSnapshot, 'generation:one:2');
  assert.equal(visited.length, 3);
});

test('a concurrent client write restarts both collections instead of exposing partial pages', async () => {
  let firstTasks = 0;
  const fetcher = async input => {
    const url = new URL(input, 'https://delivery.test');
    const cursor = url.searchParams.get('cursor');
    if (url.pathname.endsWith('/tasks') && cursor === null) {
      firstTasks++;
      return response({ data: [{ id: `first-${firstTasks}` }], total: 2,
        snapshotVersion: firstTasks, nextCursor: '1' });
    }
    if (url.pathname.endsWith('/cycles')) {
      // A write lands between the two first pages of the first attempt.
      assert.equal(url.searchParams.get('expectedVersion'), null);
      return response({ data: [{ id: 'cycle-two' }], total: 1,
        snapshotVersion: 2, nextCursor: null });
    }
    assert.equal(url.searchParams.get('expectedVersion'), '2');
    return response({ data: [{ id: 'second-2' }], total: 2,
      snapshotVersion: 2, nextCursor: null });
  };
  const result = await loadClientDeliveryCollection('one', { fetcher });
  assert.equal(firstTasks, 2);
  assert.deepEqual(result.tasks.map(task => task.id), ['first-2', 'second-2']);
  assert.deepEqual(result.cycles.map(cycle => cycle.id), ['cycle-two']);
});

test('first pages start together and a rejected guard on a later page still restarts', async () => {
  let attempt = 0;
  const started = [];
  const fetcher = async input => {
    const url = new URL(input, 'https://delivery.test');
    if (!url.searchParams.has('cursor')) {
      started.push(url.pathname);
      if (url.pathname.endsWith('/tasks')) attempt++;
      // Both first pages are requested before either answers.
      await new Promise(resolve => setTimeout(resolve, 1));
      return response({ data: [{ id: `${url.pathname.slice(8)}-${attempt}` }],
        total: url.pathname.endsWith('/tasks') ? 2 : 1,
        snapshotVersion: 7, clientSnapshot: `generation:one:${attempt}`,
        nextCursor: url.pathname.endsWith('/tasks') ? '1' : null });
    }
    assert.equal(url.searchParams.get('expectedClientSnapshot'), `generation:one:${attempt}`);
    if (attempt === 1) return response({ error: { code: 'snapshot_changed' } }, 409);
    return response({ data: [{ id: 'tasks-last' }], total: 2, snapshotVersion: 7,
      clientSnapshot: `generation:one:${attempt}`, nextCursor: null });
  };
  const result = await loadClientDeliveryCollection('one', { fetcher });
  assert.deepEqual(started.slice(0, 2).sort(), ['/api/v1/cycles', '/api/v1/tasks']);
  assert.deepEqual(result.tasks.map(task => task.id), ['tasks-2', 'tasks-last']);
  assert.deepEqual(result.cycles.map(cycle => cycle.id), ['cycles-2']);
  assert.equal(result.clientSnapshot, 'generation:one:2');
});

test('the editor snapshot and list share a revision before the workspace is published', async () => {
  let snapshots = 0;
  const fetcher = async input => {
    const url = new URL(input, 'https://delivery.test');
    if (url.pathname.endsWith('/execution-snapshot')) {
      snapshots++;
      return response({ data: { mode: 'active', snapshot: { extraTasks: [] },
        clientSnapshot: `generation:one:${snapshots}` } });
    }
    const revision = snapshots === 1 ? 2 : snapshots;
    return response({ data: [], total: 0, snapshotVersion: 50,
      clientSnapshot: `generation:one:${revision}`, nextCursor: null });
  };
  const result = await loadClientExecutionWorkspace('one', { fetcher });
  assert.equal(snapshots, 2);
  assert.equal(result.mode, 'active');
  assert.equal(result.clientSnapshot, 'generation:one:2');
});

test('legacy workspace stops reading lists once the mode is known', async () => {
  const visited = [];
  const fetcher = async input => {
    visited.push(new URL(input, 'https://delivery.test').pathname);
    return response({ data: { mode: 'legacy' } });
  };
  assert.deepEqual(await loadClientExecutionWorkspace('one', { fetcher }), { mode: 'legacy' });
  // The first read cannot know the mode and starts the lists with the slice.
  assert.equal(visited.filter(path => path.endsWith('/execution-snapshot')).length, 1);
  visited.length = 0;
  assert.deepEqual(await loadClientExecutionWorkspace('one', { fetcher }), { mode: 'legacy' });
  assert.deepEqual(visited, ['/api/v1/clients/one/execution-snapshot']);
});

test('the snapshot and first pages start in parallel for an active workspace', async () => {
  const started = [];
  let answered = 0;
  const fetcher = async input => {
    const url = new URL(input, 'https://delivery.test');
    started.push({ path: url.pathname, answeredBefore: answered });
    await new Promise(resolve => setTimeout(resolve, 1));
    answered++;
    if (url.pathname.endsWith('/execution-snapshot'))
      return response({ data: { mode: 'active', snapshot: { extraTasks: [] }, clientSnapshot: 'generation:one:9' } });
    return response({ data: [], total: 0, snapshotVersion: 3, clientSnapshot: 'generation:one:9', nextCursor: null });
  };
  // A previous test left the tab in legacy mode; an active answer resets it.
  await loadClientExecutionWorkspace('one', { fetcher });
  started.length = 0; answered = 0;
  const result = await loadClientExecutionWorkspace('one', { fetcher });
  assert.equal(result.mode, 'active');
  assert.equal(started.length, 3);
  assert.ok(started.every(call => call.answeredBefore === 0));
});

test('cycle selector loads all pages under one client revision and retries a changed page', async () => {
  let firstPages = 0;
  const fetcher = async input => {
    const url = new URL(input, 'https://delivery.test');
    assert.equal(url.pathname, '/api/v1/cycles');
    assert.equal(url.searchParams.get('company'), 'one');
    if (!url.searchParams.has('cursor')) {
      firstPages++;
      return response({ data: [{ id: `cycle-${firstPages}` }], total: 2,
        snapshotVersion: 10 + firstPages, clientSnapshot: `generation:one:${firstPages}`,
        nextCursor: '1' });
    }
    assert.equal(url.searchParams.get('expectedClientSnapshot'), `generation:one:${firstPages}`);
    if (firstPages === 1) return response({ error: { code: 'snapshot_changed' } }, 409);
    return response({ data: [{ id: 'cycle-last' }], total: 2, snapshotVersion: 13,
      clientSnapshot: 'generation:one:2', nextCursor: null });
  };
  const cycles = await loadClientCycleCollection('one', { fetcher });
  assert.equal(firstPages, 2);
  assert.deepEqual(cycles.map(cycle => cycle.id), ['cycle-2', 'cycle-last']);
});

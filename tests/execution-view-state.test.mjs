import test from 'node:test';
import assert from 'node:assert/strict';
import { registerActiveExecutionView, skipsActiveExecutionDocument } from
  '../src/shared/infrastructure/execution-view-state.ts';

test('global execution skips legacy polling only while an active collection is mounted', () => {
  assert.equal(skipsActiveExecutionDocument('/execucao'), false);
  const leaveBoard = registerActiveExecutionView();
  const leaveCycles = registerActiveExecutionView();
  assert.equal(skipsActiveExecutionDocument('/execucao'), true);
  assert.equal(skipsActiveExecutionDocument('/clientes'), false);
  leaveBoard();
  assert.equal(skipsActiveExecutionDocument('/execucao'), true);
  leaveCycles();
  assert.equal(skipsActiveExecutionDocument('/execucao'), false);
});

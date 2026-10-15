import type { ServerEnv } from '../context.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { OperationError } from './errors.ts';
import { id } from './input.ts';
import { readClientShadowSnapshot } from './delivery-client-shadow-read.ts';

/** Raw client slice for the editor; task and cycle lists use the paginated API. */
export async function readClientExecutionSnapshot(
  env: ServerEnv, principal: OperationPrincipal, companyValue: unknown,
) {
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  const company = id(companyValue, 'cliente');
  const workspace = env.WORKSPACE_ID || 'default';
  await authorizeOperation(env.DB, workspace, principal,
    { action: 'clientes.ver', scope: 'delivery:read', company });
  const active = await readClientShadowSnapshot(env.DB, workspace, company, true, true);
  if (!active) return { data: { mode: 'legacy' as const } };
  if (!active.clientSnapshot || active.clientSnapshot.includes(':missing:'))
    throw new OperationError(503, 'execution_snapshot_incomplete',
      'A execução está sendo atualizada. Tente novamente.');
  return { data: { mode: 'active' as const, company, snapshot: active.snapshot,
    clientSnapshot: active.clientSnapshot } };
}

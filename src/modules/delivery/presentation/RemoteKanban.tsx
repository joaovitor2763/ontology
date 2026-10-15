"use client";

import { useCatalogState } from '@/modules/catalog/infrastructure/state';
import type { Delivery } from '../domain/models';
import type { ActiveExecutionBoard } from '../infrastructure/execution-board-collection';
import { Kanban, KanbanSurface } from './Kanban';
import { useExecutionBoard } from './useExecutionBoard';
import { useRemoteBoardOperations } from './useRemoteBoardOperations';
import { TaskListView } from './TaskList';
import { RemoteNewDeliveryForm } from './NewDeliveryForm';
import { ClientTaskDrawer } from '@/modules/workspace/presentation/ClientTaskDrawer';
import { Button } from '@/shared/ui/primitives';
import { registerActiveExecutionView } from '@/shared/infrastructure/execution-view-state';
import { useEffect } from 'react';

/** Active remote board reads the selected plan from client slices. */
export function RemoteKanban({ initialClients }: { initialClients?: string[] }) {
  const { board, error, loading, refresh, hold, update } = useExecutionBoard();
  useEffect(() => board?.mode === 'active'
    ? registerActiveExecutionView() : undefined, [board?.mode]);
  if (board?.mode === 'legacy') return <Kanban initialClients={initialClients} />;
  if (board?.mode === 'active') return <ActiveRemoteKanban board={board}
    initialClients={initialClients} refresh={refresh} hold={hold} update={update} readError={error} />;
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm">
    <p className={error ? 'text-rose' : 'text-muted'}>
      {error || (loading ? 'Carregando tarefas…' : 'Não foi possível carregar as tarefas.')}
    </p>
    {error && <Button size="sm" onClick={() => void refresh().catch(() => {})}>Tentar novamente</Button>}
  </div>;
}

function ActiveRemoteKanban({ board, initialClients, refresh, hold, update, readError }: {
  board: ActiveExecutionBoard;
  initialClients?: string[];
  refresh: () => Promise<unknown>;
  hold: () => () => void;
  update: (change: (previous: ActiveExecutionBoard) => ActiveExecutionBoard) => void;
  readError: string;
}) {
  const { products } = useCatalogState();
  const operation = useRemoteBoardOperations(board, update, refresh, hold);
  /** A failed background read keeps the last complete board and never blocks a move. */
  const displayOperation = { ...operation,
    notice: readError ? 'Não foi possível atualizar o quadro. Tentando de novo…' : '' };
  return <KanbanSurface initialClients={initialClients} items={board.tasks}
    cycles={board.cycles} products={products} msOptions={[]}
    operation={displayOperation} patchTask={operation.patchTask}
    renderList={(tasks, onOpen, ownerName) => <TaskListView tasks={tasks}
      onOpen={onOpen} ownerName={ownerName} cycles={board.cycles} products={products}
      operation={{ ...displayOperation, error: '' }}
      onPatch={(ids, patch) => update(current => ({ ...current,
        tasks: current.tasks.map(task => ids.includes(task.id) ? { ...task, ...patch } : task),
      }))} />}
    renderCreate={(onClose, onCreated) => <RemoteNewDeliveryForm board={board}
      refresh={refresh} onClose={onClose}
      onCreated={(task: Delivery) => { onCreated(task); void refresh().catch(() => {}); }} />}
    renderDrawer={(task, onClose) => task ? <ClientTaskDrawer key={`${task.company}:${task.id}`}
      company={task.company} taskId={task.id}
      onClose={() => { onClose(); void refresh().catch(() => {}); }} /> : null} />;
}

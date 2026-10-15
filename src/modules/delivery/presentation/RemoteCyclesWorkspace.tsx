"use client";

import { useCatalogState } from '@/modules/catalog/infrastructure/state';
import { padMilestone } from '@/shared/lib/format';
import { Button } from '@/shared/ui/primitives';
import { registerActiveExecutionView } from '@/shared/infrastructure/execution-view-state';
import { useEffect } from 'react';
import { CyclesWorkspace, CyclesWorkspaceSurface } from './CyclesWorkspace';
import { useExecutionCycles } from './useExecutionCycles';

/** The global cycle and schedule views use all client slices, including archived clients. */
export function RemoteCyclesWorkspace({ schedule, initialClients }: {
  schedule?: boolean; initialClients?: string[];
}) {
  const { collection, error, refresh } = useExecutionCycles();
  const { products } = useCatalogState();
  useEffect(() => collection?.mode === 'active'
    ? registerActiveExecutionView() : undefined, [collection?.mode]);
  if (collection?.mode === 'legacy') return <CyclesWorkspace embedded
    schedule={schedule} initialClients={initialClients} />;
  if (collection?.mode === 'active') return <CyclesWorkspaceSurface embedded
    schedule={schedule} initialClients={initialClients}
    execution={{ cycles: collection.cycles, tasks: collection.tasks, products,
      storageError: error, remote: true, onCommitted: () => { void refresh().catch(() => {}); },
      milestoneLabel: cycle => cycle.milestone
        ? `${padMilestone(cycle.milestone)}${collection.milestoneNames[cycle.id]
          ? ` · ${collection.milestoneNames[cycle.id]}` : ''}` : null,
    }} />;
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm">
    <p className={error ? 'text-rose' : 'text-muted'}>
      {error || 'Carregando ciclos…'}
    </p>
    {error && <Button size="sm" onClick={() => void refresh().catch(() => {})}>Tentar novamente</Button>}
  </div>;
}

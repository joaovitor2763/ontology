"use client";

import { ClientExecutionProvider, useScopedClientExecution } from '@/modules/delivery/infrastructure/ClientExecutionProvider';
import { useDeliveryState } from '@/modules/delivery/infrastructure/state';
import { TaskDrawer } from '@/modules/delivery/presentation/TaskDrawer';
import { useClientProgress } from '@/modules/delivery/presentation/useClientProgress';
import { paths } from '@/shared/lib/routes';
import { Drawer } from '@/shared/ui/Drawer';
import { Button } from '@/shared/ui/primitives';

export function ClientTaskDrawer({ company, taskId, onClose }: {
  company: string; taskId: string; onClose: () => void;
}) {
  return <ClientExecutionProvider key={company} company={company}
    loadingFallback={<Drawer open onClose={onClose} title="Abrindo tarefa">
      <p className="text-sm text-muted">Carregando tarefa…</p>
    </Drawer>}
    errorFallback={<Drawer open onClose={onClose} title="Não foi possível abrir a tarefa">
      <p className="text-sm text-rose">Tente abrir a tarefa novamente ou acesse sua página.</p>
      <Button className="mt-4" href={paths.clientDelivery(company, taskId)}>Abrir página</Button>
    </Drawer>}>
    <ScopedClientTaskDrawer company={company} taskId={taskId} onClose={onClose} />
  </ClientExecutionProvider>;
}

function ScopedClientTaskDrawer({ company, taskId, onClose }: {
  company: string; taskId: string; onClose: () => void;
}) {
  const scoped = useScopedClientExecution();
  if (!scoped) return <Drawer open onClose={onClose} title="Abrir tarefa">
    <p className="text-sm text-muted">Abra a página da tarefa para continuar.</p>
    <Button className="mt-4" href={paths.clientDelivery(company, taskId)}>Abrir tarefa</Button>
  </Drawer>;
  return <ActiveClientTaskDrawer taskId={taskId} onClose={onClose} />;
}

function ActiveClientTaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const scoped = useScopedClientExecution()!;
  const { patchTask } = useDeliveryState();
  // Client screens and global lists follow the effective purchased plan;
  // the generic paginated list can omit a task from that projection.
  const progress = useClientProgress(scoped.company);
  const task = progress.all.find(row => row.id === taskId) ?? null;
  if (!task) return <Drawer open onClose={onClose} title="Tarefa indisponível">
    <p className="text-sm text-muted">A tarefa pode ter sido removida. Atualize a lista.</p>
  </Drawer>;
  return <TaskDrawer task={task} onClose={onClose} onChange={patchTask} />;
}

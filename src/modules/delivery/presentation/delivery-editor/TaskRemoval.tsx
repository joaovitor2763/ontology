"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useDeliveryState } from '../../infrastructure/state';
import { usePermissions } from '@/modules/workspace/presentation/usePermissions';
import { paths } from '@/shared/lib/routes';
import { ActionMenu } from '@/shared/ui/Menu';
import { ConfirmDialog } from '@/shared/ui/Dialog';
import type { DeliveryDraft } from './useDeliveryDraft';

export function TaskRemoval({ editor, onRemoved }: { editor: DeliveryDraft; onRemoved?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const { can } = usePermissions();
  const { removeTask } = useDeliveryState();
  const router = useRouter();
  if (!can('entregas.remover', editor.live.company)) return null;
  return <>
    <div className="mb-3 flex justify-end">
      <ActionMenu label="Ações da tarefa" actions={[{ label: 'Excluir tarefa', icon: <Trash2 />, tone: 'danger',
        disabled: editor.operation.busy, onSelect: () => setConfirming(true) }]} />
    </div>
    <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} title="Excluir tarefa?"
      description={<>“{editor.live.title}” sairá das listas e do ciclo. O histórico e os documentos vinculados serão preservados.</>}
      confirmLabel="Excluir tarefa" tone="danger" onConfirm={() => {
        void editor.operation.run('tasks.remove', { taskId: editor.live.id }, () => {}, () => {
          removeTask(editor.live.id);
          if (onRemoved) onRemoved();
          else router.push(paths.clientDeliveries(editor.live.company, editor.live.kind === 'request' ? 'solicitacoes' : 'entregas'));
        });
      }} />
  </>;
}

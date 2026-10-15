"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Button, Page } from "@/shared/ui/primitives";
import { formatDateTime, meetingLabel } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { ClientExecutionProvider } from "@/modules/delivery/infrastructure/ClientExecutionProvider";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { MeetingForm } from "../MeetingForm";
import {
  MeetingLifecycleDialog,
  type MeetingLifecycleSelection,
} from "../MeetingLifecycleDialog";
import { useMeetingDetail } from "../meeting-detail/useMeetingDetail";
import { MeetingDetailMain } from "../meeting-detail/MeetingDetailMain";
import { MeetingSidebar } from "../meeting-detail/MeetingSidebar";
import { MeetingContentStatus } from "../meeting-detail/MeetingContentStatus";
import { RemovedActions } from "../meeting-detail/RemovedActions";

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>();
  const { meetingsIncludingRemoved } = useEngagementState();
  const { mode } = useSyncStatus();
  const meeting = meetingsIncludingRemoved.find((item) => item.id === id);
  // Keep the editor and its pending Google/operation attempt mounted until it closes.
  const [editingCompany, setEditingCompany] = useState<string | null>(null);
  const scopeCompany = editingCompany ?? meeting?.company;
  if (mode === "remote" && !scopeCompany) return <MeetingNotFound />;
  const content = <MeetingDetailContent id={id} editOpen={editingCompany !== null}
    onEdit={() => { if (meeting) setEditingCompany(meeting.company); }}
    onCloseEdit={() => setEditingCompany(null)} />;
  if (mode !== "remote" || !scopeCompany) return content;
  return <ClientExecutionProvider key={scopeCompany} company={scopeCompany}>
    {content}
  </ClientExecutionProvider>;
}

function MeetingDetailContent({ id, editOpen, onEdit, onCloseEdit }: {
  id: string; editOpen: boolean; onEdit: () => void; onCloseEdit: () => void;
}) {
  const router = useRouter();
  const detail = useMeetingDetail(id);
  const [lifecycleSelection, setLifecycleSelection] =
    useState<MeetingLifecycleSelection | null>(null);
  const { can } = usePermissions();

  if (!detail.meeting) {
    return <MeetingNotFound />;
  }

  const { meeting: m, content, removed } = detail;
  return (
    <Page className="max-w-none">
      <PageHeading
        title={m.title}
        description={`${meetingLabel[m.kind]} · ${formatDateTime(m.startsAt)} · ${m.durationMin} min`}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={removed}
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </Button>
            {can("reunioes.agendar", m.company) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLifecycleSelection({ meeting: m, restore: removed })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                {removed ? "Restaurar reunião" : "Excluir"}
              </Button>
            )}
          </>
        }
      />
      {m.actions.some((action) => action.deliveryId) && (
        <p className="mt-3 text-sm text-muted">
          Tarefas vinculadas e sua origem são preservadas ao remover esta
          reunião.
        </p>
      )}
      {removed && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-line p-3 text-sm text-muted"
        >
          Reunião removida. Este registro está disponível para consulta; restaure
          para editar. Convites e tarefas não são recriados.
        </p>
      )}
      <MeetingContentStatus content={content} />
      <fieldset
        disabled={removed || content.busy || content.pending}
        className="min-w-0"
      >
        <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.78fr)]">
          <MeetingDetailMain
            detail={detail}
            onRemoveAction={(actionId) =>
              setLifecycleSelection({ meeting: m, actionId })
            }
          />
          <MeetingSidebar detail={detail} onEdit={onEdit} />
        </div>
      </fieldset>
      <MeetingForm
        meeting={m}
        open={editOpen && !removed}
        onClose={onCloseEdit}
      />
      <RemovedActions
        meeting={m}
        removed={removed}
        onRestore={(actionId) =>
          setLifecycleSelection({ meeting: m, actionId, restore: true })
        }
      />
      {lifecycleSelection && (
        <MeetingLifecycleDialog
          selection={lifecycleSelection}
          onClose={() => setLifecycleSelection(null)}
          onConfirmed={() => {
            if (!lifecycleSelection.actionId && !lifecycleSelection.restore)
              router.push(paths.agenda);
          }}
        />
      )}
    </Page>
  );
}

function MeetingNotFound() {
  return <Page>
    <p className="text-ink-soft">Reunião não encontrada.</p>
    <Link href={paths.agenda} className="mt-2 inline-block text-[13.5px] text-muted hover:text-ink">
      Voltar para a agenda
    </Link>
  </Page>;
}

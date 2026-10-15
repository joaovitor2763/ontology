"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, ArrowLeft, MessageCircle, Radar } from "lucide-react";

import { useInboxOperation } from "./useInboxOperation";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { whatsappGroupOf } from "@/modules/clients/domain/service-config";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import type { Thread } from "@/modules/engagement/domain/models";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { NOW } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";

import { CommunicationTemplates } from "./CommunicationTemplates";
import { InteractionTimeline } from "./InteractionTimeline";
import { ConnectWhatsApp, WhatsAppGroupView } from "./WhatsAppGroup";
import { ServiceSettings } from "@/modules/delivery/presentation/ServiceSettings";
import { useWhatsAppStatus } from "@/shared/infrastructure/whatsapp";
import { RelationshipCockpit } from "./RelationshipCockpit";
import { useSignals } from "./useSignals";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { useInboxState } from "../infrastructure/relationship-state";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/primitives";

import { mastersOn } from "./inbox/helpers";
import { useInboxFilters } from "./inbox/useInboxFilters";
import { useInboxNotes } from "./inbox/useInboxNotes";
import { ThreadList } from "./inbox/ThreadList";
import { ThreadHeader } from "./inbox/ThreadHeader";
import { MessageStream } from "./inbox/MessageStream";
import { Composer } from "./inbox/Composer";
import { ClientDrawer } from "./inbox/ClientDrawer";

export function Inbox({
  threads,
  company,
}: {
  threads: Thread[];
  company?: string;
}) {
  const { extraDocs, removedDocs, addDoc } = useDocumentsState();
  const { mode: syncMode } = useSyncStatus();
  const { allEvents } = useEngagementState();
  const { clientBySlug, configFor } = useClientsState();
  const whatsappGroup = company ? whatsappGroupOf(configFor(company)) : null;
  const whatsappStatus = useWhatsAppStatus();
  /** The seeded demo inbox stays reachable behind the connection panel. */
  const [demo, setDemo] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { me } = useTeam();
  const router = useRouter();
  const search = useSearchParams();
  const requested = search.get("conversa");
  const requestedView = search.get("visao");
  const [view, setView] = useState<"timeline" | "conversas" | "sinais">(
    !company
      ? "conversas"
      : requestedView === "sinais"
        ? "sinais"
        : requestedView === "conversas" || search.get("conversa")
          ? "conversas"
          : "timeline",
  );
  const [templates, setTemplates] = useState(false);
  const signals = useSignals(company);
  const meName = me.name;
  const isMine = useCallback(
    (name: string) => name.startsWith(meName),
    [meName],
  );
  const endRef = useRef<HTMLDivElement>(null);
  const [id, setId] = useState(
    requested ??
      threads.find((t) => t.unread > 0)?.id ??
      threads[0]?.id ??
      null,
  );
  const [threadOpen, setThreadOpen] = useState(Boolean(requested));
  function pick(threadId: string) {
    setId(threadId);
    setView("conversas");
    router.replace(
      company
        ? paths.clientConversations(company, threadId)
        : paths.conversations(threadId),
    );
  }
  const [conta, setConta] = useState(false);
  const [inbox, setInbox, storageError] = useInboxState();
  const operation = useInboxOperation();
  const drafts = inbox.notes;
  const filters = useInboxFilters({
    threads,
    spaces: inbox.spaces.filter(
      (space) => !company || space.company === company,
    ),
    inbox,
    drafts,
    company,
    isMine,
  });
  const { list, grouped, pinned, mine } = filters;

  const t = list.find((x) => x.id === id) ?? list[0];
  const notes = useInboxNotes({
    thread: t,
    setInbox,
    pinnedIds: inbox.pinned,
    me,
    operation,
    addDoc,
  });
  const messages = t
    ? [...t.messages, ...(drafts[t.id] ?? [])].sort((a, b) =>
        a.at.localeCompare(b.at),
      )
    : [];
  const visible = mine ? messages.filter((m) => isMine(m.from)) : messages;
  const acct = t ? clientBySlug(t.company) : undefined;
  const files = t
    ? documentsFor(t.company, extraDocs, removedDocs).slice(0, 5)
    : [];
  const nextEvent = t
    ? allEvents
        .filter((e) => e.company === t.company)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .find((e) => e.startsAt >= NOW)
    : undefined;
  const team = t ? mastersOn(t) : [];
  const peopleOn = t?.participants ?? [];

  function markUnread() {
    if (t) notes.updateThread(t.id, { read: false }, () => setThreadOpen(false));
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [id, drafts, mine]);

  const where =
    syncMode === "remote"
      ? "a equipe vê, o cliente não"
      : "salva neste navegador";
  const hint =
    t?.channel === "whatsapp"
      ? `Nota interna da conversa · ${where}.`
      : t?.channel === "call"
        ? `Nota interna da reunião · ${where}.`
        : `Nota do cliente · ${where}.`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      {storageError && (
        <p
          role="alert"
          className="bg-amber-soft px-4 py-2 text-[12px] text-amber"
        >
          {storageError}
        </p>
      )}
      {!company && (
        <div
          className={cn(
            "page-gutter shrink-0 border-b border-line pb-6 pt-5",
            threadOpen && "hidden lg:block",
          )}
        >
          <h1 className="text-[25px] font-semibold tracking-tight">
            Conversas
          </h1>
          <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-muted">
            Conversas, calls e notas de cada cliente, com o contexto sempre à
            mão.
          </p>
        </div>
      )}

      {company && (
        <div className="page-gutter flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <SegmentedControl
            label="Visão das conversas"
            value={view}
            onChange={setView}
            options={[
              { value: "timeline", label: "Timeline", icon: <Activity /> },
              {
                value: "conversas",
                label: "Conversas",
                icon: <MessageCircle />,
              },
              {
                value: "sinais",
                label:
                  signals.open.length > 0
                    ? `Sinais · ${signals.open.length}`
                    : "Sinais",
                icon: <Radar />,
              },
            ]}
          />
          <span className="text-[12px] text-muted">
            {view === "timeline"
              ? "Tudo o que aconteceu com o cliente, em ordem. Nada aqui chega ao cliente."
              : "Sinais são lidos por regra nas mensagens do cliente. Nada é enviado."}
          </span>
        </div>
      )}

      {company && view === "sinais" ? (
        <div className="page-gutter min-h-0 flex-1 overflow-y-auto py-6">
          <RelationshipCockpit
            company={company}
            onOpenThread={(threadId) => {
              pick(threadId);
              setThreadOpen(true);
            }}
          />
        </div>
      ) : company && view === "timeline" ? (
        <InteractionTimeline company={company} />
      ) : company && !demo && !(whatsappGroup && whatsappStatus.enabled) ? (
        <>
          <ConnectWhatsApp
            group={whatsappGroup}
            status={whatsappStatus}
            onConfigure={() => setSettingsOpen(true)}
            onDemo={() => setDemo(true)}
          />
          {settingsOpen && (
            <ServiceSettings
              company={company}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </>
      ) : company && !demo && whatsappGroup ? (
        <WhatsAppGroupView
          company={company}
          group={whatsappGroup}
          onTimeline={() => setView("timeline")}
        />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "w-full shrink-0 flex-col border-r border-line bg-soft/30 lg:w-[320px] xl:w-[340px]",
              threadOpen ? "hidden lg:flex" : "flex",
            )}
          >
            <ThreadList
              company={company}
              demo={demo}
              onLeaveDemo={() => setDemo(false)}
              q={filters.q}
              onSearch={filters.setQ}
              ch={filters.ch}
              onFilter={filters.setCh}
              grouped={grouped}
              empty={list.length === 0}
              onClear={filters.clear}
              clientName={(slug) => clientBySlug(slug)?.name}
              openSignalsOf={(slug) =>
                signals.byThread
                  .filter((x) => x.thread.company === slug)
                  .reduce((n, x) => n + x.open.length, 0)
              }
              signalsOf={(threadId) => signals.openCount(threadId)}
              currentId={t?.id}
              pinned={pinned}
              onPick={(threadId) => {
                if (operation.busy || operation.pending) return;
                pick(threadId);
                setThreadOpen(true);
                notes.updateThread(threadId, { read: true });
                notes.setText("");
              }}
            />
          </div>

          <div
            className={cn(
              "min-w-0 flex-1 flex-col",
              threadOpen ? "flex" : "hidden lg:flex",
            )}
          >
            <button
              onClick={() => setThreadOpen(false)}
              className="flex items-center gap-2 border-b border-line px-5 py-3 text-[12px] text-muted lg:hidden"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar às conversas
            </button>
            {t && acct ? (
              <>
                <ThreadHeader
                  thread={t}
                  tint={acct.tint}
                  peopleOn={peopleOn}
                  team={team}
                  mine={mine}
                  onToggleMine={() => filters.setMine((v) => !v)}
                  pinned={pinned.has(t.id)}
                  onTogglePin={() => notes.togglePin(t.id)}
                  onMarkUnread={markUnread}
                  onOpenClient={() => setConta(true)}
                  onOpenTemplates={() => setTemplates(true)}
                  operation={operation}
                />
                <MessageStream
                  thread={t}
                  tint={acct.tint}
                  peopleOn={peopleOn}
                  visible={visible}
                  meName={me.name}
                  operation={operation}
                  editableIds={(drafts[t.id] ?? [])
                    .map((n) => n.id)
                    .filter((noteId): noteId is string => Boolean(noteId))}
                  onEdit={notes.editNote}
                  endRef={endRef}
                />
                <Composer
                  hint={hint}
                  text={notes.text}
                  onText={notes.setText}
                  onSend={notes.send}
                  onFile={(e) => void notes.onFile(e)}
                  uploading={notes.uploading}
                  attachError={notes.attachError}
                  operation={operation}
                  company={company}
                  onTimeline={() => setView("timeline")}
                />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[14px] text-muted">
                <p>Nenhuma conversa ainda.</p>
                {company && (
                  <Button
                    onClick={() => setView("timeline")}
                    size="sm"
                    variant="ghost"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Ver timeline de interações
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {t && (
        <CommunicationTemplates
          company={t.company}
          open={templates}
          onClose={() => setTemplates(false)}
          onSaveNote={(body) => notes.addNote(body)}
          onResetSave={operation.reset}
        />
      )}

      <ClientDrawer
        open={conta}
        onClose={() => setConta(false)}
        client={acct}
        team={team}
        nextEvent={nextEvent}
        files={files}
      />
    </div>
  );
}

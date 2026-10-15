"use client";
import { DateTimePicker } from "@/shared/ui/DateTimePicker";
import { interactionOperationBaseline } from "@/shared/infrastructure/operations";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import type { InteractionTag } from "@/modules/engagement/domain/interaction-tags";
import { InteractionTagPicker, InteractionTagBadges } from "@/modules/engagement/presentation/InteractionTags";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  interactionLabel,
  meetingModalityLabel,
  type InteractionKind,
  type Meeting,
  type ProgramEvent,
  type ThreadMessage,
} from "@/modules/engagement/domain/models";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { EventForm } from "@/modules/engagement/presentation/EventForm";
import { MeetingForm } from "@/modules/engagement/presentation/MeetingForm";
import { Attachs } from "@/modules/engagement/presentation/NoteAttachments";
import { useInteractionNotes } from "@/modules/engagement/presentation/interactions-state";
import { cn } from "@/shared/lib/cn";
import { dayMonthShort } from "@/shared/lib/dates";
import { NOW, formatDateTime, meetingLabel } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Button, Empty } from "@/shared/ui/primitives";
import { TextareaField, TextField } from "@g4ai/ds";
import {
  ArrowUpRight,
  CalendarDays,
  History,
  Mail,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  StickyNote,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

type Item =
  | { id: string; at: string; kind: InteractionKind; note: ThreadMessage }
  | {
      id: string;
      at: string;
      kind: "reuniao";
      title: string;
      subtitle: string;
      summary?: string;
      href: string;
      future: boolean;
      meeting: Meeting;
    }
  | {
      id: string;
      at: string;
      kind: "evento";
      title: string;
      subtitle: string;
      href: string;
      future: boolean;
      event: ProgramEvent;
    };

type Filter = "all" | InteractionKind | "reuniao";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "reuniao", label: "Reuniões" },
  { id: "ligacao", label: "Ligações" },
  { id: "email", label: "E-mails" },
  { id: "conversa", label: "Conversas" },
  { id: "nota", label: "Notas" },
];
const KINDS: InteractionKind[] = ["nota", "ligacao", "email"];

const ICON: Record<Item["kind"], ReactNode> = {
  nota: <StickyNote className="h-3.5 w-3.5" />,
  ligacao: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  conversa: <MessageCircle className="h-3.5 w-3.5" />,
  reuniao: <Video className="h-3.5 w-3.5" />,
  evento: <CalendarDays className="h-3.5 w-3.5" />,
};

/** ISO instant → value of a `datetime-local` input, in the user's zone. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date(NOW);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  if (diff < 0) return `${dayMonthShort(d)} · próximo`;
  return dayMonthShort(d);
}

/**
 * Everything that happened with a client, in order: notes the team writes
 * (with a title, a kind, files and an edit log) and the meetings and events of
 * the agenda. Written by the team for the team; nothing here reaches the client.
 */
export function InteractionTimeline({ company }: { company: string }) {
  const { clientBySlug } = useClientsState();
  const { allMeetings, allEvents } = useEngagementState();
  const { notes, add, edit, reset, storageError, me } = useInteractionNotes(company);
  const {can}=usePermissions();
  const [filter, setFilter] = useState<Filter>("all");
  /** What is being written: a note-like interaction, or a meeting through the agenda form. */
  const [composing, setComposing] = useState<"note" | "meeting" | null>(null);
  const [editingNote,setEditingNote]=useState<ThreadMessage|null>(null);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [editingEvent, setEditingEvent] = useState<ProgramEvent | null>(null);
  const client = clientBySlug(company);

  const items: Item[] = [
    ...notes.map((note) => ({
      id: note.id ?? note.at,
      at: note.at,
      kind: note.interaction ?? ("nota" as const),
      note,
    })),
    ...allMeetings
      .filter((m) => m.company === company)
      .map((m) => ({
        id: m.id,
        at: m.startsAt,
        kind: "reuniao" as const,
        title: m.title,
        subtitle: [
          meetingLabel[m.kind],
          m.modality ? meetingModalityLabel[m.modality] : null,
          `${m.durationMin} min`,
          `${m.attendeeIds.length} ${m.attendeeIds.length === 1 ? "pessoa" : "pessoas"}`,
          m.place || null,
        ]
          .filter(Boolean)
          .join(" · "),
        summary: m.summary?.trim() || undefined,
        href: paths.meeting(m.id),
        future: m.startsAt > NOW,
        meeting: m,
      })),
    ...allEvents
      .filter((e) => e.company === company)
      .map((e) => ({
        id: e.id,
        at: e.startsAt,
        kind: "evento" as const,
        title: e.title,
        subtitle: e.kind,
        href: paths.clientAgenda(company),
        future: e.startsAt > NOW,
        event: e,
      })),
  ]
    .filter((item) =>
      filter === "all"
        ? true
        : filter === "reuniao"
          ? item.kind === "reuniao" || item.kind === "evento"
          : item.kind === filter,
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const agendaCount =
    allMeetings.filter((m) => m.company === company).length +
    allEvents.filter((e) => e.company === company).length;
  const counts = (id: Filter) =>
    id === "all"
      ? notes.length + agendaCount
      : id === "reuniao"
        ? agendaCount
        : notes.filter((n) => (n.interaction ?? "nota") === id).length;

  const groups: { day: string; items: Item[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.at);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  const tint = client?.tint ?? "#3f3f46";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {storageError && (
        <p role="alert" className="bg-amber-soft px-4 py-2 text-[12px] text-amber">
          {storageError}
        </p>
      )}
      <div className="page-gutter flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
        <div className="-mx-1 flex min-w-0 gap-0.5 overflow-x-auto px-1 text-[12.5px] whitespace-nowrap">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-lg px-2 py-1.5",
                filter === f.id
                  ? "bg-soft font-medium text-ink ring-1 ring-line"
                  : "text-muted hover:bg-soft",
              )}
            >
              {f.label}
              <span className="ml-1 text-[10.5px] opacity-60">{counts(f.id)}</span>
            </button>
          ))}
        </div>
        <Button size="sm" disabled={!!editingNote||!!composing||!can("interacoes.registrar",company)} onClick={() => setComposing("note")}>
          <Plus className="h-3.5 w-3.5" />
          Registrar interação
        </Button>
      </div>
      {composing === "meeting" && (
        <MeetingForm
          defaultCompany={company}
          open
          onClose={() => setComposing(null)}
        />
      )}
      {editingMeeting && (
        <MeetingForm
          meeting={editingMeeting}
          open
          onClose={() => setEditingMeeting(null)}
        />
      )}
      {editingEvent && (
        <EventForm
          event={editingEvent}
          open
          onClose={() => setEditingEvent(null)}
        />
      )}

      <div className="page-gutter min-h-0 flex-1 overflow-y-auto py-5">
        {composing === "note" && (
          <div className="mb-6">
            <NoteForm
              onCancel={() => {reset();setComposing(null);}}
              onReset={()=>reset()}
              onMeeting={() => setComposing("meeting")}
              onSubmit={async (input,baseline) => {
                const error = await add(input,baseline);
                if (!error) setComposing(null);
                return error;
              }}
            />
          </div>
        )}
        {editingNote&&<div className="mb-6"><NoteForm
          initial={{title:editingNote.title??"",text:editingNote.text,at:editingNote.at,kind:editingNote.interaction??"nota",tags:editingNote.tags}}
          onReset={()=>reset("edit:"+editingNote.id)}
          onCancel={()=>{reset("edit:"+editingNote.id);setEditingNote(null);}}
          onSubmit={async(input,baseline)=>{const error=await edit(editingNote.id!,{at:input.at,title:input.title,text:input.text,tags:input.tags},baseline);if(!error)setEditingNote(null);return error;}}
        /></div>}
        {groups.length === 0 ? (
          <Empty
            title="Nenhuma interação registrada"
            hint="Registre uma ligação, um e-mail, um encontro ou uma nota. As reuniões da agenda entram aqui sozinhas."
            action={
              !composing && (
                <Button size="sm" disabled={!!editingNote||!!composing||!can("interacoes.registrar",company)} onClick={() => setComposing("note")}>
                  <Plus className="h-3.5 w-3.5" />
                  Registrar interação
                </Button>
              )
            }
          />
        ) : (
          <ol className="relative border-l border-line pl-6">
            {groups.map((group) => (
              <li key={group.day} className="mb-6 last:mb-0">
                <p className="relative -ml-6 mb-3 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                  <span aria-hidden className="h-px w-6 bg-line" />
                  {group.day}
                </p>
                <ol className="space-y-3">
                  {group.items.map((item) => (
                    <li key={item.id} className="relative">
                      <span
                        aria-hidden
                        className={cn(
                          "absolute -left-[37px] top-3 grid h-6 w-6 place-items-center rounded-full ring-4 ring-page",
                          item.kind === "reuniao" || item.kind === "evento"
                            ? "bg-blue/10 text-blue"
                            : "bg-soft text-ink-soft",
                        )}
                      >
                        {ICON[item.kind]}
                      </span>
                      {item.kind === "reuniao" || item.kind === "evento" ? (
                        <AgendaEntry
                          item={item}
                          onEdit={() =>
                            item.kind === "reuniao"
                              ? setEditingMeeting(item.meeting)
                              : setEditingEvent(item.event)
                          }
                        />
                      ) : (
                        <NoteEntry
                          note={item.note}
                          kind={item.kind}
                          tint={tint}
                          meName={me.name}
                          onEdit={!editingNote&&!composing&&item.note.id&&can("interacoes.registrar",company) ? ()=>{setEditingNote(item.note!);} : undefined}
                        />
                      )}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function AgendaEntry({
  item,
  onEdit,
}: {
  item: Extract<Item, { kind: "reuniao" | "evento" }>;
  onEdit: () => void;
}) {
  return (
    <article className="linked-card surface-interactive rounded-xl border border-line bg-surface px-4 py-3 hover:border-line-strong">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={item.href}
          className="card-primary-link inline-flex min-w-0 items-center gap-2 text-[14px] font-medium hover:text-blue"
        >
          {item.title}
          <ArrowUpRight className="h-3.5 w-3.5 text-muted" />
        </Link>
        <span className="inline-flex items-center gap-2 text-[11.5px] text-muted">
          {formatDateTime(item.at)}
          {item.future ? " · agendada" : ""}
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md px-1.5 py-0.5 hover:bg-soft hover:text-ink"
          >
            Editar
          </button>
        </span>
      </div>
      <p className="mt-0.5 text-[12px] text-muted">{item.subtitle}</p>
      {item.kind === "reuniao" && <InteractionTagBadges tags={item.meeting.tags} />}
      {item.kind === "reuniao" && item.summary && (
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
          {item.summary}
        </p>
      )}
    </article>
  );
}

function NoteEntry({
  note,
  kind,
  tint,
  meName,
  onEdit,
}: {
  note: ThreadMessage;
  kind: InteractionKind;
  tint: string;
  meName: string;
  onEdit?: ()=>void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const history = note.history ?? [];
  const mine = note.from.startsWith(meName);
  const dateEdited = history.some((h) => h.field === "at");
  void tint;
  return (
    <article className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-[14px] font-medium">
          {note.title ?? interactionLabel[kind]}
          <span className="ml-2 text-[11.5px] font-normal text-muted">
            {interactionLabel[kind]}
          </span>
        </span>
        <span className="inline-flex items-center gap-2 text-[11.5px] text-muted">
          <span title={dateEdited ? "Data ajustada; veja o histórico" : undefined}>
            {formatDateTime(note.at)}
            {dateEdited && <span className="ml-1 text-amber">· ajustada</span>}
          </span>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md px-1.5 py-0.5 hover:bg-soft hover:text-ink"
            >
              Editar
            </button>
          )}
        </span>
      </div>
      <InteractionTagBadges tags={note.tags} />
      {note.text && (
        <p className="mt-1.5 whitespace-pre-line break-words text-[13.5px] leading-relaxed text-ink-soft">
          {note.text}
        </p>
      )}
      <Attachs files={note.attachments} docs={note.files} />
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
        <span>
          {note.from}
          {mine ? " · você" : ""}
        </span>
        {(note.createdAt || history.length > 0) && (
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            <History className="h-3 w-3" />
            {note.createdAt ? `registrada em ${formatDateTime(note.createdAt)}` : "histórico"}
            {history.length > 0 &&
              ` · ${history.length} ${history.length === 1 ? "edição" : "edições"}`}
          </button>
        )}
      </div>
      {logOpen && history.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-line pt-2 text-[11.5px] text-muted">
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="leading-relaxed">
              <span className="text-ink-soft">{h.by}</span> · {formatDateTime(h.at)} ·{" "}
              {h.field === "at" ? (
                <>
                  data de <s>{formatDateTime(h.from)}</s> para{" "}
                  <span className="text-ink-soft">{formatDateTime(h.to)}</span>
                </>
              ) : h.field === "tags" ? (
                <>tags de <s>{h.from || "nenhuma"}</s> para <span className="text-ink-soft">{h.to || "nenhuma"}</span></>
              ) : h.field === "title" ? (
                <>
                  título de <s>{h.from || "—"}</s> para{" "}
                  <span className="text-ink-soft">{h.to || "—"}</span>
                </>
              ) : (
                <>
                  texto alterado
                  <span className="mt-1 block rounded-md bg-soft px-2 py-1">
                    <s>{h.from}</s>
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function NoteForm({
  initial,
  onSubmit,
  onCancel,
  onMeeting,
  onReset,
}: {
  initial?: { title: string; text: string; at: string; kind: InteractionKind; tags?: InteractionTag[] };
  /** New interaction only: switch to the meeting form (type, modality, place, people). */
  onMeeting?: () => void;
  /** Resolves with an error message, or an empty string when saved. */
  onSubmit: (input: {
    title: string;
    text: string;
    at: string;
    kind: InteractionKind;
    files: File[];
    tags: InteractionTag[];
  },baseline:Record<string,string>) => Promise<string>;
  onCancel: () => void;
  onReset:()=>void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [when, setWhen] = useState(() => toLocalInput(initial?.at ?? new Date().toISOString()));
  const [kind, setKind] = useState<InteractionKind>(initial?.kind ?? "nota");
  const [tags, setTags] = useState<InteractionTag[]>(initial?.tags ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const locked=useRef(false);
  const pendingInput=useRef<Parameters<typeof onSubmit>[0]|null>(null);
  const baseline=useRef(interactionOperationBaseline());
  const [pending,setPending]=useState(false);
  const editing = Boolean(initial);
  const canSave = !saving && (title.trim() || text.trim() || files.length > 0);
  async function submit() {
    const parsed = new Date(when);
    if (locked.current||!canSave || Number.isNaN(parsed.getTime())) return;
    locked.current=true;setSaving(true);setError("");
    pendingInput.current??={title:title.trim(),text:text.trim(),at:parsed.toISOString(),kind,tags:[...tags],files:[...files]};
    setPending(true);
    try {const problem=await onSubmit(pendingInput.current,baseline.current);if(problem)setError(problem);}
    catch(e){setError(e instanceof Error?e.message:"Não foi possível confirmar a interação.");}
    finally{locked.current=false;setSaving(false);}
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-xl border border-line bg-soft/40 p-4"
      aria-label={editing ? "Editar interação" : "Registrar interação"}
    >
      <fieldset disabled={saving||pending} className="min-w-0">
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            disabled={editing}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 ring-line disabled:opacity-60",
              kind === k ? "bg-ink font-medium text-on-ink ring-ink" : "bg-surface hover:bg-soft",
            )}
          >
            {ICON[k]}
            {interactionLabel[k]}
          </button>
        ))}
        {onMeeting && !editing && (
          <button
            type="button"
            onClick={onMeeting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-[12.5px] ring-1 ring-line hover:bg-soft"
            title="Reunião com tipo, modalidade, local ou link e participantes"
          >
            {ICON.reuniao}
            Reunião
          </button>
        )}
      </div>
      <InteractionTagPicker value={tags} onChange={setTags} />
      <TextField
        label="Título"
        hideLabel
        value={title}
        onChange={setTitle}
        placeholder="Título · ex.: Ricardo aprovou o piloto por telefone"
        autoFocus
        className="mt-3 mb-0!"
      />
      <TextareaField
        label="Texto"
        hideLabel
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        minRows={3}
        placeholder="O que aconteceu, o que foi combinado, o que fica pendente."
        className="mt-2 mb-0!"
      />
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] ring-1 ring-line"
            >
              <Paperclip className="h-3 w-3 text-muted" />
              {f.name}
              <button
                type="button"
                aria-label={`Remover ${f.name}`}
                onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                className="text-muted hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2 text-[12px] text-muted">
          Quando
          <DateTimePicker label="Quando" value={when} onValueChange={(next) => setWhen(next)} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] text-ink" required />
        </label>
        {!editing && (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const selected=Array.from(e.target.files??[]);
                setFiles((list) => [...list, ...selected]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-muted hover:bg-surface hover:text-ink"
            >
              <Paperclip className="h-3.5 w-3.5" />
              Imagem ou arquivo
            </button>
          </>
        )}
      </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <span className="inline-flex flex-wrap items-center gap-2">
          {error && (
            <span role="alert" className="text-[12px] text-rose">
              {error}
            </span>
          )}
          {pending&&error&&!saving&&<Button variant="ghost" size="sm" type="button" onClick={()=>{onReset();pendingInput.current=null;baseline.current=interactionOperationBaseline();setPending(false);setError("");}}>Revisar interação</Button>}
          <Button variant="ghost" size="sm" type="button" disabled={saving} onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" type="submit" disabled={!canSave}>
            {saving ? "Guardando…" : pending ? "Verificar gravação" : editing ? "Salvar" : "Registrar"}
          </Button>
        </span>
      </div>
      {editing && (
        <p className="mt-2 text-[11.5px] text-muted">
          Título, texto, data e tags podem mudar; cada mudança fica no histórico da interação.
          Anexos e tipo não mudam aqui.
        </p>
      )}
    </form>
  );
}

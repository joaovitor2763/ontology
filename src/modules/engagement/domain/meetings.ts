import type { Delivery } from "../../delivery/domain/models.ts";
import type {
  ActionItem,
  Meeting,
  MeetingPrep,
  Receptiveness,
} from "./models.ts";

/** Seeded actions have no id; a stable one is derived from their position. */
export function withActionIds(meeting: Meeting): Meeting {
  return {
    ...meeting,
    actions: meeting.actions.map((action, index) => ({
      ...action,
      id: action.id ?? `${meeting.id}-a${index + 1}`,
    })),
  };
}

export function toggleAction(meeting: Meeting, actionId: string): Meeting {
  return {
    ...meeting,
    actions: meeting.actions.map((action) =>
      action.id === actionId ? { ...action, done: !action.done } : action,
    ),
  };
}

export function upsertAction(meeting: Meeting, action: ActionItem): Meeting {
  const exists = meeting.actions.some((a) => a.id === action.id);
  return {
    ...meeting,
    actions: exists
      ? meeting.actions.map((a) => (a.id === action.id ? action : a))
      : [...meeting.actions, action],
  };
}

export function removeAction(meeting: Meeting, actionId: string): Meeting {
  return {
    ...meeting,
    actions: meeting.actions.filter((a) => a.id !== actionId),
  };
}

export function setDecisions(meeting: Meeting, decisions: string[]): Meeting {
  return {
    ...meeting,
    decisions: decisions.map((d) => d.trim()).filter(Boolean),
  };
}

/** A delivery born from a meeting action keeps the origin in its description. */
export function deliveryFromAction(
  meeting: Meeting,
  action: ActionItem,
  deliveryId: string,
): Delivery {
  return {
    id: deliveryId,
    company: meeting.company,
    title: action.text.trim(),
    description: `Origem: reunião ${meeting.title}`,
    status: action.done ? "entregue" : "fila",
    ownerId: action.ownerId,
    dueAt: action.dueAt,
    hours: 2,
    workstream: "Reunião",
    milestone: 0,
    completion: "checklist",
    kind: "journey",
  };
}

export function linkAction(
  meeting: Meeting,
  actionId: string,
  deliveryId: string,
): Meeting {
  return {
    ...meeting,
    actions: meeting.actions.map((a) =>
      a.id === actionId ? { ...a, deliveryId } : a,
    ),
  };
}

const validDate = (value: string) =>
  Boolean(value) && Number.isFinite(Date.parse(value));

export function meetingError(meeting: Meeting): string | null {
  if (!meeting.title.trim()) return "Dê um título à reunião.";
  if (!meeting.company) return "Escolha o cliente.";
  if (!validDate(meeting.startsAt)) return "Informe uma data válida.";
  if (!Number.isFinite(meeting.durationMin) || meeting.durationMin <= 0)
    return "A duração precisa ser maior que zero.";
  if (meeting.actions.some((a) => !a.text.trim()))
    return "Toda ação combinada precisa de um texto.";
  if (meeting.actions.some((a) => a.dueAt && !validDate(a.dueAt)))
    return "Revise os prazos das ações combinadas.";
  const badGuest = (meeting.guests ?? []).find((email) => !validEmail(email));
  if (badGuest) return `Convidado externo com e-mail inválido: ${badGuest}.`;
  return null;
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** "a@x.com, b@y.com" or one per line → clean, unique, lower-case list. */
export function parseGuests(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,;]+/)
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export const meetingFormatLabel: Record<
  NonNullable<MeetingPrep["format"]>,
  string
> = {
  deck: "Apresentação em pé, com deck",
  conversa: "Conversa sentada, em diálogo",
  "pre-leitura": "Só pré-leitura, sem reunião formal",
};

export const receptivenessLabel: Record<Receptiveness, string> = {
  aliado: "Aliado",
  neutro: "Neutro",
  cetico: "Cético",
};

export type PrepItem = { id: string; label: string; done: boolean };

const lines = (text?: string) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * What must be ready before the meeting, by kind. Interviews follow "doing your
 * homework"; presentations follow PIP, the choice of method and rehearsal.
 * Other kinds have no checklist.
 */
export function meetingPrepChecklist(meeting: Meeting): PrepItem[] {
  const prep = meeting.prep ?? {};
  if (meeting.kind === "entrevista")
    return [
      {
        id: "homework",
        label: "Papel e contexto pesquisados",
        done: Boolean(prep.homeworkDone),
      },
      {
        id: "hypotheses",
        label: "Hipóteses a testar definidas",
        done: (prep.hypothesisIds?.length ?? 0) > 0,
      },
      {
        id: "questions",
        label: "5–7 perguntas planejadas",
        done: lines(prep.questions).length >= 3,
      },
    ];
  if (meeting.kind === "apresentacao")
    return [
      {
        id: "pip",
        label: "Objetivo, importância e prévia (PIP) definidos",
        done: Boolean(
          prep.purpose?.trim() && prep.importance?.trim() && prep.preview?.trim(),
        ),
      },
      { id: "format", label: "Formato escolhido", done: Boolean(prep.format) },
      {
        id: "preread",
        label: "Pré-leitura de 1 página enviada",
        done: Boolean(prep.preReadSent),
      },
      { id: "rehearsal", label: "Ensaio feito", done: Boolean(prep.rehearsed) },
      {
        id: "speakers",
        label: "Quem fala o quê combinado",
        done: Boolean(prep.speakers?.trim()),
      },
    ];
  return [];
}

export function meetingPrepReady(meeting: Meeting) {
  const items = meetingPrepChecklist(meeting);
  return items.length > 0 && items.every((item) => item.done);
}

export type InterviewSummaryField = "learnings" | "implications" | "receptiveness";

export const interviewSummaryLabel: Record<InterviewSummaryField, string> = {
  learnings: "Aprendizados-chave",
  implications: "Implicações",
  receptiveness: "Receptividade",
};

/** Parts of the interview summary still empty; only past interviews count. */
export function interviewSummaryMissing(
  meeting: Meeting,
  now?: string,
): InterviewSummaryField[] {
  if (meeting.kind !== "entrevista") return [];
  if (now && meeting.startsAt > now) return [];
  const missing: InterviewSummaryField[] = [];
  if (!meeting.learnings?.trim()) missing.push("learnings");
  if (!meeting.implications?.trim()) missing.push("implications");
  if (!meeting.receptiveness) missing.push("receptiveness");
  return missing;
}

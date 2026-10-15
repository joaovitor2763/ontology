import type { InteractionTag } from "./interaction-tags";
export type Channel =
  "linkedin" | "whatsapp" | "email" | "slack" | "call" | "note";

export type MeetingKind =
  | "kickoff"
  | "workshop"
  | "steering"
  | "demo"
  | "alinhamento"
  | "suporte"
  | "retro"
  | "entrevista"
  | "apresentacao";

/**
 * Preparation of a meeting (MCAS: "doing your homework" for interviews and
 * PIP + rehearsal for presentations). Every field is optional; the checklist
 * in `meetings.ts` reads what applies to the meeting kind.
 */
export type MeetingPrep = {
  /** Interview: role and context researched before the conversation. */
  homeworkDone?: boolean;
  /** Interview: hypotheses this conversation is meant to test. */
  hypothesisIds?: string[];
  /** Interview: the 5–7 core questions, one per line. */
  questions?: string;
  /** Presentation: PIP opening. */
  purpose?: string;
  importance?: string;
  preview?: string;
  /** Presentation: how it will be delivered. */
  format?: "deck" | "conversa" | "pre-leitura";
  preReadSent?: boolean;
  rehearsed?: boolean;
  /** Presentation: who says what (and who does not). */
  speakers?: string;
};

export type Receptiveness = "aliado" | "neutro" | "cetico";

/** Evidence a meeting brought to a hypothesis. */
export type MeetingHypothesisEvidence = {
  hypothesisId: string;
  kind: HypothesisEvidenceKind;
  note: string;
};

/** Something agreed in a meeting. It can be turned into a delivery of the client. */
export type ActionItem = {
  /** Removed actions remain as the source of any converted task. */
  removedAt?: string;
  removedBy?: string;
  id?: string;
  text: string;
  ownerId: string;
  dueAt: string;
  done?: boolean;
  /** Delivery created from this action, when converted. */
  deliveryId?: string;
};

/** A decision with owner and next step; `decisions: string[]` stays as the plain summary list. */
export type Decision = {
  id: string;
  summary: string;
  nextStep?: string;
  ownerId?: string;
  dueAt?: string;
  status: "registrada" | "em-andamento" | "cumprida" | "revertida";
};

export type MeetingModality = "presencial" | "online";

export type InviteResponse = "accepted" | "declined" | "tentative" | "needsAction";
export const inviteResponseLabel: Record<InviteResponse, string> = {
  accepted: "Aceitou",
  declined: "Recusou",
  tentative: "Talvez",
  needsAction: "Sem resposta",
};

export type MeetingGoogle = {
  /** Calendar revision used to detect changes made directly in Google. */
  etag?: string;
  calendarId?: string;
  eventId?: string;
  htmlLink?: string;
  meetLink?: string;
  /** E-mail of the connected account that created the event; only it can read the artifacts. */
  organizer?: string;
  autoRecording?: boolean;
  recordingWarning?: string;
  /** Invitation answers by e-mail, as read from the calendar event. */
  responses?: Record<string, InviteResponse>;
  responsesAt?: string;
  cancelled?: boolean;
  recordingUrl?: string;
  transcriptUrl?: string;
  transcriptDocId?: string;
  artifactStatus?: "pending" | "ready" | "not_generated";
  lastArtifactCheckAt?: string;
  syncedAt?: string;
};
export const meetingModalityLabel: Record<MeetingModality, string> = {
  presencial: "Presencial",
  online: "Online",
};

export type Meeting = {
  removedAt?: string;
  removedBy?: string;
  restoredAt?: string;
  restoredBy?: string;
  enrollmentIds?: string[];
  schedulingStatus?: "pending" | "uncertain" | "complete";
  operationId?: string;
  cancelledAt?: string;
  id: string;
  company: string;
  title: string;
  kind: MeetingKind;
  modality?: MeetingModality;
  /** Address or call link. */
  place?: string;
  startsAt: string;
  durationMin: number;
  attendeeIds: string[];
  /** External guests, by e-mail (people outside the team and the stakeholders list). */
  guests?: string[];
  /** Optional links: the cycle and the delivery this meeting serves. Always a client. */
  cycleId?: string;
  deliveryId?: string;
  /** Google Calendar / Meet artifacts, filled by the integration when it is on. */
  google?: MeetingGoogle;
  summary: string;
  notes: string;
  decisions: string[];
  /** Structured decisions captured by the meeting wizard; mirrors `decisions` texts. */
  decisionItems?: Decision[];
  actions: ActionItem[];
  /** Pains and solutions captured in this meeting (ids in the diagnosis repository). */
  painIds?: string[];
  solutionIds?: string[];
  relatedNodeIds?: string[];
  /** Hypotheses tested in this meeting (interview summary: "how this relates to your hypotheses"). */
  hypothesisEvidence?: MeetingHypothesisEvidence[];
  prep?: MeetingPrep;
  /** Interview summary: 3–5 takeaways, what they mean, and how the person received us. */
  learnings?: string;
  implications?: string;
  receptiveness?: Receptiveness;
  /** Presentation close: agreement and commitment obtained from the client. */
  commitmentObtained?: boolean;
  tags?: InteractionTag[];
  organizerEmail?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type HypothesisStatus =
  | "aberta"
  | "em-teste"
  | "confirmada"
  | "refutada"
  | "refinada";

export type HypothesisEvidenceKind = "confirma" | "contradiz" | "refina";

export type HypothesisEvidence = {
  id: string;
  at: string;
  kind: HypothesisEvidenceKind;
  note: string;
  meetingId?: string;
  /** Where the evidence came from; interviews and data are both needed (MCAS). */
  source?: "entrevista" | "dados" | "observacao";
  by?: string;
};

/**
 * A presumed root cause the team is trying to prove or disprove. Being refuted
 * is progress, not failure: a refined hypothesis keeps `parentId`.
 */
export type Hypothesis = {
  id: string;
  company: string;
  statement: string;
  /** Root cause presumed behind the statement, when different from it. */
  rootCause?: string;
  status: HypothesisStatus;
  painIds: string[];
  parentId?: string;
  ownerId?: string;
  evidence: HypothesisEvidence[];
  createdAt: string;
  updatedAt?: string;
};

export type TradeoffLevel = "baixo" | "medio" | "alto";

/** The three variables every option prioritises differently (MCAS: time, capital, talent). */
export type OptionTradeoffs = {
  time?: TradeoffLevel;
  capital?: TradeoffLevel;
  talent?: TradeoffLevel;
};

export type PainSeverity = "baixa" | "media" | "alta" | "critica";
export type PainStatus = "aberta" | "validada" | "em-tratamento" | "resolvida";

/** A problem the client lives with, captured in a meeting and tracked until resolved. */
export type Pain = {
  id: string;
  company: string;
  meetingId?: string;
  title: string;
  description: string;
  area?: string;
  severity: PainSeverity;
  frequency?: "pontual" | "semanal" | "diaria" | "continua";
  impact?: string;
  /** 0–100: how sure the team is that the pain is real and well described. */
  confidence?: number;
  status: PainStatus;
  evidence?: string;
  createdAt: string;
  updatedAt?: string;
};

export type SolutionStatus =
  | "proposta"
  | "aprovada"
  | "em-execucao"
  | "concluida"
  | "descartada";

/** A hypothesis that addresses one or more pains. */
export type Solution = {
  id: string;
  company: string;
  meetingId?: string;
  title: string;
  description: string;
  painIds: string[];
  /** "Se fizermos X, esperamos Y porque Z". */
  hypothesis: string;
  ownerId?: string;
  effort?: "baixo" | "medio" | "alto";
  expectedImpact?: string;
  successMetric?: string;
  status: SolutionStatus;
  /** Options-led: what this alternative costs in time, capital and talent. */
  tradeoffs?: OptionTradeoffs;
  /** The option the client chose among the alternatives for the same pains, and why. */
  chosen?: boolean;
  chosenReason?: string;
  createdAt: string;
  updatedAt?: string;
};

export type SignalCategory =
  | "pergunta"
  | "risco"
  | "compromisso"
  | "acao"
  | "informacao_faltante"
  | "plataforma";
export type SignalPriority = "baixa" | "media" | "alta";

/**
 * A message of a conversation that may need follow-up. Produced by rules today;
 * `source: "ia"`, `confidence` and `reason` are the slots an AI classifier fills later.
 */
export type Signal = {
  id: string;
  company: string;
  threadId: string;
  messageId: string;
  at: string;
  text: string;
  author: string;
  authorRole: "cliente" | "equipe";
  categories: SignalCategory[];
  priority: SignalPriority;
  title: string;
  source: "regra" | "ia";
  confidence?: number;
  reason?: string;
  answeredLater?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  deliveryId?: string;
};

export type CommunicationChannel = "whatsapp" | "email";

export type CommunicationVariation = {
  id: string;
  approach: string;
  headline?: string;
  subject?: string;
  preview?: string;
  body: string;
  cta: string;
  /** 0–100 editorial score; breakdown explains it. */
  score: number;
  reasoning: string;
  scoreBreakdown: {
    canal: number;
    clarezaCta: number;
    engajamento: number;
    gancho: number;
  };
};

/** Reusable message for a moment of the engagement, with scored variations. */
export type CommunicationTemplate = {
  id: string;
  name: string;
  channel: CommunicationChannel;
  milestone?: number;
  objective: string;
  variables: string[];
  variations: CommunicationVariation[];
  defaultVariationId: string;
  /** Paired template on the other channel, when both exist. */
  pairedTemplateId?: string;
};

export type ThreadKind = "group" | "direct" | "call" | "notes";

/** A file attached to a note, stored as a document of the client. */
export type ThreadFile = { id: string; name: string; mime: string };

/** One change to a note, kept forever: who, when, which field, from and to. */
export type NoteEdit = {
  at: string;
  by: string;
  field: "at" | "text" | "title" | "tags";
  from: string;
  to: string;
};

/** What kind of interaction a note records. Meetings come from the agenda. */
export type InteractionKind = "nota" | "ligacao" | "email" | "conversa";
export const interactionLabel: Record<InteractionKind, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  email: "E-mail",
  conversa: "Conversa",
};

export type ThreadMessage = {
  /** Notes written in the app carry an id so they can be edited. */
  id?: string;
  /** When it happened; editable on notes, with the change logged in `history`. */
  at: string;
  from: string;
  /** Short title of the interaction; the text is the body. */
  title?: string;
  text: string;
  interaction?: InteractionKind;
  tags?: InteractionTag[];
  /** When the note was written in the app; never changes. */
  createdAt?: string;
  history?: NoteEdit[];
  /** Legacy: attachment names only, without stored content. */
  attachments?: string[];
  files?: ThreadFile[];
  source?: "bot" | "human";
  kind?: "message" | "note" | "call";
};

export type Thread = {
  id: string;
  company: string;
  channel: Channel;
  title: string;
  counterpart: string;
  lastAt: string;
  unread: number;
  preview: string;
  kind?: ThreadKind;
  bot?: boolean;
  participants?: string[];
  durationMin?: number;
  messages: ThreadMessage[];
};

export type ProgramEvent = {
  id: string;
  company: string;
  title: string;
  kind: string;
  startsAt: string;
  place: string;
  detail: string;
  createdAt?: string;
  updatedAt?: string;
};

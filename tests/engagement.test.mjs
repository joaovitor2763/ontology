import test from "node:test";
import assert from "node:assert/strict";
import {
  deliveryFromAction,
  linkAction,
  meetingError,
  parseGuests,
  removeAction,
  setDecisions,
  toggleAction,
  upsertAction,
  withActionIds,
} from "../src/modules/engagement/domain/meetings.ts";
import { editNote } from "../src/modules/engagement/domain/notes.ts";
import {
  mapWhatsAppRow,
  sortWhatsAppMessages,
} from "../src/modules/engagement/application/whatsapp.ts";
import {
  artifactFromItem,
  eventAttendees,
  googleMeetCode,
  pickConferenceRecord,
  transcriptText,
} from "../src/modules/engagement/application/google-meet.ts";

const meeting = {
  id: "m-1",
  company: "acme",
  title: "Kickoff",
  kind: "kickoff",
  startsAt: "2026-09-10T10:00:00",
  durationMin: 60,
  attendeeIds: ["marina"],
  summary: "",
  notes: "",
  decisions: ["Piloto na UTI"],
  actions: [
    { text: "Enviar ata", ownerId: "marina", dueAt: "2026-09-12" },
    { text: "Agendar demo", ownerId: "omar", dueAt: "2026-09-15", done: true },
  ],
};

test("seeded actions receive stable ids and can be toggled, edited and removed", () => {
  const m = withActionIds(meeting);
  assert.deepEqual(
    m.actions.map((a) => a.id),
    ["m-1-a1", "m-1-a2"],
  );
  assert.equal(toggleAction(m, "m-1-a1").actions[0].done, true);
  const edited = upsertAction(m, { ...m.actions[1], text: "Agendar demo com TI" });
  assert.equal(edited.actions.length, 2);
  assert.equal(edited.actions[1].text, "Agendar demo com TI");
  const added = upsertAction(m, {
    id: "m-1-a3",
    text: "Nova",
    ownerId: "marina",
    dueAt: "2026-09-20",
  });
  assert.equal(added.actions.length, 3);
  assert.equal(removeAction(added, "m-1-a3").actions.length, 2);
  assert.deepEqual(setDecisions(m, [" A ", "", "B"]).decisions, ["A", "B"]);
});

test("an action becomes a delivery of the client and keeps the link back", () => {
  const m = withActionIds(meeting);
  const delivery = deliveryFromAction(m, m.actions[0], "d-x");
  assert.equal(delivery.company, "acme");
  assert.equal(delivery.title, "Enviar ata");
  assert.equal(delivery.status, "fila");
  assert.equal(delivery.dueAt, "2026-09-12");
  assert.match(delivery.description, /Kickoff/);
  const done = deliveryFromAction(m, m.actions[1], "d-y");
  assert.equal(done.status, "entregue");
  assert.equal(linkAction(m, "m-1-a1", "d-x").actions[0].deliveryId, "d-x");
});

test("meeting validation explains the problem", () => {
  assert.equal(meetingError({ ...meeting, title: " " }), "Dê um título à reunião.");
  assert.equal(meetingError({ ...meeting, startsAt: "x" }), "Informe uma data válida.");
  assert.equal(meetingError({ ...meeting, durationMin: 0 }), "A duração precisa ser maior que zero.");
  assert.equal(
    meetingError({ ...meeting, actions: [{ text: "", ownerId: "m", dueAt: "" }] }),
    "Toda ação combinada precisa de um texto.",
  );
  assert.equal(meetingError(meeting), null);
});

import {
  extractSignals,
  groupHealth,
  nextBestAction,
  signalId,
} from "../src/modules/engagement/domain/signals.ts";
import {
  captureError,
  solutionError,
  withDecisionItems,
} from "../src/modules/engagement/domain/diagnosis.ts";
import {
  interpolate,
  missingVariables,
} from "../src/modules/engagement/domain/communication.ts";

const isTeam = (name) => name.startsWith("Marina") || name.startsWith("Thiago");
const thread = {
  id: "t-1",
  company: "acme",
  channel: "whatsapp",
  title: "Grupo",
  counterpart: "Paulo",
  lastAt: "2026-09-12T10:00:00",
  unread: 0,
  preview: "",
  messages: [
    { at: "2026-09-10T09:00:00", from: "Paulo Braga", text: "Qual o prazo do relatório?" },
    { at: "2026-09-10T09:30:00", from: "Marina Alves", text: "Sai sexta, combinado." },
    { at: "2026-09-11T08:00:00", from: "Paulo Braga", text: "Estamos travados sem acesso ao TMS, isso é urgente." },
    { at: "2026-09-12T10:00:00", from: "Paulo Braga", text: "Mando o contrato até dia 15." },
    { at: "2026-09-12T10:05:00", from: "Thiago Nunes", kind: "note", text: "nota interna: lembrar do TMS?" },
  ],
};

test("rules extract signals from client messages, mark answered questions and rank risks first", () => {
  const signals = extractSignals(thread, { isTeam, now: "2026-09-12T12:00:00" });
  assert.equal(signals.some((s) => s.text.includes("nota interna")), false, "notes are ignored");
  const question = signals.find((s) => s.text.startsWith("Qual"));
  assert.ok(question.categories.includes("pergunta"));
  assert.equal(question.answeredLater, true);
  const risk = signals.find((s) => s.text.includes("travados"));
  assert.ok(risk.categories.includes("risco"));
  assert.equal(risk.priority, "alta");
  assert.equal(risk.source, "regra");
  assert.match(risk.reason, /risco/);
  const commitment = signals.find((s) => s.text.startsWith("Mando"));
  assert.ok(commitment.categories.includes("compromisso"));
  assert.equal(signals[0].id, risk.id, "highest priority first");
  assert.equal(signalId(thread.id, thread.messages[0]), signalId(thread.id, thread.messages[0]));
});

test("group health penalizes open risks and inactivity and suggests the next best action", () => {
  const signals = extractSignals(thread, { isTeam, now: "2026-09-12T12:00:00" });
  const health = groupHealth(thread, signals, "2026-09-12T12:00:00");
  assert.equal(health.level, "attention");
  assert.equal(health.score, 70);
  assert.match(health.recommendation, /risco/);
  const next = nextBestAction(signals);
  assert.ok(next.categories.includes("risco"));
  const resolved = signals.map((s) => (s.id === next.id ? { ...s, resolvedAt: "2026-09-12" } : s));
  assert.ok(nextBestAction(resolved).categories.includes("compromisso"));
  const quiet = groupHealth({ ...thread, messages: [] }, [], "2026-09-30T12:00:00");
  assert.equal(quiet.level, "critical");
});

test("a solution must point to an existing pain and the capture needs pains or the explicit checkbox", () => {
  const pain = { id: "p1", company: "acme", title: "Dor", description: "", severity: "alta", status: "aberta", createdAt: "2026-09-12" };
  const solution = { id: "s1", company: "acme", title: "Sol", description: "", painIds: [], hypothesis: "", status: "proposta", createdAt: "2026-09-12" };
  assert.equal(solutionError(solution, [pain]), "Vincule a solução a pelo menos uma dor.");
  assert.equal(solutionError({ ...solution, painIds: ["p1"] }, [pain]), "Escreva a hipótese: se fizermos X, esperamos Y porque Z.");
  assert.equal(solutionError({ ...solution, painIds: ["p1"], hypothesis: "Se X, Y porque Z" }, [pain]), null);
  const base = { meeting: { ...meeting }, pains: [], solutions: [], decisions: [], noNewPains: false };
  assert.match(captureError(base), /nenhuma nova dor/);
  assert.equal(captureError({ ...base, noNewPains: true }), null);
  const m = withDecisionItems(meeting, [{ id: "d1", summary: " Piloto na UTI ", status: "registrada" }]);
  assert.deepEqual(m.decisions, ["Piloto na UTI"]);
});

test("templates interpolate known variables and report the missing ones", () => {
  const body = "Olá {{contato}}, projeto com {{cliente}}: {{link}}";
  assert.equal(
    interpolate(body, { contato: "Paulo", cliente: "LogiSul" }),
    "Olá Paulo, projeto com LogiSul: {{link}}",
  );
  assert.deepEqual(missingVariables(body, { contato: "Paulo" }), ["cliente", "link"]);
});

test("editing a note's date or text keeps when it was written and logs every change", () => {
  const note = {
    id: "n-1",
    at: "2026-09-15T12:00:00.000Z",
    createdAt: "2026-09-15T12:00:00.000Z",
    from: "Marina Alves",
    text: "Ricardo aprovou o piloto.",
    kind: "note",
  };
  const same = editNote(note, { at: note.at, text: note.text }, "Thiago", "2026-09-16T09:00:00.000Z");
  assert.equal(same, note);
  const moved = editNote(note, { at: "2026-09-12T15:30:00.000Z" }, "Thiago", "2026-09-16T09:00:00.000Z");
  assert.equal(moved.at, "2026-09-12T15:30:00.000Z");
  assert.equal(moved.createdAt, "2026-09-15T12:00:00.000Z");
  assert.deepEqual(moved.history, [
    { at: "2026-09-16T09:00:00.000Z", by: "Thiago", field: "at", from: note.at, to: "2026-09-12T15:30:00.000Z" },
  ]);
  const rewritten = editNote(moved, { text: "Ricardo aprovou o piloto na UTI." }, "Marina", "2026-09-17T10:00:00.000Z");
  assert.equal(rewritten.history.length, 2);
  assert.equal(rewritten.history[1].field, "text");
  const titled = editNote(rewritten, { title: "Aprovação do piloto" }, "Marina", "2026-09-17T10:05:00.000Z");
  assert.equal(titled.title, "Aprovação do piloto");
  assert.deepEqual(titled.history.at(-1), { at: "2026-09-17T10:05:00.000Z", by: "Marina", field: "title", from: "", to: "Aprovação do piloto" });
  assert.equal(editNote(titled, { title: "" }, "Marina", "2026-09-17T10:06:00.000Z").title, undefined, "an emptied title is removed and logged");
  assert.equal(rewritten.history[1].from, note.text);
  assert.equal(moved.history.length, 1, "earlier records are not mutated");
  const legacy = editNote({ at: "2026-09-10T10:00:00.000Z", from: "Omar", text: "x" }, { at: "2026-09-09T10:00:00.000Z" }, "Omar", "2026-09-17T10:00:00.000Z");
  assert.equal(legacy.createdAt, "2026-09-10T10:00:00.000Z", "a note without createdAt keeps its original date as the record date");
});

test("rows of the WhatsApp base map by configured columns and skip rows without id or date", () => {
  const row = { id: 7, created_at: "2026-09-10T18:10:00Z", sender_name: "Luiza", body: "Ricardo leu o plano.", from_me: false, group_id: "g1" };
  assert.deepEqual(mapWhatsAppRow(row), {
    id: "7", at: "2026-09-10T18:10:00.000Z", from: "Luiza", text: "Ricardo leu o plano.", fromMe: false, group: "g1",
  });
  const custom = mapWhatsAppRow(
    { msg_id: "a", ts: "2026-09-11T07:55:00Z", author: "", content: null, chat: "g1", mine: 1 },
    { id: "msg_id", at: "ts", from: "author", text: "content", group: "chat", fromMe: "mine" },
  );
  assert.equal(custom.from, "Desconhecido");
  assert.equal(custom.text, "");
  assert.equal(custom.fromMe, true);
  assert.equal(mapWhatsAppRow({ created_at: "2026-09-10T18:10:00Z" }), null);
  assert.equal(mapWhatsAppRow({ id: 1, created_at: "not a date" }), null);
  const sorted = sortWhatsAppMessages([
    mapWhatsAppRow({ id: 2, created_at: "2026-09-11T07:55:00Z" }),
    mapWhatsAppRow({ id: 1, created_at: "2026-09-10T18:10:00Z" }),
  ]);
  assert.deepEqual(sorted.map((m) => m.id), ["1", "2"]);
});

test("external guests are parsed from free text and validated as e-mails", () => {
  assert.deepEqual(parseGuests("Ana@Cliente.com, bia@cliente.com\n ana@cliente.com ;"), ["ana@cliente.com", "bia@cliente.com"]);
  const base = { id: "m1", company: "santa-clara", title: "Kickoff", kind: "kickoff", startsAt: "2026-09-20T10:00:00", durationMin: 60, attendeeIds: [], summary: "", notes: "", decisions: [], actions: [] };
  assert.equal(meetingError({ ...base, guests: ["ana@cliente.com"] }), null);
  assert.match(meetingError({ ...base, guests: ["ana@"] }), /e-mail inválido/);
});

test("Google Meet helpers read the meeting code, keep only Google export links and pick the closest record", () => {
  assert.equal(googleMeetCode("https://meet.google.com/abc-defg-hij?authuser=0"), "abc-defg-hij");
  assert.equal(googleMeetCode("https://zoom.us/j/123"), null);
  assert.deepEqual(
    artifactFromItem({ name: "conferenceRecords/1/recordings/2", state: "file_generated", driveDestination: { exportUri: "https://drive.google.com/file/d/x/view" } }, "driveDestination"),
    { name: "conferenceRecords/1/recordings/2", state: "FILE_GENERATED", url: "https://drive.google.com/file/d/x/view" },
  );
  assert.equal(artifactFromItem({ name: "t", docsDestination: { exportUri: "https://evil.example/doc" } }, "docsDestination").url, "");
  assert.equal(artifactFromItem({}, "docsDestination"), null);
  const picked = pickConferenceRecord(
    [{ name: "a", startTime: "2026-09-15T08:00:00Z" }, { name: "b", startTime: "2026-09-15T10:05:00Z" }],
    "2026-09-15T10:00:00Z",
  );
  assert.equal(picked.name, "b");
  assert.equal(
    transcriptText([{ participant: "conferenceRecords/1/participants/9", text: "Olá", startTime: "2026-09-15T10:00:01Z" }, { text: "   " }]),
    "[2026-09-15T10:00:01Z] Participante 1 (nome indisponível): Olá",
  );
  assert.deepEqual(eventAttendees(["Ana@x.com", "ana@x.com", undefined, "org@x.com", "semarroba"], "ORG@x.com"), ["ana@x.com"]);
});

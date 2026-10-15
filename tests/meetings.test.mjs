import test from "node:test";
import assert from "node:assert/strict";
import {
  interviewSummaryMissing,
  meetingPrepChecklist,
  meetingPrepReady,
} from "../src/modules/engagement/domain/meetings.ts";

const base = {
  id: "m1",
  company: "acme",
  title: "Entrevista",
  startsAt: "2026-09-20T10:00:00.000Z",
  durationMin: 60,
  attendeeIds: [],
  summary: "",
  notes: "",
  decisions: [],
  actions: [],
};

test("interview preparation checks homework, hypotheses and planned questions", () => {
  const empty = { ...base, kind: "entrevista" };
  assert.deepEqual(
    meetingPrepChecklist(empty).map((i) => i.done),
    [false, false, false],
  );
  assert.equal(meetingPrepReady(empty), false);
  const ready = {
    ...empty,
    prep: {
      homeworkDone: true,
      hypothesisIds: ["h1"],
      questions: "Como funciona hoje?\n\nO que trava?\nQuem decide?",
    },
  };
  assert.equal(meetingPrepReady(ready), true);
  assert.equal(
    meetingPrepReady({ ...ready, prep: { ...ready.prep, questions: "uma\nduas" } }),
    false,
  );
});

test("presentation preparation follows PIP, format, pre-read, rehearsal and speakers", () => {
  const m = { ...base, kind: "apresentacao", prep: { purpose: "x", importance: "y" } };
  const items = meetingPrepChecklist(m);
  assert.equal(items.length, 5);
  assert.equal(items.find((i) => i.id === "pip").done, false);
  const full = {
    ...m,
    prep: {
      purpose: "x",
      importance: "y",
      preview: "z",
      format: "conversa",
      preReadSent: true,
      rehearsed: true,
      speakers: "Marina abre, Thiago fecha",
    },
  };
  assert.equal(meetingPrepReady(full), true);
  assert.deepEqual(meetingPrepChecklist({ ...base, kind: "steering" }), []);
  assert.equal(meetingPrepReady({ ...base, kind: "steering" }), false);
});

test("interview summary reports what is still missing, only for past interviews", () => {
  const past = { ...base, kind: "entrevista" };
  assert.deepEqual(interviewSummaryMissing(past, "2026-09-21T00:00:00.000Z"), [
    "learnings",
    "implications",
    "receptiveness",
  ]);
  assert.deepEqual(interviewSummaryMissing(past, "2026-09-01T00:00:00.000Z"), []);
  assert.deepEqual(
    interviewSummaryMissing(
      { ...past, learnings: "a", implications: "b", receptiveness: "aliado" },
      "2026-09-21T00:00:00.000Z",
    ),
    [],
  );
  assert.deepEqual(interviewSummaryMissing({ ...base, kind: "demo" }), []);
});

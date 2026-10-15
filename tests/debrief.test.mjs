import test from "node:test";
import assert from "node:assert/strict";
import { debriefError } from "../src/modules/delivery/domain/services.ts";

test("a client debrief needs a whole score from 1 to 5 and a bounded comment", () => {
  assert.equal(debriefError({ score: 0, comment: "" }), "Escolha uma nota de 1 a 5.");
  assert.equal(debriefError({ score: 3.5, comment: "" }), "Escolha uma nota de 1 a 5.");
  assert.equal(debriefError({ score: 6, comment: "" }), "Escolha uma nota de 1 a 5.");
  assert.match(debriefError({ score: 4, comment: "x".repeat(601) }) ?? "", /600/);
  assert.equal(debriefError({ score: 5, comment: "Gostaram do ritmo." }), null);
});

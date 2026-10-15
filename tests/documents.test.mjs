import test from "node:test";
import assert from "node:assert/strict";
import {
  deliverableTemplateById,
  deliverableTemplates,
  renderDeliverableTemplate,
} from "../src/modules/documents/infrastructure/deliverable-templates.ts";
import { reviewPatch } from "../src/modules/documents/domain/models.ts";

test("the ten deliverable templates load with a body, formats and a review checklist", () => {
  assert.equal(deliverableTemplates.length, 10);
  for (const t of deliverableTemplates) {
    assert.ok(t.body.startsWith("# "), t.id);
    assert.ok(t.reviewChecklist.length >= 3, t.id);
    assert.ok(t.acceptedMimeTypes.length > 0, t.id);
    assert.doesNotMatch(t.body, /AI Master|G4/, t.id);
  }
  assert.equal(new Set(deliverableTemplates.map((t) => t.id)).size, 10);
});

test("rendering fills placeholders and leaves unknown ones blank", () => {
  const r = renderDeliverableTemplate("roadmap_ai", { empresa: "Clínica Aurora" });
  assert.ok(r.body.startsWith("# Roadmap de IA — Clínica Aurora"));
  assert.doesNotMatch(r.body, /\{\{/);
  assert.equal(renderDeliverableTemplate("nope"), null);
  assert.equal(deliverableTemplateById("project_charter").name, "Charter do projeto");
});

test("review keeps a trail and requires a note when asking for changes", () => {
  const bad = reviewPatch({}, "ajustes", "  ", "marina", "2026-09-14T10:00:00");
  assert.ok("error" in bad);
  const ok = reviewPatch({}, "aprovado", "", "marina", "2026-09-14T10:00:00");
  assert.equal(ok.reviewStatus, "aprovado");
  assert.equal(ok.reviewHistory.length, 1);
  const again = reviewPatch(ok, "ajustes", "Falta a linha de base", "omar", "2026-09-15T10:00:00");
  assert.equal(again.reviewHistory.length, 2);
  assert.equal(again.reviewNotes, "Falta a linha de base");
});

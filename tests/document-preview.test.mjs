import test from "node:test";
import assert from "node:assert/strict";
import { documentPreviewKind, previewLimit, PREVIEW_TEXT_CHARS } from "../src/modules/documents/domain/preview.ts";

test("document previews render active text formats as text and exclude SVG and Office", () => {
  assert.equal(documentPreviewKind("transcricao.txt", "application/octet-stream"), "text");
  assert.equal(documentPreviewKind("pagina.html", "text/html"), "text");
  assert.equal(documentPreviewKind("dados.csv", "text/csv; charset=utf-8"), "text");
  assert.equal(documentPreviewKind("imagem.svg", "image/svg+xml"), null);
  assert.equal(documentPreviewKind("ata.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), null);
  assert.equal(documentPreviewKind("imagem.png", "image/png"), "image");
  assert.equal(documentPreviewKind("ata.pdf", "application/pdf"), "pdf");
});

test("preview limits bound downloads and displayed text", () => {
  assert.equal(previewLimit("text"), 1_000_000);
  assert.equal(previewLimit("image"), 5_000_000);
  assert.equal(previewLimit("pdf"), 5_000_000);
  assert.equal(PREVIEW_TEXT_CHARS, 40_000);
});

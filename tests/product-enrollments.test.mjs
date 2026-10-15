import test from "node:test";
import assert from "node:assert/strict";
import { archiveEnrollment, changeEnrollmentStatus, enrollmentError, enrollmentIsCurrent, enrollmentRemovalError, restoreEnrollment, upsertEnrollment } from "../src/modules/clients/domain/product-enrollments.ts";
import { participationError, upsertParticipation, participantsFor } from "../src/modules/clients/domain/product-stakeholders.ts";

const enrollment = (id, extra = {}) => ({ id, company: "acme", productId: "consultoria", productVersion: 2, startsAt: "2026-09-17", status: "ativa", ...extra });
const contact = (id, extra = {}) => ({ id, company: "acme", active: true, primary: false, accountRole: "usuario", ...extra });
const participation = (id, enrollmentId, stakeholderId, extra = {}) => ({ id, enrollmentId, stakeholderId, company: "acme", accountRole: "ponto-focal", primary: false, active: true, ...extra });

test("independent purchases of the same product retain their dates and version", () => {
  const first = enrollment("first");
  const second = enrollment("second", { startsAt: "2027-01-01", productVersion: 3, previousEnrollmentId: "first" });
  assert.deepEqual(upsertEnrollment([first], second), [first, second]);
  assert.match(enrollmentError(enrollment("duplicate"), [first]), /mesmo início/);
  assert.match(enrollmentError({ ...second, startsAt: first.startsAt }, [first, second]), /mesmo início/);
  assert.match(enrollmentError({ ...second, endsAt: "2026-12-31" }, [first]), /término/);
  assert.match(enrollmentError({ ...second, startsAt: "2027-02-29" }, [first]), /datas/);
});

test("legacy unknown facts remain unknown; new purchases require version and start", () => {
  const legacy = enrollment("legacy", { legacy: true, productVersion: undefined, startsAt: undefined });
  assert.equal(enrollmentError(legacy), null);
  assert.equal(upsertEnrollment([], legacy)[0].productVersion, undefined);
  assert.match(enrollmentError({ ...legacy, legacy: false }), /início e a versão/);
});

test("cancellation and archive keep an auditable relationship history", () => {
  const active = enrollment("purchase");
  assert.throws(() => changeEnrollmentStatus(active, "cancelada", "admin", "2026-09-19T12:00:00Z"), /motivo/);
  const cancelled = changeEnrollmentStatus(active, "cancelada", "admin", "2026-09-19T12:00:00Z", "Contrato desfeito");
  assert.equal(cancelled.endsAt, "2026-09-19");
  assert.equal(cancelled.lifecycleHistory[0].from, "ativa");
  assert.equal(cancelled.lifecycleHistory[0].reason, "Contrato desfeito");
  assert.equal(enrollmentIsCurrent(cancelled), false);
  assert.match(enrollmentRemovalError(cancelled), /preservar o histórico/);
  assert.equal(changeEnrollmentStatus(active, "cancelada", "admin", "2026-09-20T01:30:00Z", "Encerrado à noite").endsAt, "2026-09-19");
  const future = enrollment("future", { startsAt: "2026-10-01" });
  assert.equal(changeEnrollmentStatus(future, "cancelada", "admin", "2026-09-19T12:00:00Z", "Cancelado antes do início").endsAt, undefined);
  assert.throws(() => changeEnrollmentStatus(cancelled, "ativa", "admin", "2026-09-20T10:00:00Z"), /não pode ser reativada/);
  const archived = archiveEnrollment(cancelled, "admin", "2026-09-20T12:00:00Z");
  assert.equal(archived.archivedBy, "admin");
  assert.throws(() => changeEnrollmentStatus(archived, "ativa", "admin", "2026-09-20T13:00:00Z"), /Restaure/);
  const restored = restoreEnrollment(archived, "admin", "2026-09-21T12:00:00Z");
  assert.equal(restored.archivedAt, undefined);
  assert.deepEqual(restored.lifecycleHistory.map(entry => entry.type), ["status", "archived", "restored"]);
  assert.throws(() => archiveEnrollment(active, "admin", "2026-09-20T12:00:00Z"), /Conclua ou cancele/);
  assert.match(enrollmentRemovalError(active), /já possui histórico/);
  assert.equal(enrollmentRemovalError(enrollment("mistake", { lifecycleHistory: [{ type: "created", at: "2026-09-17T12:00:00Z", by: "admin" }] })), null);
  assert.match(enrollmentRemovalError(enrollment("migrated", { lifecycleHistory: [] })), /já possui histórico/);
  assert.match(enrollmentRemovalError(enrollment("legacy", { legacy: true })), /criada por engano/);
});

test("renewals reject another client, another product and circular references", () => {
  const a = enrollment("a"), b = enrollment("b", { startsAt: "2027-01-01", previousEnrollmentId: "a" });
  assert.match(enrollmentError({ ...a, previousEnrollmentId: "b" }, [a, b]), /circular/);
  assert.match(enrollmentError(b, [{ ...a, company: "other" }]), /mesmo cliente/);
  assert.match(enrollmentError(b, [{ ...a, productId: "other" }]), /mesmo cliente/);
  assert.match(enrollmentError({ ...a, company: "other" }, [a]), /não podem ser alterados/);
});

test("local principal is unique per enrollment and leaves other enrollment and contact unchanged", () => {
  const enrollments = [enrollment("a"), enrollment("b")];
  const contacts = [contact("ana", { primary: true }), contact("bia")];
  const original = [participation("a-ana", "a", "ana", { primary: true }), participation("b-ana", "b", "ana", { primary: true })];
  const saved = upsertParticipation(original, participation("a-bia", "a", "bia", { primary: true }), enrollments, contacts);
  assert.equal(saved.find(p => p.id === "a-ana").primary, false);
  assert.equal(saved.find(p => p.id === "b-ana").primary, true);
  assert.equal(saved.find(p => p.id === "a-bia").primary, true);
  assert.equal(contacts[0].primary, true);
  assert.equal(original[0].primary, true);
});

test("participations reject cross-client links, duplicate contacts and identity transfers", () => {
  const enrollments = [enrollment("a"), enrollment("other", { company: "other" })];
  const contacts = [contact("ana"), contact("outside", { company: "other" })];
  const row = participation("p", "a", "ana");
  assert.match(participationError({ ...row, stakeholderId: "outside" }, enrollments, contacts), /mesmo cliente/);
  assert.match(participationError({ ...row, enrollmentId: "other" }, enrollments, contacts), /cliente informado/);
  assert.match(participationError({ ...row, id: "duplicate" }, enrollments, contacts, [row]), /já participa/);
  assert.match(participationError({ ...row, enrollmentId: "b" }, [...enrollments, enrollment("b")], contacts, [row]), /transferida/);
});

test("inactive people cannot gain active participation and inactivation preserves history", () => {
  const enrollments = [enrollment("a")], contacts = [contact("ana", { active: false })];
  const row = participation("p", "a", "ana", { primary: true });
  assert.match(participationError(row, enrollments, contacts), /Reative/);
  const saved = upsertParticipation([], { ...row, active: false }, enrollments, contacts);
  assert.equal(saved[0].primary, false);
  assert.equal(participantsFor("a", [row], contacts)[0].active, false);
  assert.equal(row.primary, true);
});

test("enrollment dates are bounded to 2000–2100 only when they change", () => {
  const legacy = enrollment("legacy", { startsAt: "0002-01-01" });
  assert.equal(enrollmentError({ ...legacy, status: "pausada" }, [legacy]), null);
  assert.match(enrollmentError(enrollment("new", { startsAt: "0002-01-01" })), /entre 2000 e 2100/);
});

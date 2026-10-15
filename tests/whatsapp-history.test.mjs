import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneKey, participantFor } from '../src/modules/engagement/application/participants.ts';
import { fetchHistoryPage, parseMessageCursor } from '../src/server/whatsapp.ts';
import { migrateMemberPhones, migrateStakeholderContacts } from '../src/shared/infrastructure/migration.ts';

test('participant identity uses exact normalized numbers, scoped stakeholders and refuses ambiguity', () => {
  assert.equal(phoneKey('(31) 98888-1234'), '5531988881234');
  assert.equal(phoneKey('5531988881234@s.whatsapp.net'), '5531988881234');
  assert.equal(phoneKey('Alice 31988881234'), '');
  assert.equal(phoneKey('123@g.us'), '');
  const team = [{ id: 'member', name: 'Consultor', org: 'praxis', phone: '+55 31 90000-0000', phones: ['+55 31 90000-0000', '+55 31 98888-1234'] }];
  const contacts = [{ id: 'contact', name: 'Cliente', company: 'a', org: 'client', phone: '11900000000', phones: ['11900000000', '11977771234'] }];
  assert.equal(participantFor('31988881234', team, contacts, 'a').id, 'member');
  assert.equal(participantFor('5511977771234', team, contacts, 'a').id, 'contact');
  assert.equal(participantFor('5511977771234', team, contacts, 'b'), null);
  assert.equal(participantFor('31988881234', [...team, { ...team[0], id: 'ambiguous' }], contacts, 'a'), null);
  const legacy = { extraMembers: [{ id: 'm', name: 'Pessoa' }], memberEdits: { m: { role: 'CS' } } };
  const migrated = migrateMemberPhones(legacy);
  assert.equal(migrated.extraMembers[0].phone, '');
  assert.deepEqual(migrated.extraMembers[0].phones, []);
  assert.deepEqual(migrated.extraMembers[0].emails, []);
  assert.equal(legacy.extraMembers[0].phone, undefined);
  assert.deepEqual(migrated.memberEdits, legacy.memberEdits);
  assert.equal(migrateMemberPhones(migrated), migrated);
  const editedLegacy = { extraMembers: [{ id: 'edited', email: 'old@example.test', phone: '11911112222' }], memberEdits: { edited: { email: 'NEW@example.test', phone: '21988887777' } } };
  const editedMigration = migrateMemberPhones(editedLegacy);
  assert.deepEqual(editedMigration.memberEdits.edited.emails, ['new@example.test']);
  assert.deepEqual(editedMigration.memberEdits.edited.phones, ['5521988887777']);
  assert.equal(migrateMemberPhones(editedMigration), editedMigration);
  const legacyContacts = { contacts: [{ id: 'contact', org: 'client', company: 'a', email: 'PERSON@EXAMPLE.TEST', phone: '(11) 97777-1234' }] };
  const contactMigration = migrateStakeholderContacts(legacyContacts);
  assert.deepEqual(contactMigration.contacts[0].emails, ['person@example.test']);
  assert.deepEqual(contactMigration.contacts[0].phones, ['5511977771234']);
  assert.equal(migrateStakeholderContacts(contactMigration), contactMigration);
});

test('history pages keep raw precision and stable numeric tie ordering, cap every response, escape cursors', async () => {
  const original = globalThis.fetch;
  const at = '2026-09-10T12:00:00.123456+00:00';
  const requests = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url); requests.push(u);
    assert.equal(u.searchParams.get('limit'), '51');
    assert.equal(u.searchParams.get('order'), 'created_at.desc,id.desc');
    const end = u.searchParams.has('or') ? 50 : 100;
    return Response.json(Array.from({ length: end === 100 ? 51 : 50 }, (_, i) => ({ id: end - i, created_at: at, sender_name: '11977771234', body: 'Mensagem', group_name: 'Grupo & teste', group_id: 'g' })));
  };
  try {
    const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_KEY: 'test-only' };
    const page = await fetchHistoryPage(env, { name: 'Grupo & teste' });
    assert.equal(page.messages.length, 50);
    assert.equal(page.messages[0].id, '51');
    assert.equal(page.messages.at(-1).id, '100');
    const cursor = parseMessageCursor(page.nextCursor);
    assert.deepEqual(cursor, { at, id: '51' });
    const older = await fetchHistoryPage(env, { name: 'Grupo & teste' }, cursor);
    assert.equal(older.messages[0].id, '1');
    assert.equal(older.nextCursor, null);
    assert.equal(new Set([...page.messages, ...older.messages].map(m => m.id)).size, 100);
    assert.equal(requests[0].searchParams.get('group_name'), 'eq.Grupo & teste');
    assert.ok(requests[1].searchParams.get('or').includes(at));
    assert.ok(requests[1].searchParams.get('or').includes('id.lt."51"'));
    assert.throws(() => parseMessageCursor('{invalid'));
    assert.throws(() => parseMessageCursor(JSON.stringify({ at: 'invalid', id: '1' })));
    assert.throws(() => parseMessageCursor(JSON.stringify({ at, id: '' })));
  } finally { globalThis.fetch = original; }
});

const { phoneError } = await import('../src/shared/lib/phone.ts');
test('phone edits reject normalized collisions and malformed phones but allow clearing or retaining an identity', () => {
  const all = [{id:'a',name:'Pessoa',phone:'+55 31 98888-1234'}];
  assert.ok(phoneError({id:'b',phone:'31988881234'}, all));
  assert.ok(phoneError({id:'b',phone:'not-a-phone'}, all));
  assert.equal(phoneError({id:'a',phone:'(31) 98888-1234'}, all), null);
  assert.equal(phoneError({id:'b',phone:''}, all), null);
});

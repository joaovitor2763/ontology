import test from 'node:test';
import assert from 'node:assert/strict';
import { editNote } from '../src/modules/engagement/domain/notes.ts';
import { normalizeInteractionTags } from '../src/modules/engagement/domain/interaction-tags.ts';
import { migrateInteractionTags, migrateMeetingOrganizers } from '../src/shared/infrastructure/migration.ts';

test('optional tags normalize without duplicates or unknown labels', () => {
  assert.deepEqual(normalizeInteractionTags(undefined), []);
  assert.deepEqual(normalizeInteractionTags(['duvida', 'feedback', 'duvida', 'unknown']), ['feedback', 'duvida']);
});

test('editing tags preserves the interaction and logs additions and removals', () => {
  const note = { id: 'n1', text: 'Uma dúvida', at: '2026-09-17T10:00:00Z', from: 'Pessoa', interaction: 'email', files: [{ id: 'f1' }] };
  const tagged = editNote(note, { tags: ['duvida', 'feedback'] }, 'Editor', '2026-09-17T11:00:00Z');
  assert.equal(tagged.interaction, 'email');
  assert.deepEqual(tagged.files, note.files);
  assert.equal(tagged.history[0].field, 'tags');
  assert.equal(tagged.history[0].to, 'Feedback, Dúvida');
  assert.equal(tagged.history[0].by, 'Editor');
  assert.equal(editNote(tagged, { tags: ['duvida', 'feedback', 'duvida'] }, 'Editor', 'later'), tagged);
  const cleared = editNote(tagged, { tags: [] }, 'Editor', 'later');
  assert.deepEqual(cleared.tags, []);
  assert.equal(cleared.history.length, 2);
  assert.equal(cleared.createdAt, note.at);
  assert.equal(editNote(tagged, { text: 'Atualizado' }, 'Editor', 'later').tags, tagged.tags);
});

test('legacy notes and meetings remain untagged, existing tags survive normalization', () => {
  const notes = migrateInteractionTags({ notes: { space: [{ text: 'Old' }, { text: 'New', tags: ['elogio'] }] }, other: 'kept' });
  assert.deepEqual(notes.notes.space[0].tags, []);
  assert.deepEqual(notes.notes.space[1].tags, ['elogio']);
  assert.equal(notes.other, 'kept');
  const meetings = migrateMeetingOrganizers({ extraMeetings: [{ id: 'old' }], meetingEdits: { m: { id: 'm', tags: ['observacao'] } } });
  assert.deepEqual(meetings.extraMeetings[0].tags, []);
  assert.deepEqual(meetings.meetingEdits.m.tags, ['observacao']);
});

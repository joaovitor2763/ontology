import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarEvent, meetArtifacts, seal, MEET_SETTINGS_SCOPE } from '../src/server/google.ts';
import { needsMeetArtifacts, transcriptText } from '../src/modules/engagement/application/google-meet.ts';
import { migrateMeetingOrganizers } from '../src/shared/infrastructure/migration.ts';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
async function fixture(scopes = MEET_SETTINGS_SCOPE, account = 'creator@example.com') {
  const env = { GOOGLE_TOKEN_KEY: 'test-only', GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test' };
  const connection = { account_email: account, calendar_id: 'primary', scopes, refresh_token_enc: await seal(env.GOOGLE_TOKEN_KEY, 'test-refresh') };
  const db = { prepare() { return { bind() { return this; }, async first() { return connection; } }; } };
  return { env, db };
}
const eventInput = { requestId: 'abcdef1234', title: 'Test', description: '', startsAt: '2026-09-21T17:00:00Z', endsAt: '2026-09-21T18:00:00Z', timeZone: 'America/Sao_Paulo', attendees: [], withMeet: true };

test('calendar creator is organizer and both artifact flags are configured without touching other settings', async (t) => {
  const { env, db } = await fixture();
  let patched = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('oauth2.googleapis')) return json({ access_token: 'test' });
    if (String(url).includes('/calendars/primary/events')) return json({ id: 'event', organizer: { email: 'creator@example.com' }, hangoutLink: 'https://meet.google.com/abc-defg-hij' });
    if (init?.method === 'PATCH') {
      patched = true;
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body.config), ['artifactConfig']);
      assert.equal(body.config.artifactConfig.recordingConfig.autoRecordingGeneration, 'ON');
      assert.equal(body.config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration, 'ON');
      assert.match(String(url), /updateMask=config.artifactConfig.recordingConfig/);
      return json(body);
    }
    return json({ name: 'spaces/space1' });
  });
  const result = await createCalendarEvent(env, db, 'ws', 'creator@example.com', eventInput);
  assert.equal(result.organizer, 'creator@example.com');
  assert.equal(result.autoRecording, true);
  assert.equal(patched, true);
});

test('missing scope or rejected recording preserves the already-created event and reports a warning', async (t) => {
  for (const scopes of ['', MEET_SETTINGS_SCOPE]) {
    const { env, db } = await fixture(scopes);
    t.mock.method(globalThis, 'fetch', async (url) => {
      if (String(url).includes('oauth2.googleapis')) return json({ access_token: 'test' });
      if (String(url).includes('/events')) return json({ id: 'existing', hangoutLink: 'https://meet.google.com/abc-defg-hij' });
      return json({ error: { message: 'Not allowed' } }, 403);
    });
    const result = await createCalendarEvent(env, db, 'ws', 'creator@example.com', eventInput);
    assert.equal(result.eventId, 'existing');
    assert.equal(result.autoRecording, false);
    assert.ok(result.recordingWarning);
  }
});

test('a different connected Google identity cannot schedule as the platform creator', async (t) => {
  const { env, db } = await fixture(MEET_SETTINGS_SCOPE, 'other@example.com');
  t.mock.method(globalThis, 'fetch', async () => json({ access_token: 'test' }));
  await assert.rejects(createCalendarEvent(env, db, 'ws', 'creator@example.com', eventInput), /própria conta/);
});

test('artifact import reads all transcript pages and refuses an unfinished transcript', async (t) => {
  const { env, db } = await fixture();
  let state = 'FILE_GENERATED';
  let entryCalls = 0;
  let participantCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url);
    if (u.host === 'oauth2.googleapis.com') return json({ access_token: 'test' });
    if (u.pathname.endsWith('/recordings')) return json({ recordings: [] });
    if (u.pathname.endsWith('/transcripts')) return json({ transcripts: [{ name: 'conferenceRecords/r/transcripts/t', state, docsDestination: { exportUri: 'https://docs.google.com/document/d/t' } }] });
    if (u.pathname.endsWith('/participants')) {
      participantCalls++;
      return u.searchParams.has('pageToken')
        ? json({ participants: [{ name: 'conferenceRecords/r/participants/2', anonymousUser: { displayName: 'Bruno' } }] })
        : json({ participants: [{ name: 'conferenceRecords/r/participants/1', signedinUser: { displayName: 'Ana Silva' } }], nextPageToken: 'people2' });
    }
    if (u.pathname.endsWith('/entries')) {
      entryCalls++;
      assert.equal(u.searchParams.get('pageSize'), '100');
      return u.searchParams.has('pageToken')
        ? json({ transcriptEntries: [{ participant: 'conferenceRecords/r/participants/2', text: 'Second', startTime: '2026-09-17T10:01:00Z' }] })
        : json({ transcriptEntries: [{ participant: 'conferenceRecords/r/participants/1', text: 'First', startTime: '2026-09-17T10:00:00Z' }], nextPageToken: 'page2' });
    }
    return json({ conferenceRecords: [{ name: 'conferenceRecords/r', startTime: '2026-09-17T10:00:00Z', endTime: '2026-09-17T10:30:00Z' }] });
  });
  const input = { meetLink: 'https://meet.google.com/abc-defg-hij', startsAt: '2026-09-17T10:00:00Z' };
  const result = await meetArtifacts(env, db, 'ws', 'creator@example.com', input);
  assert.match(result.artifacts.transcriptText, /Ana Silva: First[\s\S]*Bruno: Second/);
  assert.equal(participantCalls, 2);
  assert.equal(entryCalls, 2);
  state = 'ENDED';
  assert.equal((await meetArtifacts(env, db, 'ws', 'creator@example.com', input)).artifacts.transcriptText, '');
  assert.equal(entryCalls, 2);
});

test('partial artifacts keep polling; completed pair, other organizer and hourly cooldown do not', () => {
  const now = Date.parse('2026-09-17T15:00:00Z');
  const m = { startsAt: '2026-09-17T10:00:00Z', durationMin: 45, google: { organizer: 'creator@example.com', meetLink: 'https://meet.google.com/abc-defg-hij', recordingUrl: 'https://drive.google.com/file/d/r', artifactStatus: 'ready' } };
  assert.equal(needsMeetArtifacts(m, 'creator@example.com', now), true);
  assert.equal(needsMeetArtifacts(m, 'other@example.com', now), false);
  assert.equal(needsMeetArtifacts({ ...m, google: { ...m.google, transcriptDocId: 'doc' } }, 'creator@example.com', now), false);
  assert.equal(needsMeetArtifacts({ ...m, google: { ...m.google, lastArtifactCheckAt: new Date(now - 10_000).toISOString() } }, 'creator@example.com', now), false);
  assert.throws(() => transcriptText([{ text: 'á'.repeat(30) }], 40), /extensa/);
});

test('legacy organizer migration uses known identity and preserves explicit creators', () => {
  const old = { id: 'old', google: { organizer: 'owner@example.com' } };
  const explicit = { id: 'new', organizerEmail: 'creator@example.com', google: { organizer: 'owner@example.com' } };
  const result = migrateMeetingOrganizers({ extraMeetings: [old, explicit, { id: 'unknown' }], meetingEdits: { old } });
  assert.equal(result.extraMeetings[0].organizerEmail, 'owner@example.com');
  assert.equal(result.extraMeetings[1].organizerEmail, 'creator@example.com');
  assert.equal(result.extraMeetings[2].organizerEmail, undefined);
  assert.equal(result.meetingEdits.old.organizerEmail, 'owner@example.com');
});

test('early test session lookup is explicit and ambiguous sessions are not attached', async (t) => {
  const { env, db } = await fixture();
  let sessions = 1;
  let lookups = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('oauth2.googleapis')) return json({ access_token: 'test' });
    if (String(url).includes('/recordings')) return json({ recordings: [] });
    if (String(url).includes('/transcripts')) return json({ transcripts: [] });
    lookups++;
    const filter = new URL(url).searchParams.get('filter');
    if (filter.includes('2099')) return json({ conferenceRecords: [] });
    return json({ conferenceRecords: Array.from({ length: sessions }, (_, i) => ({ name: `conferenceRecords/r${i}`, startTime: new Date().toISOString(), endTime: new Date().toISOString() })) });
  });
  const input = { meetLink: 'https://meet.google.com/abc-defg-hij', startsAt: '2099-09-21T17:00:00Z' };
  assert.equal((await meetArtifacts(env, db, 'ws', 'creator@example.com', input)).state, 'not_found');
  assert.equal(lookups, 1);
  assert.equal((await meetArtifacts(env, db, 'ws', 'creator@example.com', { ...input, includeEarlierSessions: true })).state, 'ready');
  sessions = 2;
  await assert.rejects(meetArtifacts(env, db, 'ws', 'creator@example.com', { ...input, includeEarlierSessions: true }), /mais de uma sessão/);
});


test('transcript speakers use Meet display names and stable anonymous labels without leaking IDs', () => {
  const entries = ['a', 'b', 'c', 'missing', 'missing', 'other'].map((participant) => ({ participant, text: 'Olá' }));
  const result = transcriptText(entries, 10000, [
    { name: 'a', signedinUser: { displayName: 'Ana Silva' } },
    { name: 'b', anonymousUser: { displayName: 'Convidado' } },
    { name: 'c', phoneUser: { displayName: '+55 *** 1234' } },
  ]);
  assert.equal(result, [
    'Ana Silva: Olá', 'Convidado: Olá', '+55 *** 1234: Olá',
    'Participante 1 (nome indisponível): Olá', 'Participante 1 (nome indisponível): Olá',
    'Participante 2 (nome indisponível): Olá',
  ].join('\n'));
});

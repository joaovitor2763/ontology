import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGroupMessages } from '../src/server/whatsapp.ts';
test('group names with punctuation are sent as literal equality values, without extra quotes', async()=>{
  const original=globalThis.fetch; let seen;
  globalThis.fetch=async(url)=>{seen=new URL(url);return Response.json([]);};
  try {
    const name='[G4 OS] - Chicarino, Quaresma, Tanaka & Dias Advogados';
    await fetchGroupMessages({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_KEY:'placeholder',WHATSAPP_GROUP_NAME_COLUMN:'fonte'},{name});
    assert.equal(seen.searchParams.get('fonte'),`eq.${name}`);
  }finally{globalThis.fetch=original;}
});

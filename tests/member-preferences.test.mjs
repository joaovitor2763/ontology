import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {readPreferences,writePreference} from '../src/server/member-preferences.ts';

test('personal preferences are per person, newest write wins and input is bounded',async()=>{
  const f=sqliteD1();
  try{
    const views={views:[{id:'v1',name:'Meus clientes',filters:{owner:'me'}}],defaultId:'v1'};
    assert.equal((await writePreference(f.db,'default','Ana@Example.test',{key:'saved-views.clients',value:{views:[],defaultId:''}})).ok,true);
    assert.deepEqual(await readPreferences(f.db,'default','bia@example.test'),{});
    // O carimbo é do servidor: um relógio adiantado no aparelho não decide quem vence.
    const saved=await writePreference(f.db,'default','ana@example.test',{key:'saved-views.clients',value:views,updatedAt:'2999-01-01T00:00:00.000Z'});
    assert.ok(saved.ok&&saved.updatedAt<'2999');
    assert.deepEqual((await readPreferences(f.db,'default','ana@example.test'))['saved-views.clients'].value,views);
    await writePreference(f.db,'default','ana@example.test',{key:'client-tabs',value:'entregas'});
    assert.equal((await readPreferences(f.db,'default','ana@example.test'))['client-tabs'].value,'entregas');
    assert.equal((await writePreference(f.db,'default','ana@example.test',{key:'../x',value:1})).status,400);
    assert.equal((await writePreference(f.db,'default','ana@example.test',{key:'client-tabs'})).status,400);
    assert.equal((await writePreference(f.db,'default','ana@example.test',{key:'big',value:'x'.repeat(17000)})).status,413);
    assert.equal((await writePreference(f.db,'default','ana@example.test',{key:'saved-views.tasks.acme-corp',value:{}})).ok,true);
  }finally{f.sql.close();}
});

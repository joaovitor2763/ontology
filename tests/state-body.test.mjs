import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {getDoc,putDoc} from '../src/server/db.ts';
import {freshDocumentSnapshot,loadDocuments} from '../src/server/operations/request-context.ts';
import {commitOperation} from '../src/server/operations/transaction.ts';
import {decodeStateBody,encodeStateBody} from '../src/server/state-body.ts';

const key='ontology.delivery.v2';
function largeExecution(){
  const detail='Planejar a execução com responsáveis, evidências e datas. '.repeat(18);
  return {extraTasks:Array.from({length:2200},(_,index)=>({
    id:`task-${index}`,company:`client-${index%85}`,title:'Definir o AI Master',description:detail,status:'fila',
  })),extraCycles:[],taskPatches:{}};
}

test('documento grande comprime sem mudar o JSON e documento antigo segue legível',async()=>{
  const value=largeExecution(),raw=JSON.stringify(value);
  assert.ok(Buffer.byteLength(raw)>2_000_000);
  const packed=await encodeStateBody(value);
  assert.match(packed,/^!g4-state-gzip-v1:/);
  assert.ok(Buffer.byteLength(packed)<1_800_000);
  assert.equal(JSON.stringify(await decodeStateBody(packed)),raw);
  assert.deepEqual(await decodeStateBody(raw),value);
  const small={extraTasks:[{id:'one'}]};
  assert.equal(await encodeStateBody(small),JSON.stringify(small));
});

test('transação, leitura em lote, histórico e PUT legados aceitam corpo compactado',async()=>{
  const {db,sql}=sqliteD1();
  try {
    const value=largeExecution();
    const commit={workspace:'default',principal:'member:actor',application:'test',actor:{memberId:'actor',email:'actor@example.test',kind:'session'},
      key:'large-operation',command:'tasks.update',hash:'large-hash',id:crypto.randomUUID(),
      guards:[{key,version:0}],writes:[{key,value}],events:[],result:{data:{saved:true},documents:[{key,value,version:1}]}};
    await commitOperation(db,commit);
    const stored=sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body;
    assert.match(stored,/^!g4-state-gzip-v1:/);
    assert.equal(JSON.stringify((await getDoc(db,'default',key)).value),JSON.stringify(value));
    assert.equal(JSON.stringify((await loadDocuments(db,'default',[key]))[0].value),JSON.stringify(value));
    assert.equal(JSON.stringify((await freshDocumentSnapshot(db,'default',[key]))[0].value),JSON.stringify(value));
    assert.equal(JSON.stringify((await decodeStateBody(sql.prepare('SELECT body FROM state_history WHERE key=?').get(key).body))),JSON.stringify(value));
    const updated={...value,taskPatches:{'task-0':{status:'em-curso'}}};
    assert.deepEqual(await putDoc(db,'default',key,updated,1,'actor'),{ok:true,version:2});
    assert.equal(JSON.stringify((await getDoc(db,'default',key)).value),JSON.stringify(updated));
    assert.equal(JSON.stringify((await decodeStateBody(sql.prepare('SELECT body FROM state_history WHERE key=? AND version=2').get(key).body))),JSON.stringify(updated));
  } finally {sql.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {patchSyncStatus} from '../src/shared/infrastructure/persistence.ts';
import {withOperationDocuments} from '../src/shared/infrastructure/useLocalStorageState.ts';
import {executeClientOperation,operationAttempt} from '../src/shared/infrastructure/operations.ts';
import {isUncertainFailure} from '../src/shared/infrastructure/operation-error.ts';

test('resposta 500 mantém a conclusão incerta e permite conferir com a mesma chave',async()=>{
  const original={fetch:globalThis.fetch,localStorage:globalThis.localStorage,window:globalThis.window};
  const cache=new Map();
  globalThis.localStorage={getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value)};
  globalThis.window={clearTimeout,setTimeout};
  patchSyncStatus({mode:'remote',resolved:true,hydrated:true,user:{email:'test@example.test',name:'Test'}});
  const key='ontology.delivery.v2',input={taskId:'d-1',patch:{},completedAt:'2026-09-24',checklist:[],evidence:'',effortActual:1};
  const attempt=operationAttempt('tasks.complete',input);
  const sent=[];
  try {
    await withOperationDocuments([key],async()=>({documents:[{key,value:{taskEdits:{}},version:1}]}));
    globalThis.fetch=async(_url,init)=>{
      sent.push(init.headers['Idempotency-Key']);
      return sent.length===1
        ? Response.json({error:{code:'internal_error',message:'Verifique o resultado. Código de suporte: abc.'}},{status:500})
        : Response.json({data:{},documents:[{key,value:{taskEdits:{'d-1':{status:'concluida'}}},version:2}]});
    };
    let failure;
    try {await executeClientOperation('tasks.complete',input,attempt);} catch(error) {failure=error;}
    assert.equal(isUncertainFailure(failure),true);
    assert.match(failure.message,/Código de suporte/);
    await executeClientOperation('tasks.complete',input,attempt);
    assert.deepEqual(sent,[attempt.key,attempt.key]);
  } finally {
    globalThis.fetch=original.fetch;
    globalThis.localStorage=original.localStorage;
    globalThis.window=original.window;
    patchSyncStatus({user:null,mode:'local',resolved:false,hydrated:false});
  }
});

test('conflito 409 é recusa marcada e a nova tentativa envia as versões atuais, não as congeladas',async()=>{
  const original={fetch:globalThis.fetch,localStorage:globalThis.localStorage,window:globalThis.window};
  const cache=new Map();
  globalThis.localStorage={getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value)};
  globalThis.window={clearTimeout,setTimeout};
  patchSyncStatus({mode:'remote',resolved:true,hydrated:true,user:{email:'test@example.test',name:'Test'}});
  const key='ontology.delivery.v2',input={taskId:'d-1',patch:{},completedAt:'2026-09-24',checklist:[],evidence:'',effortActual:1};
  const attempt=operationAttempt('tasks.complete',input);
  const sent=[];
  try {
    await withOperationDocuments([key],async()=>({documents:[{key,value:{taskEdits:{}},version:1}]}));
    globalThis.fetch=async(_url,init)=>{
      sent.push(JSON.parse(init.body).expectedVersions[key]);
      return sent.length===1
        ? Response.json({error:{code:'version_conflict',message:'Os dados mudaram.'}},{status:409})
        : Response.json({data:{},documents:[{key,value:{taskEdits:{}},version:4}]});
    };
    let failure;
    try {await executeClientOperation('tasks.complete',input,attempt);} catch(error) {failure=error;}
    assert.equal(isUncertainFailure(failure),false);
    assert.equal(failure.conflict,true);
    assert.equal(attempt.expectedVersions,undefined);
    // Outra aba ou pessoa avançou o documento: a próxima tentativa parte da versão nova.
    await withOperationDocuments([key],async()=>({documents:[{key,value:{taskEdits:{}},version:3}]}));
    await executeClientOperation('tasks.complete',input,attempt);
    assert.deepEqual(sent,[2,3]);
  } finally {
    globalThis.fetch=original.fetch;
    globalThis.localStorage=original.localStorage;
    globalThis.window=original.window;
    patchSyncStatus({user:null,mode:'local',resolved:false,hydrated:false});
  }
});

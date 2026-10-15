import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {acknowledgmentInsertSql,planAlertAcknowledgmentMigration,sharedListUpdateSql} from '../src/server/alert-acknowledgment-migration.ts';
import {readAlertQueue} from '../src/server/operations/alert-queue.ts';
import {alerts} from '../src/modules/workspace/infrastructure/seed.ts';

const first=alerts[0],second=alerts.find(alert=>alert.company!==first.company);
const session=memberId=>({id:`member:${memberId}`,kind:'session',email:`${memberId}@example.test`,memberId,access:'admin',application:'web',scopes:null,companies:null,guards:[]});

test('the shared hidden list is attributed to whoever acknowledged each alert; unattributable IDs stay shared',()=>{
 const plan=planAlertAcknowledgmentMigration({
  hidden:[first.id,second.id,'orphan','bulk-2'],
  credentialOwners:new Map([['cred-1','bruno']]),
  sources:[
   {type:'alerts.acknowledge',company:first.company,subject:first.id,data:'{}',createdAt:'2026-09-02T00:00:00Z',principal:'member:ana'},
   {type:'alerts.acknowledge',company:first.company,subject:first.id,data:'{}',createdAt:'2026-09-01T00:00:00Z',principal:'member:ana'},
   {type:'alerts.acknowledge',company:first.company,subject:first.id,data:'{}',createdAt:'2026-09-03T00:00:00Z',memberId:'carla',principal:'oauth:x:y'},
   {type:'alerts.acknowledgeBatch',company:second.company,subject:'batch',data:JSON.stringify({alertIds:[second.id,'not-hidden','bulk-2'],versions:{}}),createdAt:'2026-09-04T00:00:00Z',principal:'integration:cred-1'},
   {type:'alerts.acknowledge',company:'x',subject:'orphan',data:'{}',createdAt:'2026-09-05T00:00:00Z',principal:'oauth:someone:grant'},
   {type:'tasks.update',company:'x',subject:'orphan',data:'{}',createdAt:'2026-09-05T00:00:00Z',principal:'member:ana'},
  ]});
 assert.deepEqual(plan.rows.map(row=>`${row.memberId}/${row.company}/${row.alertId}@${row.acknowledgedAt}`),[
  `ana/${first.company}/${first.id}@2026-09-01T00:00:00Z`,
  ...[`bruno/${second.company}/bulk-2@2026-09-04T00:00:00Z`,`bruno/${second.company}/${second.id}@2026-09-04T00:00:00Z`].sort(),
  `carla/${first.company}/${first.id}@2026-09-03T00:00:00Z`,
 ]);
 assert.deepEqual(plan.remaining,['orphan']);
 assert.deepEqual(plan.counts,{hidden:4,attributed:3,unattributed:1,rows:4,members:3,unresolvedSources:1});
 // Muitas linhas viram vários comandos, cada um abaixo do limite de tamanho do D1.
 const many=Array.from({length:3000},(_,i)=>({memberId:'ana',company:'c',alertId:`derived-alert-${i}`,acknowledgedAt:'2026-09-01T00:00:00Z'}));
 const statements=acknowledgmentInsertSql('default',many);
 assert.ok(statements.length>1);
 assert.ok(statements.every(sql=>Buffer.byteLength(sql)<=90_000));
});

test('applying the plan stores per-member rows and rewrites the shared list only at the version read',async()=>{
 const f=sqliteD1();
 const workspace={workspaceName:'Preservado',hidden:[first.id,second.id,'orphan'],extraMembers:[{id:'ana',email:'ana@example.test',access:'admin'},{id:'bruno',email:'bruno@example.test',access:'admin'}]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',7,?)").run(JSON.stringify(workspace));
 try{
  const env={DB:f.db},sees=async(actor,alert)=>(await readAlertQueue(env,actor)).data.some(row=>row.company===alert.company&&row.id===alert.id);
  // Antes: a lista compartilhada esconde de todos.
  assert.equal(await sees(session('bruno'),first),false);
  const plan=planAlertAcknowledgmentMigration({hidden:workspace.hidden,sources:[
   {type:'alerts.acknowledge',company:first.company,subject:first.id,data:'{}',createdAt:'2026-09-01T00:00:00Z',principal:'member:ana'},
   {type:'alerts.acknowledgeBatch',company:second.company,subject:'batch',data:JSON.stringify({alertIds:[second.id]}),createdAt:'2026-09-02T00:00:00Z',memberId:'ana'},
  ]});
  for(const sql of acknowledgmentInsertSql('default',plan.rows))f.sql.exec(sql);
  for(const sql of acknowledgmentInsertSql('default',plan.rows))f.sql.exec(sql); // repetir não duplica
  assert.equal(f.sql.prepare('SELECT count(*) n FROM alert_acknowledgments').get().n,2);
  // Uma versão velha não toca o documento.
  f.sql.exec(sharedListUpdateSql({workspace:'default',key:'ontology.workspace.v3',version:6,removed:plan.removed,now:'2026-09-28T00:00:00Z',by:'migration:test'}));
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.workspace.v3'").get().version,7);
  f.sql.exec(sharedListUpdateSql({workspace:'default',key:'ontology.workspace.v3',version:7,removed:plan.removed,now:'2026-09-28T00:00:00Z',by:'migration:test'}));
  const row=f.sql.prepare("SELECT version,body,updated_by FROM state_documents WHERE key='ontology.workspace.v3'").get(),saved=JSON.parse(row.body);
  assert.equal(row.version,8);assert.equal(row.updated_by,'migration:test');
  assert.deepEqual(saved.hidden,['orphan']);
  assert.equal(saved.workspaceName,'Preservado');
  assert.equal(saved.extraMembers.length,2);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM state_history WHERE key='ontology.workspace.v3' AND version=8").get().n,1);
  // Depois: quem marcou continua sem ver; o resto da equipe volta a ver.
  assert.equal(await sees(session('ana'),first),false);
  assert.equal(await sees(session('ana'),second),false);
  assert.equal(await sees(session('bruno'),first),true);
  assert.equal(await sees(session('bruno'),second),true);
 }finally{f.sql.close();}
});

test('an audit actor that is not a member (0024 backfill: oauth:…) never un-hides an alert',()=>{
 const plan=planAlertAcknowledgmentMigration({hidden:['a-1'],sources:[
  {type:'alerts.acknowledge',company:'x',subject:'a-1',data:'{}',createdAt:'2026-09-01T00:00:00Z',memberId:'oauth:user:grant',principal:'oauth:user:grant'},
 ]});
 assert.deepEqual(plan.rows,[]);
 assert.deepEqual(plan.remaining,['a-1']);
});

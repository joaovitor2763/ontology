import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { issueIntegrationCredential } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
import { readContextQuery } from '../src/server/operations/context-queries.ts';
async function fixture(scopes=['clients:read','enrollments:read','stakeholders:read','documents:read','workspace:read','delivery:read','meetings:read','catalog:read','delivery:write']) {
 const f=sqliteD1();
 const write=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET body=excluded.body,version=version+1").run(key,JSON.stringify(value));
 write('ontology.workspace.v3',{extraMembers:[{id:'a',email:'a@example.com',access:'admin'},{id:'m',email:'m@example.com',access:'ai_master'}]});
 const enrollments=['one','two','empty'].map(id=>({id,company:'client',productId:'product',status:'ativa',legacy:true}));
 const participations=[{id:'p',company:'client',enrollmentId:'one',stakeholderId:'person',primary:true,active:true,accountRole:'decisor'},{id:'dup',company:'client',enrollmentId:'one',stakeholderId:'person',primary:true,active:true,accountRole:'decisor'},{id:'q',company:'client',enrollmentId:'two',stakeholderId:'person',primary:false,active:true,accountRole:'tecnico'},{id:'foreign',company:'client',enrollmentId:'two',stakeholderId:'private-person',active:true}];
 const clients={extraClients:[{slug:'client',name:'Cliente',journeyId:'',notes:'PRIVATE'},{slug:'other',name:'Outro'}],enrollments,participations,allocationsMigrated:true,allocations:[{company:'client',memberId:'m',role:'lead',percentage:10}]};
 write('ontology.clients.v3',clients);
 write('ontology.stakeholders.v1',{contacts:[{id:'person',company:'client',name:'Pessoa',email:'PRIVATE',notes:'PRIVATE',active:true,accountRole:'decisor',stance:'desconhecido'},{id:'person',company:'client',name:'Pessoa',active:true,accountRole:'decisor'},{id:'private-person',company:'other',name:'PRIVATE',active:true}]});
 const product={id:'product',name:'Produto',version:2,cycles:[{id:'c',deliveries:[{id:'t',title:'Tarefa'}]}]};
 write('ontology.catalog.v2',{extraProducts:[product],productVersions:{product:[{version:1,at:'2026-01-01',by:'PRIVATE',snapshot:{...product,version:1,name:'Antigo'}},{version:2,at:'2026-02-01',by:'PRIVATE',snapshot:product}]}});
 write('ontology.engagement.v2',{extraMeetings:[{id:'meeting',company:'client',title:'Reunião',startsAt:'2026-09-18T12:00:00Z',notes:'PRIVATE',guests:['PRIVATE'],actions:[]}]});
 const issued=await issueIntegrationCredential(f.db,'default','a@example.com',{name:'Context',ownerEmail:'m@example.com',scopes,companies:['client'],expiresAt:'2099-01-01T00:00:00Z'});
 const env={DB:f.db},principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${issued.token}`}}),env);
 return {...f,env,principal,write,clients,issued,read:(query,input)=>readContextQuery(env,principal,query,input)};
}
test('compact context enforces sections and omits raw snapshots, notes and guests',async()=>{
 const f=await fixture();const result=await f.read('client.context',{company:'client'});
 assert.equal(result.data.client.slug,'client');assert.equal(result.data.sections.enrollments.length,3);assert.equal(result.data.sections.enrollments[0].milestone,null);assert.equal(result.data.sections.allocations[0].memberId,'m');assert.equal(result.data.sections.meetings[0].id,'meeting');assert.equal(result.data.links.related.documents.href,'/api/v1/documents?company=client');assert.equal(result.data.links.related.members.tool,'members_list');assert.equal(result.data.links.related.stakeholders.tool,'stakeholders_list');assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(result.data.versions['ontology.clients.v3'],1);
 await assert.rejects(f.read('client.context',{company:'other'}),{code:'client_not_allowed'});f.sql.close();
 const limited=await fixture(['clients:read']);const data=(await limited.read('client.context',{company:'client'})).data;
 assert.deepEqual(data.unavailable,['enrollments','allocations','stakeholders','documents','execution','meetings']);assert.deepEqual(data.sections,{});assert.deepEqual(data.links.related,{});assert.deepEqual(Object.keys(data.versions),['ontology.clients.v3']);limited.sql.close();
});
test('client context reads the current client execution slice without loading the global body',async()=>{
 const f=await fixture();
 try {
  const task={id:'scoped-task',company:'client',title:'Scoped',status:'fila',dueAt:'2026-09-30'};
  f.write('ontology.delivery.v2',{extraTasks:[task]});
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     expected_clients,expected_owners,expected_orphans,expected_array_order,updated_at)
    VALUES('default','context-test','shadow',1,1,1,1,0,1,'2026-09-27')`).run();
  f.sql.prepare(`INSERT INTO delivery_client_snapshots
    (workspace_id,generation,company,revision,body,body_sha256)
    VALUES('default','context-test','client',1,?,'test')`)
    .run(JSON.stringify({extraTasks:[task]}));
  const original=f.db.prepare.bind(f.db);
  f.db.prepare=sql=>{
    const statement=original(sql),bind=statement.bind;
    statement.bind=function(...values){
      if(sql.includes('state_documents')&&sql.includes('body')&&values.includes('ontology.delivery.v2'))
        throw new Error('Global execution body was loaded');
      return bind.apply(this,values);
    };
    return statement;
  };
  const result=await f.read('client.context',{company:'client'});
  assert.equal(result.data.sections.execution.taskCount,1);
  assert.equal(result.data.versions['ontology.delivery.v2'],1);
 } finally { f.sql.close(); }
});
test('stakeholder map deduplicates people and participation, isolates purchases and foreign references',async()=>{
 const f=await fixture();const data=(await f.read('client.stakeholder-map',{company:'client'})).data;
 assert.equal(data.people.length,1);const one=data.enrollments.find(e=>e.enrollmentId==='one'),two=data.enrollments.find(e=>e.enrollmentId==='two'),empty=data.enrollments.find(e=>e.enrollmentId==='empty');
 assert.equal(one.participants.length,1);assert.equal(one.gaps.noActivePrimary,false);assert.equal(two.gaps.noActivePrimary,true);assert.equal(two.gaps.unresolvedReferences,1);assert.equal(empty.gaps.noActiveParticipants,true);assert.equal(two.expectedRoles,null);assert.ok(!JSON.stringify(data).includes('PRIVATE'));assert.ok(!JSON.stringify(data).includes('private-person'));f.sql.close();
 const limited=await fixture(['stakeholders:read']);await assert.rejects(limited.read('client.stakeholder-map',{company:'client'}),{code:'insufficient_scope'});limited.sql.close();
});
test('discovery uses current membership, credential scopes and allocation rather than cached principal',async()=>{
 const f=await fixture();assert.equal((await f.read('me')).data.memberId,'m');
 const permitted=data=>data.permissions.find(p=>p.action==='entregas.editar').allowed;
 assert.equal(permitted((await f.read('capabilities',{company:'client'})).data),true);
 f.write('ontology.clients.v3',{...f.clients,allocations:[]});assert.equal(permitted((await f.read('capabilities',{company:'client'})).data),false);
 f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run('["clients:read"]',f.issued.id);assert.deepEqual((await f.read('me')).data.scopes,['clients:read']);
 f.write('ontology.workspace.v3',{extraMembers:[{id:'m',email:'m@example.com',access:'leitor'}],deactivatedIds:['m']});await assert.rejects(f.read('me'),{code:'inactive_member'});f.sql.close();
 const revoked=await fixture();revoked.sql.prepare('UPDATE integration_credentials SET revoked_at=? WHERE id=?').run('2026-01-01',revoked.issued.id);await assert.rejects(revoked.read('capabilities'),{code:'invalid_token'});revoked.sql.close();
});
test('catalog version list is compact and historical detail is exact, authorized and read-only',async()=>{
 const f=await fixture();const before=f.sql.prepare('SELECT count(*) n FROM operation_events').get().n;
 const list=await f.read('product.versions',{productId:'product',company:'client'});assert.equal(list.data.versions.length,2);assert.equal(list.data.versions[0].taskCount,1);assert.ok(!JSON.stringify(list).includes('PRIVATE'));
 const detail=await f.read('product.versions',{productId:'product',company:'client',version:1});assert.equal(detail.data.product.name,'Antigo');
 await assert.rejects(f.read('product.versions',{productId:'product'}),{code:'client_not_allowed'});
 await assert.rejects(f.read('product.versions',{productId:'product',company:'client',version:3}),{code:'not_found'});
 await assert.rejects(f.read('product.versions',{productId:'product',company:'client',version:1.5}),{code:'invalid_input'});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,before);f.sql.close();
});
test('current product version uses purchase head even when archive differs or lacks it',async()=>{
 const f=await fixture();
 const old={id:'product',name:'Snapshot antigo',version:2,cycles:[]};
 const head={...old,name:'Conteúdo da próxima compra',cycles:[{id:'c',milestones:[{id:'resultado',name:'Resultado'}],deliveries:[]}]};
 f.write('ontology.catalog.v2',{extraProducts:[head],productVersions:{product:[{version:2,at:'2026-01-01',snapshot:old}]}});
 const current=(await f.read('product.versions',{company:'client',productId:'product',version:2})).data;
 assert.equal(current.source,'current');assert.deepEqual(current.product,head);
 let list=(await f.read('product.versions',{company:'client',productId:'product'})).data.versions;assert.equal(list.length,1);assert.equal(list[0].cycleCount,1);assert.equal(list[0].source,'current');
 f.write('ontology.catalog.v2',{extraProducts:[{...head,version:3}],productVersions:{product:[{version:2,at:'2026-01-01',snapshot:old}]}});
 list=(await f.read('product.versions',{company:'client',productId:'product'})).data.versions;assert.deepEqual(list.map(v=>[v.version,v.source]),[[2,'snapshot'],[3,'current']]);
 assert.equal((await f.read('product.versions',{company:'client',productId:'product',version:2})).data.product.name,'Snapshot antigo');
 f.write('ontology.catalog.v2',{extraProducts:[{id:'product',name:'Sem versão',cycles:[]}],productVersions:{product:[]}});
 assert.equal((await f.read('product.versions',{company:'client',productId:'product',version:1})).data.source,'current');f.sql.close();
});
test('map counts unique active relationships and uses only explicitly linked meeting invitees',async()=>{
 const f=await fixture();
 f.write('ontology.stakeholders.v1',{contacts:[{id:'person',name:'Pessoa',company:'client',active:true,stance:'apoiador',influence:'alta'},{id:'unassigned',name:'Sem vínculo',company:'client',active:true},{id:'inactive',name:'Inativo',company:'client',active:false}]});
 const meeting=(id,enrollmentIds,attendeeIds,rest={})=>({id,company:'client',title:'Reunião',startsAt:'2026-09-18T12:00:00Z',enrollmentIds,attendeeIds,actions:[],...rest});
 f.write('ontology.engagement.v2',{extraMeetings:[meeting('linked',['one'],['person','person']),meeting('unlinked',undefined,['person']),meeting('cancelled',['two'],['person'],{cancelledAt:'2026-09-01'}),meeting('other',['two'],['person'],{company:'other'}),meeting('without',['two'],['team'])]});
 const data=(await f.read('client.stakeholder-map',{company:'client'})).data;
 assert.deepEqual(data.counts,{total:3,active:2,shared:1,unassigned:1});
 const one=data.enrollments.find(e=>e.enrollmentId==='one'),two=data.enrollments.find(e=>e.enrollmentId==='two');
 assert.deepEqual(one.counts,{total:1,active:1,activePrimary:1});assert.equal(one.participants[0].stance,undefined);assert.equal(one.participants[0].influence,undefined);assert.equal(one.gaps.unknownStance,1);assert.equal(one.gaps.unspecifiedInfluence,1);
 assert.equal(one.meetingCoverage.activeParticipantsWithMeeting,1);assert.deepEqual(one.meetingCoverage.activeParticipantIdsWithoutMeeting,[]);
 assert.equal(two.meetingCoverage.meetingCount,1);assert.deepEqual(two.meetingCoverage.activeParticipantIdsWithoutMeeting,['person']);assert.equal(two.meetingCoverage.meetingsWithoutActiveParticipants,1);
 f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run('["stakeholders:read","enrollments:read"]',f.issued.id);
 const restricted=(await f.read('client.stakeholder-map',{company:'client'})).data;
 assert.deepEqual(restricted.enrollments[0].meetingCoverage,{status:'unavailable',requiredScope:'meetings:read'});assert.equal(restricted.versions['ontology.engagement.v2'],undefined);f.sql.close();
});

test('capability discovery reports outbound read and write permissions separately and rechecks role and scopes',async()=>{
 const f=await fixture(['events:read','events:write']);try{
  const flags=async()=> (await f.read('capabilities',{company:'client'})).data.permissions.filter(p=>p.action==='configuracoes.editar');
  assert.deepEqual((await flags()).map(p=>p.allowed),[false,false]);
  f.write('ontology.workspace.v3',{extraMembers:[{id:'m',email:'m@example.com',access:'admin'}]});
  assert.deepEqual((await flags()).map(p=>[p.scope,p.allowed]),[['events:read',true],['events:write',true]]);
  f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['events:write']),f.issued.id);
  assert.deepEqual((await flags()).map(p=>p.allowed),[false,true]);
  const permissions=(await f.read('capabilities',{company:'client'})).data.permissions;
  assert.equal(permissions.find(p=>p.action==='clientes.ver'&&p.scope==='events:read').allowed,false);
 }finally{f.sql.close();}
});

test('discovery covers constituent commercial permissions even with enrollment-only scopes',async()=>{
 const f=await fixture(['enrollments:write']);try{
  let permissions=(await f.read('capabilities',{company:'client'})).data.permissions;
  assert.equal(permissions.find(p=>p.action==='stakeholders.editar'&&p.scope==='enrollments:write').allowed,true);
  assert.equal(permissions.find(p=>p.action==='stakeholders.editar'&&p.scope==='stakeholders:write').allowed,false);
  for(const [action,scope] of [['plano.editar','enrollments:write'],['alocacao.editar','clients:write'],['cliente.arquivar','clients:write'],['documentos.enviar','documents:write'],['clientes.ver','documents:read']]) assert.ok(permissions.some(p=>p.action===action&&p.scope===scope));
  f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['stakeholders:write']),f.issued.id);
  permissions=(await f.read('capabilities',{company:'client'})).data.permissions;
  assert.equal(permissions.find(p=>p.action==='stakeholders.editar'&&p.scope==='enrollments:write').allowed,false);
  assert.equal(permissions.find(p=>p.action==='stakeholders.editar'&&p.scope==='stakeholders:write').allowed,true);
 }finally{f.sql.close();}
});

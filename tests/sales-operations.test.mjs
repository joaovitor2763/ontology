import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeCommercialCommand } from '../src/server/operations/commercial.ts';
import { issueIntegrationCredential, integrationScopes } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
import { projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
async function fixture() {
 const f=sqliteD1();
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}));
 const product={id:'sale-product',name:'Produto',description:'',version:1,cycles:[{id:'model',name:'Ciclo',goal:'Resultado',durationDays:14,acceptance:['Aceito'],deliveries:[{id:'task',title:'Tarefa',description:'',day:3,hours:1}]}]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.catalog.v2',1,?)").run(JSON.stringify({extraProducts:[product,{...product,id:'other-product'}]}));
 const credential=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Vendas',ownerEmail:'admin@example.com',scopes:[...integrationScopes],expiresAt:new Date(Date.now()+3600000).toISOString()});
 const principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${credential.token}`}}),{DB:f.db});
 return {...f,principal,credential,run:(input,key=crypto.randomUUID())=>executeCommercialCommand(f.db,'default',principal,'sales.register',input,key),read:key=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body)};
}
const external=externalId=>({system:'crm',externalId});
const sale=()=>({
 client:{create:{slug:'sale-client',name:'Cliente da venda',startedAt:'2026-01-01'},externalReference:external('company-1')},
 externalReference:external('sale-1'),
 contacts:[{ref:'ana',stakeholder:{name:'Ana',role:'Diretora',primary:true},externalReference:external('contact-1')},{ref:'bruno',stakeholder:{name:'Bruno',role:'Gerente'}}],
 enrollments:[
  {ref:'first',productId:'sale-product',startsAt:'2026-02-01',externalReference:external('purchase-1'),participants:[{stakeholderRef:'ana',accountRole:'patrocinador',primary:true}]},
  {ref:'second',productId:'other-product',startsAt:'2026-04-01',participants:[{stakeholderRef:'ana',accountRole:'ponto-focal'},{stakeholderRef:'bruno',accountRole:'decisor',primary:true}]},
  {ref:'renewal',productId:'sale-product',startsAt:'2026-06-01',participants:[{stakeholderRef:'bruno',accountRole:'ponto-focal',primary:true}]},
 ],
});
test('one sale creates client, shared contacts and independent purchases atomically; external replay preserves IDs',async()=>{
 const f=await fixture(),input=sale(),first=await f.run(input,'first');
 assert.equal(first.data.enrollments.length,3);assert.equal(first.data.contacts.length,2);assert.deepEqual(first.documents,[]);
 const execution=projectDelivery(f.read('ontology.delivery.v2'),'sale-client');
 assert.equal(execution.cycles.length,3);assert.equal(new Set(execution.tasks.map(t=>t.id)).size,3);
 assert.deepEqual(execution.cycles.map(c=>c.startsAt).sort(),['2026-02-01','2026-04-01','2026-06-01']);
 const delivery=f.read('ontology.delivery.v2');
 assert.equal(delivery.companyJourney['sale-client'],first.data.enrollments[0].enrollment.planId);
 assert.equal(delivery.companyMilestone['sale-client'],1);
 assert.equal(Object.hasOwn(delivery.companyJourneyVersion,'sale-client'),false);
 const ana=first.data.contacts[0].stakeholder.id;
 assert.equal(first.data.enrollments[0].participants[0].stakeholderId,ana);
 assert.equal(first.data.enrollments[1].participants[0].stakeholderId,ana);
 assert.notEqual(first.data.enrollments[0].participants[0].accountRole,first.data.enrollments[1].participants[0].accountRole);
 assert.deepEqual(await f.run(input,'first'),JSON.parse(JSON.stringify(first)));
 assert.deepEqual(await f.run(input,'different-key'),JSON.parse(JSON.stringify(first)));
 assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='sale.registered'").get().n,1);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM external_references').get().n,4);
 const saleOnlyReferenced=first.data.enrollments[1].enrollment;
 await assert.rejects(executeCommercialCommand(f.db,'default',f.principal,'enrollments.remove',{company:'sale-client',enrollmentId:saleOnlyReferenced.id},'remove-sale-purchase'),/venda com referência de integração/);
 await assert.rejects(f.run({...input,enrollments:input.enrollments.slice(0,1)},'changed'),{code:'external_reference_conflict'});
 f.sql.close();
});
test('another sale reuses contact identity from its external reference without comparing whole sale hashes',async()=>{
 const f=await fixture(),first=await f.run(sale());
 const allocations=structuredClone(f.read('ontology.clients.v3').allocations);
 const next={client:{id:'sale-client',externalReference:external('company-1')},externalReference:external('sale-2'),contacts:[{ref:'shared',externalReference:external('contact-1')}],enrollments:[{ref:'new',productId:'other-product',startsAt:'2026-08-01',participants:[{stakeholderRef:'shared',accountRole:'tecnico'}]}]};
 const result=await f.run(next);
 assert.equal(result.data.contacts[0].stakeholder.id,first.data.contacts[0].stakeholder.id);
 assert.equal(f.read('ontology.stakeholders.v1').contacts.filter(c=>c.company==='sale-client').length,2);
 assert.equal(f.read('ontology.clients.v3').enrollments.length,4);
 assert.deepEqual(f.read('ontology.clients.v3').allocations,allocations);
 f.sql.close();
});
test('late validation and a database failure roll back every sale document, reference, receipt and event',async()=>{
 for(const databaseFailure of [false,true]) {
  const f=await fixture(),input=sale();
  if(databaseFailure) f.sql.exec("CREATE TRIGGER fail_sale_contact BEFORE INSERT ON state_documents WHEN NEW.key='ontology.stakeholders.v1' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  else input.enrollments.at(-1).participants=[{stakeholderId:'foreign-contact',accountRole:'outro'}];
  await assert.rejects(f.run(input,'failed'));
  assert.equal(f.sql.prepare("SELECT count(*) n FROM state_documents WHERE key IN ('ontology.clients.v3','ontology.delivery.v2','ontology.stakeholders.v1')").get().n,0);
  for(const table of ['operation_receipts','operation_events','external_references']) assert.equal(f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  f.sql.close();
 }
});
test('references never bind a foreign contact or reuse a previous purchase as a new sale',async()=>{
 const f=await fixture();await f.run(sale());
 const before=f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n;
 const other={...sale(),client:{create:{slug:'other-client',name:'Outro',startedAt:'2026-01-01'}},externalReference:external('different-sale'),contacts:[{ref:'ana',externalReference:external('contact-1')}],enrollments:[{ref:'new',productId:'sale-product',startsAt:'2026-01-01'}]};
 await assert.rejects(f.run(other),{code:'invalid_input'});
 await assert.rejects(f.run({client:{id:'sale-client'},enrollments:[{ref:'new',productId:'sale-product',startsAt:'2026-08-01',externalReference:external('purchase-1')}]}),{code:'external_reference_conflict'});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,before);
 f.sql.close();
});
test('saved sale replay rechecks every constituent scope before returning the receipt',async()=>{
 const f=await fixture(),input=sale();await f.run(input,'original');
 f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['clients:write']),f.credential.id);
 await assert.rejects(f.run(input,'original'),{code:'insufficient_scope'});
 await assert.rejects(f.run(input,'new-key'),{code:'insufficient_scope'});
 assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='sale.registered'").get().n,1);
 f.sql.close();
});
test('returned maps reflect primary changes within the same atomic sale',async()=>{
 const f=await fixture(),input=sale();input.contacts[1].stakeholder.primary=true;
 input.enrollments[0].participants.push({stakeholderRef:'bruno',primary:true,accountRole:'decisor'});
 const result=await f.run(input);
 assert.equal(result.data.contacts.filter(c=>c.stakeholder.primary).length,1);
 assert.equal(result.data.enrollments[0].participants.filter(p=>p.primary).length,1);
 assert.equal(result.data.contacts[1].stakeholder.primary,true);f.sql.close();
});
test('existing client sales preserve selected plan, progress and pin, including absent overrides',async()=>{
 for(const selected of [true,false]) {
  const f=await fixture();await f.run(sale());
  const before=f.read('ontology.delivery.v2');
  for(const field of ['companyJourney','companyMilestone','companyJourneyVersion']) delete before[field]['sale-client'];
  if(selected) {
   before.companyJourney['sale-client']=Object.keys(before.productPlans)[0];
   before.companyMilestone['sale-client']=3;
   before.companyJourneyVersion['sale-client']=2;
  }
  f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.delivery.v2'").run(JSON.stringify(before));
  const result=await f.run({client:{id:'sale-client'},enrollments:[{ref:'new',productId:'other-product',startsAt:'2027-01-01'}]});
  const after=f.read('ontology.delivery.v2');
  for(const field of ['companyJourney','companyMilestone','companyJourneyVersion']) assert.deepEqual(after[field],before[field]);
  assert.ok(after.productPlans[result.data.enrollments[0].enrollment.planId]);
  assert.equal(projectDelivery(after,'sale-client').cycles.length,4);
  f.sql.close();
 }
});
test('first sale for an existing client replaces a stale marker when there is no legacy work',async()=>{
 const f=await fixture();
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({extraClients:[{slug:'existing',name:'Existente',startedAt:'2026-01-01',leadId:'admin',csId:'admin',journeyId:'service-delivery'}],allocationsMigrated:true,allocations:[]}));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.delivery.v2',1,?)").run(JSON.stringify({companyJourney:{existing:'service-delivery'}}));
 const result=await f.run({client:{id:'existing'},enrollments:[{ref:'first',productId:'sale-product',startsAt:'2026-03-01'}]});
 assert.equal(f.read('ontology.delivery.v2').companyJourney.existing,result.data.enrollments[0].enrollment.planId);
 f.sql.close();
});
test('first sale with multiple purchases for an existing client preserves the selection for an explicit choice',async()=>{
 const f=await fixture();
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({extraClients:[{slug:'existing',name:'Existente',startedAt:'2026-01-01',leadId:'admin',csId:'admin',journeyId:'service-delivery'}],allocationsMigrated:true,allocations:[]}));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.delivery.v2',1,?)").run(JSON.stringify({companyJourney:{existing:'service-delivery'}}));
 await f.run({client:{id:'existing'},enrollments:[{ref:'first',productId:'sale-product',startsAt:'2026-03-01'},{ref:'second',productId:'other-product',startsAt:'2026-04-01'}]});
 assert.equal(f.read('ontology.delivery.v2').companyJourney.existing,'service-delivery');
 f.sql.close();
});
test('common sale validation rejects unknown nested fields before any writes',async()=>{
 for(const mutate of [
  input=>{input.contacts[0].stakeholder.accountRol='decisor';},
  input=>{input.contacts[0].externalReference.externalID='typo';},
  input=>{input.client.externalReference.externalID='typo';},
  input=>{input.enrollments[0].participants[0].accountRol='decisor';},
  input=>{delete input.enrollments[0].startsAt;},
 ]) {
  const f=await fixture(),input=sale();mutate(input);
  await assert.rejects(f.run(input),{code:'invalid_input'});
  assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM external_references').get().n,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM state_documents WHERE key='ontology.clients.v3'").get().n,0);
  f.sql.close();
 }
});

test('sale participants use enrollment write scope without granting permission to edit global contacts',async()=>{
 const f=await fixture();try{
  const first=await f.run(sale());
  f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['clients:write','enrollments:write','delivery:write']),f.credential.id);
  const next={client:{id:'sale-client'},enrollments:[{ref:'next',productId:'sale-product',startsAt:'2027-01-01',participants:[{stakeholderId:first.data.contacts[0].stakeholder.id,accountRole:'tecnico'}]}]};
  const result=await f.run(next,'scoped-sale');assert.equal(result.data.enrollments[0].participants[0].accountRole,'tecnico');
  assert.deepEqual(await f.run(next,'scoped-sale'),result);
  await assert.rejects(f.run({...next,contacts:[{ref:'new',stakeholder:{name:'Outro',role:'Diretor'}}]}),{code:'insufficient_scope'});
 }finally{f.sql.close();}
});

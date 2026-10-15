import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {acknowledgeAlert,acknowledgeAlertsBatch,readAlerts,projectAlerts,alertDocuments} from '../src/server/operations/alerts.ts';
import {countAlerts} from '../src/server/operations/alerts-count.ts';
import {acknowledgmentStatement,readAcknowledged} from '../src/server/operations/alert-acknowledgments.ts';
import {readPortfolioSummary} from '../src/server/operations/portfolio.ts';
import {readExecutionBoard} from '../src/server/operations/execution-board.ts';
import {readExecutionCycles} from '../src/server/operations/execution-cycles.ts';
import {readAlertQueue} from '../src/server/operations/alert-queue.ts';
import {searchTasks} from '../src/server/operations/search-tasks.ts';
import {clientProgress} from '../src/modules/delivery/application/progress.ts';
import {matchesRoute} from '../src/server/operations/route-table.ts';
import {projectClients} from '../src/modules/clients/infrastructure/snapshot.ts';
import {alerts} from '../src/modules/workspace/infrastructure/seed.ts';
import {protectOperationFields} from '../src/server/operations/legacy-state.ts';
import {can} from '../src/modules/workspace/domain/permissions.ts';
import {effectiveDeliveryRows} from '../src/server/delivery-effective.ts';
import {scheduledDeliverySnapshot} from '../src/modules/delivery/infrastructure/scheduled-state.ts';
import {normalizeDeliverySnapshot,projectDelivery} from '../src/modules/delivery/infrastructure/snapshot.ts';
import {createHash} from 'node:crypto';
test('alert acknowledgment validates client, is recorded for the person without touching the workspace document and reauthorizes replay',async()=>{
 const f=sqliteD1(),alert=alerts[0],actor={id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 const workspace={workspaceName:'Preservado',hidden:[],extraMembers:[{id:'admin',email:actor.email,access:'admin'}]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify(workspace));
 try{
 const env={DB:f.db},input={company:alert.company,alertId:alert.id};
 const result=await acknowledgeAlert(env,actor,input,'seen');assert.equal(result.data.acknowledged,true);
 assert.deepEqual(await acknowledgeAlert(env,actor,input,'seen'),result);
 assert.deepEqual(result.documents,[]);
 const row=f.sql.prepare("SELECT body,version FROM state_documents WHERE key='ontology.workspace.v3'").get(),saved=JSON.parse(row.body);
 assert.equal(row.version,1,'the workspace document is not written');
 assert.equal(saved.workspaceName,'Preservado');assert.deepEqual(saved.hidden,[]);
 assert.deepEqual(f.sql.prepare('SELECT workspace_id,member_id,company,alert_id FROM alert_acknowledgments').all().map(r=>({...r})),
  [{workspace_id:'default',member_id:'admin',company:alert.company,alert_id:alert.id}]);
 await assert.rejects(acknowledgeAlert(env,actor,{...input,alertId:'unknown'},'unknown'),{code:'alert_not_found'});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,1);
 assert.equal(f.sql.prepare("SELECT actor_id FROM client_audit_log WHERE command='alerts.acknowledge'").get().actor_id,'admin');
 // A lista compartilhada antiga continua fora do alcance dos escritores legados.
 const legacy={...saved,hidden:['archived-alert']};
 assert.throws(()=>protectOperationFields('ontology.workspace.v3',legacy,{hidden:[]}),{code:'operation_required'});
 assert.deepEqual(protectOperationFields('ontology.workspace.v3',legacy,{}).hidden,['archived-alert']);
 saved.extraMembers[0].access='leitor';f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(saved));
 await assert.rejects(acknowledgeAlert(env,actor,input,'seen'),{code:'permission_denied'});
 }finally{f.sql.close();}
});
test('acknowledgment is per person: what A marks leaves only A\'s queue, counter and summaries; the legacy shared list still hides for everyone',async()=>{
 const f=sqliteD1(),[first,second,third]=[alerts[0],alerts.find(a=>a.company!==alerts[0].company),alerts.find((a,i)=>i>0&&a.company===alerts[0].company)];
 const session=memberId=>({id:`member:${memberId}`,kind:'session',email:`${memberId}@example.test`,memberId,access:'admin',application:'web',scopes:null,companies:null,guards:[]});
 const a=session('ana'),b=session('bruno');
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
  .run(JSON.stringify({hidden:[third.id],extraMembers:[a,b].map(p=>({id:p.memberId,email:p.email,access:'admin'}))}));
 try{
  assert.ok(second&&third);
  const env={DB:f.db},ids=async(actor,company)=>(await readAlertQueue(env,actor,company)).data.map(row=>`${row.company}/${row.id}`);
  const before=(await countAlerts(env,a)).data.count;
  assert.equal((await countAlerts(env,b)).data.count,before);
  // O arquivo compartilhado antigo esconde para todos.
  for(const actor of [a,b])assert.ok(!(await ids(actor)).includes(`${third.company}/${third.id}`));
  await acknowledgeAlert(env,a,{company:first.company,alertId:first.id},'ana-first');
  assert.ok(!(await ids(a)).includes(`${first.company}/${first.id}`));
  assert.ok((await ids(b)).includes(`${first.company}/${first.id}`));
  assert.ok(!(await ids(a,first.company)).includes(`${first.company}/${first.id}`));
  assert.ok((await readAlerts(env,b,{company:first.company,limit:100})).data.some(row=>row.id===first.id));
  assert.ok(!(await readAlerts(env,a,{company:first.company,limit:100})).data.some(row=>row.id===first.id));
  // O contador é por pessoa, inclusive no cache.
  assert.equal((await countAlerts(env,a)).data.count,before-1);
  assert.equal((await countAlerts(env,b)).data.count,before);
  assert.equal((await countAlerts(env,a)).data.count,before-1);
  const [pa,pb]=[await readPortfolioSummary(env,a),await readPortfolioSummary(env,b)];
  assert.equal(pa.data[first.company].alertCount,pb.data[first.company].alertCount-1);
  // B marca o mesmo alerta e outro: os dois contam para B; o já arquivado para a equipe é indisponível.
  const input={alerts:[{company:first.company,alertId:first.id},{company:second.company,alertId:second.id},{company:third.company,alertId:third.id}]};
  const batch=await acknowledgeAlertsBatch(env,b,input,'bruno-batch');
  assert.deepEqual(batch.data,{acknowledged:2,unavailable:1});
  assert.deepEqual(await acknowledgeAlertsBatch(env,b,input,'bruno-batch'),batch,'replay returns the receipt');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='alerts.acknowledgeBatch'").get().n,2);
  assert.equal((await countAlerts(env,b)).data.count,before-2);
  assert.ok((await ids(a)).includes(`${second.company}/${second.id}`),'B\'s acknowledgment does not hide for A');
  // Marcar o que só existe no arquivo compartilhado confirma sem gravar linha nem evento.
  assert.equal((await acknowledgeAlert(env,a,{company:third.company,alertId:third.id},'ana-third')).data.acknowledged,true);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM alert_acknowledgments WHERE alert_id=?").get(third.id).n,0);
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.workspace.v3'").get().version,1);
 }finally{f.sql.close();}
});
test('a selection of 1000 acknowledgments is one statement with one JSON parameter',async()=>{
 const f=sqliteD1();
 try{
  const rows=Array.from({length:1000},(_,i)=>({company:`client-${i%7}`,alertId:`alert-${i}`}));
  const statement=acknowledgmentStatement(f.db,'default','ana',rows,'2026-09-28T00:00:00.000Z');
  await f.db.batch([statement,acknowledgmentStatement(f.db,'default','ana',rows.slice(0,3),'2026-09-28T01:00:00.000Z')]);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM alert_acknowledgments').get().n,1000);
  const read=await readAcknowledged(f.db,'default','ana');
  assert.equal(read.keys.size,1000);
  assert.equal(read.fingerprint,'1000:2026-09-28T00:00:00.000Z','INSERT OR IGNORE keeps the first acknowledgment');
  assert.equal((await readAcknowledged(f.db,'default','bruno')).keys.size,0);
 }finally{f.sql.close();}
});
test('acknowledgment follows client allocation and excludes read-only access',()=>{
 for(const access of ['admin','gestor'])assert.equal(can({access,memberId:'a'},'alertas.ciencia'),true);
 assert.equal(can({access:'ai_master',memberId:'a'},'alertas.ciencia',{responsibleIds:['a']}),true);
 assert.equal(can({access:'ai_master',memberId:'a'},'alertas.ciencia',{responsibleIds:['b']}),false);
 assert.equal(can({access:'leitor',memberId:'a'},'alertas.ciencia',{responsibleIds:['a']}),false);
});
test('batch acknowledgment spans clients in one write and replays without duplicate events',async()=>{
 const f=sqliteD1(),first=alerts[0],second=alerts.find(alert=>alert.company!==first.company),actor={id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
  .run(JSON.stringify({hidden:[],extraMembers:[{id:'admin',email:actor.email,access:'admin'}]}));
 try{
  assert.ok(second);
  const input={alerts:[{company:first.company,alertId:first.id},{company:second.company,alertId:second.id}]};
  const result=await acknowledgeAlertsBatch({DB:f.db},actor,input,'batch');
  assert.deepEqual(result.data,{acknowledged:2,unavailable:0});
  assert.deepEqual((await acknowledgeAlertsBatch({DB:f.db},actor,input,'batch')).data,result.data);
  const saved=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
  assert.deepEqual(saved.hidden,[]);
  assert.deepEqual(new Set(f.sql.prepare("SELECT company||'/'||alert_id AS k FROM alert_acknowledgments WHERE member_id='admin'").all().map(r=>r.k)),
   new Set([`${first.company}/${first.id}`,`${second.company}/${second.id}`]));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,2);
  // Uma nova tentativa com outra chave não conta de novo o que a pessoa já marcou.
  assert.deepEqual((await acknowledgeAlertsBatch({DB:f.db},actor,input,'batch-again')).data,{acknowledged:0,unavailable:2});
  assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,2);
  assert.equal(matchesRoute('POST','alerts/acknowledge'),true);
  const missing=await acknowledgeAlertsBatch({DB:f.db},actor,{alerts:[{company:first.company,alertId:'no-longer-active'}]},'missing');
  assert.deepEqual(missing.data,{acknowledged:0,unavailable:1});
 }finally{f.sql.close();}
});
test('batch acknowledgment refuses a client outside the current allocation without partial writes',async()=>{
 const f=sqliteD1(),first=alerts[0],second=alerts.find(alert=>alert.company!==first.company),actor={id:'member:operator',kind:'session',email:'operator@example.test',memberId:'operator',access:'ai_master',application:'web',scopes:null,companies:null,guards:[]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
  .run(JSON.stringify({hidden:[],extraMembers:[{id:'operator',email:actor.email,access:'ai_master'}]}));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)")
  .run(JSON.stringify({allocationsMigrated:true,allocations:[{id:'allocation-1',company:first.company,memberId:'operator',role:'responsavel',percent:100}]}));
 try{
  assert.ok(second);
  await assert.rejects(acknowledgeAlertsBatch({DB:f.db},actor,{alerts:[{company:first.company,alertId:first.id},{company:second.company,alertId:second.id}]},'denied'),{code:'permission_denied'});
  assert.equal(f.sql.prepare('SELECT count(*) n FROM alert_acknowledgments').get().n,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 }finally{f.sql.close();}
});
test('the alert counter reads the whole workspace queue, follows what was already seen and is a route of its own',async()=>{
 const f=sqliteD1(),alert=alerts[0],actor={id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
  .run(JSON.stringify({hidden:[],extraMembers:[{id:'admin',email:actor.email,access:'admin'}]}));
 try{
 const env={DB:f.db};
 // O caminho existe como rota própria: `alerts/count` não é `alerts` com sobra.
 assert.equal(matchesRoute('GET','alerts/count'),true);
 assert.equal(matchesRoute('POST','alerts/count'),false);
 const before=(await countAlerts(env,actor)).data.count;
 // A fila do workspace é a soma das filas por cliente, sem repetir alerta.
 const companies=projectClients({}).clients.map(c=>c.slug);
 const perClient=[];
 for(const company of companies)perClient.push(...(await readAlerts(env,actor,{company,limit:100})).data.map(a=>a.id));
 assert.equal(new Set(perClient).size,perClient.length);
 assert.equal(before,perClient.length);
 await acknowledgeAlert(env,actor,{company:alert.company,alertId:alert.id},'seen');
 assert.equal((await countAlerts(env,actor)).data.count,before-1);
 // Visualização conta só os clientes em que está alocada; sem alocação, zero.
 const saved=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
 saved.extraMembers[0].access='leitor';
 f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(saved));
 assert.equal((await countAlerts(env,{...actor,access:'leitor'})).data.count,0);
 }finally{f.sql.close();}
});

test('the global queue and the counter follow allocation for AI Master and Visualização',async()=>{
 const f=sqliteD1(),first=alerts[0],second=alerts.find(alert=>alert.company!==first.company);
 const session=(memberId,access)=>({id:`member:${memberId}`,kind:'session',email:`${memberId}@example.test`,memberId,access,application:'web',scopes:null,companies:null,guards:[]});
 const admin=session('admin','admin'),gestor=session('gestor','gestor'),master=session('operator','ai_master'),reader=session('reader','leitor'),idle=session('idle','ai_master');
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
  .run(JSON.stringify({hidden:[],extraMembers:[admin,gestor,master,reader,idle].map(p=>({id:p.memberId,email:p.email,access:p.access}))}));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)")
  .run(JSON.stringify({allocationsMigrated:true,allocations:[
   {id:'a1',company:first.company,memberId:'operator',role:'responsavel',percent:100},
   {id:'a2',company:first.company,memberId:'reader',role:'analista',percent:10},
   {id:'a3',company:second.company,memberId:'operator',role:'cs',percent:10,to:'2000-01-01'}]}));
 try{
  const env={DB:f.db};
  const everything=await readAlertQueue(env,admin);
  assert.equal(everything.scope,'all');
  assert.ok(everything.data.some(row=>row.company===second.company));
  assert.equal((await countAlerts(env,admin)).data.count,everything.data.length);
  assert.equal((await readAlertQueue(env,gestor)).data.length,everything.data.length);
  const own=(await readAlertQueue(env,admin,first.company)).data.map(row=>row.id);
  assert.ok(own.length>0);
  for(const actor of [master,reader]){
   const queue=await readAlertQueue(env,actor);
   assert.equal(queue.scope,'allocated');
   // Alocação encerrada não conta; só o cliente vigente entra na fila.
   assert.deepEqual(queue.data.map(row=>row.id),own);
   assert.equal((await countAlerts(env,actor)).data.count,own.length);
   // Navegação explícita: a fila de um cliente continua visível para quem vê clientes.
   const other=await readAlertQueue(env,actor,second.company);
   assert.equal(other.scope,'all');
   assert.ok(other.data.length>0&&other.data.every(row=>row.company===second.company));
  }
  // O cache do contador é por público: o recorte não vaza para quem vê tudo, e vice-versa.
  assert.equal((await countAlerts(env,admin)).data.count,everything.data.length);
  assert.equal((await countAlerts(env,idle)).data.count,0);
  assert.deepEqual((await readAlertQueue(env,idle)).data,[]);
  // A rota REST/MCP por cliente não muda.
  assert.ok((await readAlerts(env,idle,{company:second.company,limit:100})).data.length>0);
 }finally{f.sql.close();}
});
test('active alert list, count and acknowledgment use current client execution',async()=>{
 const f=sqliteD1(),company=alerts[0].company;
 const archived=projectClients({}).allClients.find(client=>client.slug!==company).slug;
 const actor={id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 const task={id:'active-alert-task',company,title:'Tarefa ativa',status:'fila',ownerId:'admin',
  dueAt:'2020-01-01',hours:1,workstream:'',milestone:1,completion:'checklist',comments:[],history:[]};
 const otherPlan={...task,id:'other-plan-search',title:'Plano divergente',
  dueAt:'2027-01-01',journeyId:'different-plan',kind:'journey'};
 const requestTask={...task,id:'request-only',title:'Solicitação fora da contagem',kind:'request'};
 const ordered=Array.from({length:9},(_,index)=>({...task,
  id:`search-order-${index}`,title:`Busca comum ${9-index}`,dueAt:'2027-01-01'}));
 const raw={extraTasks:[task,otherPlan,requestTask,...ordered]},plain=JSON.stringify(raw),incarnation=crypto.randomUUID();
 const clients=projectClients({}).allClients;
 for(const [key,value] of [['ontology.workspace.v3',{hidden:[],extraMembers:[{id:'admin',email:actor.email,access:'admin'}]}],
  ['ontology.clients.v3',{archivedClients:[archived]}],['ontology.delivery.v2',{}]])
  f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
   .run('default',key,JSON.stringify(value));
 f.sql.prepare("UPDATE state_documents SET body='not-json' WHERE key='ontology.delivery.v2'").run();
 const effective=effectiveDeliveryRows(raw,company);
 f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
  (workspace_id,generation,mode,source_delivery_version,source_clients_version,
   compatibility_version,expected_clients,expected_owners,expected_orphans,
   expected_array_order,expected_map_order,updated_at)
  VALUES('default','active-alerts','active',1,1,2,?,0,0,0,0,'2026-09-27')`).run(clients.length);
 f.sql.prepare(`INSERT INTO delivery_client_snapshots
  (workspace_id,generation,company,revision,body,body_sha256,incarnation)
  VALUES('default','active-alerts',?,1,?,?,?)`).run(company,plain,
   createHash('sha256').update(plain).digest('hex'),incarnation);
 for(const client of clients.filter(client=>client.slug!==company)){
  const body=client.slug===archived?JSON.stringify({extraCycles:[{id:'archived-cycle',company:archived,
   name:'Ciclo arquivado',goal:'',startsAt:'2026-09-01',endsAt:'2026-10-01',ownerId:'admin',
   status:'em-curso',taskIds:[],acceptance:[]}]}):'{}';
  f.sql.prepare(`INSERT INTO delivery_client_snapshots
   (workspace_id,generation,company,revision,body,body_sha256,incarnation)
   VALUES('default','active-alerts',?,1,?,?,?)`)
   .run(client.slug,body,createHash('sha256').update(body).digest('hex'),crypto.randomUUID());
 }
 raw.extraTasks.forEach((entry,ordinal)=>f.sql.prepare(`INSERT INTO delivery_client_array_order
  (workspace_id,generation,kind,id,ordinal,company)
  VALUES('default','active-alerts','extraTasks',?,?,?)`).run(entry.id,ordinal,company));
 f.sql.prepare(`INSERT INTO delivery_client_effective_heads
  (workspace_id,company,authority_generation,source_revision,source_incarnation,
   projection_generation,expected_tasks,expected_cycles,updated_at)
  VALUES('default',?,'active-alerts',1,?,'active-alerts',?,?,'2026-09-27')`)
  .run(company,incarnation,effective.tasks.length,effective.cycles.length);
 for(const row of effective.tasks)f.sql.prepare(`INSERT INTO delivery_effective_tasks
  (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,
   owner_id,milestone,kind,body) VALUES('default','active-alerts',?,?,?,?,?,?,?,?,?,?,?)`)
  .run(row.company,row.id,row.ordinal,row.enrollmentId,row.productId,row.status,row.dueAt,
   row.ownerId,row.milestone,row.kind,row.body);
 for(const row of effective.cycles)f.sql.prepare(`INSERT INTO delivery_effective_cycles
  (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,
   ends_at,body) VALUES('default','active-alerts',?,?,?,?,?,?,?,?,?)`)
  .run(row.company,row.id,row.ordinal,row.enrollmentId,row.productId,row.status,row.startsAt,
   row.endsAt,row.body);
 try{
  const env={DB:f.db},id='derived-entrega-atrasada-active-alert-task';
  const list=await readAlerts(env,actor,{company,limit:100});
  assert.ok(list.data.some(row=>row.id===id));
  const queue=await readAlertQueue(env,actor);
  assert.ok(queue.data.some(row=>row.id===id));
  assert.equal(queue.relatedTasks[`${company}\u0000${id}`]?.id,task.id);
  assert.ok((await readAlertQueue(env,actor,company)).data.every(row=>row.company===company));
  const portfolio=await readPortfolioSummary(env,actor);
  const board=await readExecutionBoard(env,actor);
  assert.equal(board.mode,'active');
  assert.ok(board.tasks.some(row=>row.id==='active-alert-task'));
  assert.ok(board.tasks.some(row=>row.id==='request-only'));
  assert.ok(!board.tasks.some(row=>row.id==='other-plan-search'),
   'the board uses the selected plan, unlike workspace-wide task search');
  assert.ok(board.referenceTasks.some(row=>row.id==='other-plan-search'),
   'creation can refer to a task from another plan of the same client');
  assert.ok(board.tasks.every(row=>!('history' in row)&&!('comments' in row)));
  assert.equal(board.compatibilityVersion,2);
  assert.equal(board.clientSnapshots[company],`active-alerts:${incarnation}:1`);
  assert.equal(Object.keys(board.clientSnapshots).length,clients.length);
  assert.deepEqual(await readExecutionBoard(env,actor,board.etag),
   {notModified:true,etag:board.etag});
  const globalCycles=await readExecutionCycles(env,actor);
  assert.equal(globalCycles.mode,'active');
  assert.ok(globalCycles.cycles.some(row=>row.id==='archived-cycle'),
   'the global cycle view retains archived clients');
  assert.ok(globalCycles.tasks.some(row=>row.id==='other-plan-search'),
   'calendar and cycle progress include tasks outside the selected plan');
  assert.ok(globalCycles.tasks.every(row=>!('history' in row)&&!('comments' in row)));
  assert.deepEqual(await readExecutionCycles(env,actor,globalCycles.etag),
   {notModified:true,etag:globalCycles.etag});
  assert.equal(portfolio.data[company].nextTask?.title,'Tarefa ativa');
  assert.equal(portfolio.data[company].health.flag,'red');
  const member=(await readPortfolioSummary(env,actor,'admin')).member;
  assert.equal(member.taskCount,10,'all open assigned work counts even without client allocation');
  assert.equal(member.hours,10);
  assert.equal(member.tasks.length,6);
  assert.deepEqual(member.tasks.map(row=>row.id),
   ['active-alert-task',...ordered.slice(0,5).map(row=>row.id)]);
  assert.deepEqual(member.alerts,[],'client allocation only scopes alerts');
  const allocatedMember=(await readPortfolioSummary(env,actor,'marina')).member;
  assert.ok(allocatedMember.alerts.some(row=>row.id===id));
  assert.equal(allocatedMember.clients[company].planned,portfolio.home.clients[company].planned);
  assert.equal(allocatedMember.clients[archived],undefined);
  assert.equal(portfolio.data[company].alertCount,queue.data.filter(row=>row.company===company).length);
  assert.equal(portfolio.data[archived].cycle?.name,'Ciclo arquivado');
  assert.equal(portfolio.data[archived].health,null);
  assert.equal(portfolio.home.clients[archived],undefined);
  const {docs,effective}=await alertDocuments(f.db,'default','ontology.workspace.v3');
  const projected=projectAlerts(docs,undefined,new Date().toISOString(),effective).executions.get(company);
  const expectedProgress=clientProgress(projected.tasks,projected.cycles,new Date().toISOString());
  assert.equal(portfolio.home.clients[company].planned,expectedProgress.planned.length);
  assert.equal(portfolio.home.clients[company].currentCycle?.id,expectedProgress.currentCycle?.id);
  assert.equal(portfolio.home.clients[company].nextTaskTitle,portfolio.data[company].nextTask?.title);
  assert.equal(Object.values(portfolio.home.taskCounts).reduce((sum,count)=>sum+count,0),
   Object.values(portfolio.home.clients).reduce((sum,row)=>sum+row.planned,0));
  assert.ok((await searchTasks(env,actor,'Tarefa ativa')).data.some(row=>row.id==='active-alert-task'));
  assert.ok((await searchTasks(env,actor,'Plano divergente')).data
   .some(row=>row.id==='other-plan-search'));
  assert.deepEqual((await searchTasks(env,actor,'Busca comum')).data.map(row=>row.id),
   ordered.slice(0,8).map(row=>row.id));
  assert.deepEqual((await searchTasks(env,actor,'')).data,[]);
  await assert.rejects(searchTasks(env,{...actor,kind:'integration'},'Tarefa'),{code:'session_required'});
  await assert.rejects(readPortfolioSummary(env,{...actor,kind:'credential'}),{code:'session_required'});
  await assert.rejects(readExecutionBoard(env,{...actor,kind:'integration'}),{code:'session_required'});
  await assert.rejects(readExecutionCycles(env,{...actor,kind:'integration'}),{code:'session_required'});
  const before=(await countAlerts(env,actor)).data.count;
  const prepare=f.db.prepare.bind(f.db);
  let sliceReads=0;
  f.db.prepare=sql=>{
   if(/^\s*SELECT (?:s\.)?company,(?:s\.)?revision,(?:s\.)?incarnation,(?:s\.)?body/.test(sql))sliceReads++;
   return prepare(sql);
  };
  assert.equal((await countAlerts(env,actor)).data.count,before);
  assert.equal(sliceReads,0);
  f.db.prepare=prepare;
  await acknowledgeAlert(env,actor,{company,alertId:id},'active-alert-ack');
  assert.equal((await countAlerts(env,actor)).data.count,before-1);
  assert.equal((await readPortfolioSummary(env,actor)).data[company].alertCount,
   queue.data.filter(row=>row.company===company).length-1);
  assert.ok(!(await readAlertQueue(env,actor)).data.some(row=>row.id===id));
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version,1);
  assert.ok((await searchTasks(env,actor,'Tarefa ativa')).data.some(row=>row.id==='active-alert-task'));
 }finally{f.sql.close();}
});

test('active alerts respect the assigned client plan after a plan switch',()=>{
 const company='santa-clara';
 const outdated={id:'old-plan-overdue',company,title:'Plano antigo',status:'fila',
  journeyId:'founding-companies',dueAt:'2020-01-01',hours:1,workstream:'',
  milestone:1,completion:'checklist',comments:[],history:[]};
 const raw={companyJourney:{[company]:'diagnostico-90'},extraTasks:[outdated]};
 const docs=[{value:{}},{value:raw},{value:{}},{value:{}},null,{value:{}}];
 const at='2026-09-27T12:00:00Z';
 const legacy=projectAlerts(docs,company,at);
 const active=projectAlerts([docs[0],null,...docs.slice(2)],company,at,
  {slices:[{company,raw}],heads:[],generation:'test',compatibilityVersion:1});
 assert.deepEqual(active.candidates.map(row=>row.id),legacy.candidates.map(row=>row.id));
 assert.ok(!active.candidates.some(row=>row.id==='derived-entrega-atrasada-old-plan-overdue'));
 assert.ok(effectiveDeliveryRows(raw,company).tasks.some(row=>row.id===outdated.id));
});

test('active alerts infer a purchased plan and its relative deadline',()=>{
 const company='new-client',enrollmentId='new-purchase';
 const raw={companyJourney:{[company]:'founding-companies'},extraTasks:[
  {id:'stale-plan',company,title:'Plano antigo',status:'fila',journeyId:'founding-companies',
   enrollmentId,dueAt:'2020-01-01',hours:1,workstream:'',milestone:1,completion:'checklist'},
  {id:'current-plan',company,title:'Plano atual',status:'fila',journeyId:'service-delivery',
   enrollmentId,dueAt:'2020-01-01',deadline:{mode:'client',offsetDays:2},
   hours:1,workstream:'',milestone:1,completion:'checklist'},
 ]};
 const clients={extraClients:[{slug:company,name:'Novo cliente',journeyId:'founding-companies',
  startedAt:'2026-08-01',status:'ativo'}],enrollments:[{id:enrollmentId,company,
  planId:'service-delivery',startsAt:'2026-09-01',status:'ativa'}]};
 const docs=[{value:clients},null,{value:{}},{value:{}},null,{value:{}}];
 const result=projectAlerts(docs,company,'2026-09-27T12:00:00Z',
  {slices:[{company,raw}],heads:[],generation:'test',compatibilityVersion:1});
 assert.ok(result.candidates.some(row=>row.id==='derived-entrega-atrasada-current-plan'));
 assert.ok(!result.candidates.some(row=>row.id==='derived-entrega-atrasada-stale-plan'));
 assert.equal(result.candidates.find(row=>row.id==='derived-entrega-atrasada-current-plan')?.openedAt,
  '2026-09-03');
 const scheduled=scheduledDeliverySnapshot(normalizeDeliverySnapshot(raw),
  {[company]:'2026-08-01'},{[enrollmentId]:'2026-09-01'});
 assert.equal(projectDelivery(scheduled,company,'service-delivery').tasks.find(row=>row.id==='current-plan')?.dueAt,
  '2026-09-03','the scoped task drawer must show the same purchase deadline as the alert');
});

test('canceled and archived execution remains stored but leaves both legacy and active operational alerts',()=>{
 const company='historical-purchase-client';
 const old={id:'old-blocked-task',company,title:'Histórico',status:'bloqueado',
  enrollmentId:'old',productId:'product',journeyId:'service-delivery',dueAt:'2020-01-01',
  hours:1,workstream:'',milestone:1,completion:'checklist'};
 const current={...old,id:'current-task',enrollmentId:'current',status:'fila',dueAt:'2026-10-10'};
 const oldCycle={id:'old-cycle',company,enrollmentId:'old',name:'Histórico',status:'planejado',
  startsAt:'2020-01-01',endsAt:'2020-01-02',taskIds:[old.id],acceptance:[]};
 const raw={extraTasks:[old,current],extraCycles:[oldCycle]};
 const clients={extraClients:[{slug:company,name:'Cliente',journeyId:'service-delivery',startedAt:'2026-09-01'}],
  enrollments:[{id:'old',company,planId:'service-delivery',status:'cancelada',archivedAt:'2026-09-01'},
   {id:'current',company,planId:'service-delivery',status:'ativa',startsAt:'2026-09-01'}]};
 const docs=[{value:clients},{value:raw},{value:{}},{value:{}},null,{value:{}}];
 const results=[projectAlerts(docs,company,'2026-10-05T12:00:00Z'),
  projectAlerts([docs[0],null,...docs.slice(2)],company,'2026-10-05T12:00:00Z',
   {slices:[{company,raw}],heads:[],generation:'test',compatibilityVersion:1})];
 for(const result of results){
  assert.deepEqual(result.executions.get(company).tasks.map(t=>t.id),[current.id]);
  assert.deepEqual(result.executions.get(company).cycles,[]);
  assert.ok(!result.candidates.some(alert=>alert.relatedDeliveryId===old.id||alert.relatedCycleId===oldCycle.id));
 }
 assert.equal(raw.extraTasks.length,2);
 assert.equal(raw.extraCycles.length,1);
});

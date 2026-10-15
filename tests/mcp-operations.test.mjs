import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { issueIntegrationCredential } from '../src/server/operations/credentials.ts';
import { mcpResponse } from '../src/server/operations/mcp.ts';
async function fixture(scopes=['clients:read','clients:write']) {
 const f=sqliteD1();
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}));
 const token=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'MCP',ownerEmail:'admin@example.com',scopes,expiresAt:new Date(Date.now()+3600000).toISOString()});
 return {...f,token:token.token};
}
for(const era of ['legacy','modern']) test(`official SDK interoperates with ${era} protocol, with fresh server every request`,async()=>{
 const f=await fixture();const requests=[];
 const transport=new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:{authorization:`Bearer ${f.token}`}},fetch:async(url,init)=>{
   const request=new Request(url,init);requests.push({session:request.headers.get('mcp-session-id'),body:request.method==='POST'?await request.clone().json():null});
   const result=await mcpResponse(request,{DB:f.db});assert.equal(result.headers.has('mcp-session-id'),false);return result;
 }});
 const client=new Client({name:'integration-test',version:'1'},{versionNegotiation:era==='modern'?{mode:{pin:'2026-07-28'}}:{mode:'legacy'}});
 await client.connect(transport);
 const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='clients_list'));assert.ok(!list.tools.some(t=>t.name==='meetings_create'));
 const result=await client.callTool({name:'clients_list',arguments:{limit:2}});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.data.length,2);
 assert.ok(requests.every(r=>!r.session));assert.ok(requests.length>=3);
 await client.close();f.sql.close();
});
test('MCP exposes cross-client allocation filters and compact relationship guidance',async()=>{
 const f=await fixture(['clients:read','workspace:read','enrollments:read']);
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({extraClients:[{slug:'alpha',name:'Alpha',leadId:'old',milestone:1}],allocationsMigrated:true,allocations:[{id:'a',company:'alpha',memberId:'admin',role:'responsavel',percent:30}],enrollments:[{id:'purchase',company:'alpha',productId:'product',milestone:2,status:'ativa'}]}));
 const transport=new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:{authorization:`Bearer ${f.token}`}},fetch:(url,init)=>mcpResponse(new Request(url,init),{DB:f.db})});
 const client=new Client({name:'relation-test',version:'1'});try{
  await client.connect(transport);
  const tools=(await client.listTools()).tools;
  assert.match(tools.find(tool=>tool.name==='clients_list').description,/legado/);
  const clients=await client.callTool({name:'clients_list',arguments:{memberId:'admin',role:'responsavel'}});
  assert.equal(clients.structuredContent.total,1);assert.equal(clients.structuredContent.data[0].milestone,undefined);assert.equal(clients.structuredContent.data[0].leadId,undefined);
  const allocations=await client.callTool({name:'allocations_list',arguments:{memberId:'admin',role:'responsavel'}});
  assert.equal(allocations.isError,undefined);assert.equal(allocations.structuredContent.totalClients,1);
  const enrollments=await client.callTool({name:'enrollments_list',arguments:{memberId:'admin',role:'responsavel',milestone:2}});
  assert.equal(enrollments.isError,undefined);assert.equal(enrollments.structuredContent.total,1);
  const context=await client.callTool({name:'clients_context',arguments:{company:'alpha'}});
  assert.equal(context.structuredContent.data.sections.enrollments[0].milestone,2);
 }finally{await client.close();f.sql.close();}
});
test('missing credentials and wrong origin never enter tool dispatch',async()=>{
 const f=await fixture();
 assert.equal((await mcpResponse(new Request('https://delivery.test/mcp'),{DB:f.db})).status,401);
 assert.equal((await mcpResponse(new Request('https://delivery.test/mcp',{headers:{authorization:`Bearer ${f.token}`,origin:'https://evil.test'}}),{DB:f.db})).status,403);
 f.sql.close();
});
test('SDK mutation is atomic and idempotent, emits a readable event and rejects a changed intent',async()=>{
 const f=await fixture(['clients:read','clients:write','delivery:write','events:read']);
 const transport=new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:{authorization:`Bearer ${f.token}`}},fetch:(url,init)=>mcpResponse(new Request(url,init),{DB:f.db})});
 const client=new Client({name:'mutation-test',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 await client.connect(transport);
 const args={idempotencyKey:'sdk-create',input:{client:{slug:'sdk-client',name:'Cliente SDK',startedAt:'2026-01-01'},config:{}}};
 const first=await client.callTool({name:'clients_create',arguments:args});assert.equal(first.isError,undefined,JSON.stringify(first));
 assert.deepEqual(JSON.parse(first.content[0].text),first.structuredContent,"text-only MCP clients retain the compact mutation result");
 const replay=await client.callTool({name:'clients_create',arguments:args});assert.deepEqual(replay.structuredContent,first.structuredContent);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE company='sdk-client'").get().n,1);
 const conflict=await client.callTool({name:'clients_create',arguments:{...args,input:{...args.input,client:{...args.input.client,name:'Changed'}}}});
 assert.equal(conflict.isError,true);assert.equal(conflict.structuredContent.error.code,'idempotency_conflict');
 const events=await client.callTool({name:'events_list',arguments:{company:'sdk-client'}});assert.equal(events.isError,undefined);assert.equal(events.structuredContent.data.length,1);
 await client.close();f.sql.close();
});

test('MCP changes a responsible with only company and memberId, with replay safety',async()=>{
 const f=await fixture(['workspace:read','workspace:write','clients:read']);
 const transport=new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:{authorization:`Bearer ${f.token}`}},fetch:(url,init)=>mcpResponse(new Request(url,init),{DB:f.db})});
 const client=new Client({name:'responsible-test',version:'1'});try{
  await client.connect(transport);
  assert.ok((await client.listTools()).tools.some(tool=>tool.name==='clients_set_responsible'));
  const args={idempotencyKey:'responsible-mcp',input:{company:'santa-clara',memberId:'admin'}};
  const result=await client.callTool({name:'clients_set_responsible',arguments:args});
  assert.equal(result.isError,undefined,JSON.stringify(result));
  const replay=await client.callTool({name:'clients_set_responsible',arguments:args});
  assert.deepEqual(replay.structuredContent,result.structuredContent);
  const rows=await client.callTool({name:'allocations_list',arguments:{company:'santa-clara'}});
  assert.equal(rows.structuredContent.data.find(row=>row.role==='responsavel'&&!row.enrollmentId).memberId,'admin');
  const filtered=await client.callTool({name:'clients_list',arguments:{clientResponsibleId:'admin'}});
  assert.ok(filtered.structuredContent.data.some(row=>row.slug==='santa-clara'));
  const removed=await client.callTool({name:'clients_set_responsible',arguments:{idempotencyKey:'remove-responsible',input:{company:'santa-clara',memberId:null}}});
  assert.equal(removed.isError,undefined,JSON.stringify(removed));
  const unassigned=await client.callTool({name:'clients_list',arguments:{clientResponsibleId:'__none__'}});
  assert.ok(unassigned.structuredContent.data.some(row=>row.slug==='santa-clara'));
  const invalid=await client.callTool({name:'clients_list',arguments:{productResponsibleId:'admin'}});
  assert.equal(invalid.isError,true);
 }finally{await client.close();f.sql.close();}
});

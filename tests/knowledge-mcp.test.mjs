import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { issueIntegrationCredential } from '../src/server/operations/credentials.ts';
import { apiResponse } from '../src/server/operations/http.ts';
import { mcpResponse } from '../src/server/operations/mcp.ts';

const node=(id,patch={})=>({id,label:id,kind:'instance',domain:'organizacao',elementType:'process',properties:[],...patch});
async function fixture(scopes=['knowledge:read','knowledge:write'],companies=['alpha']) {
  const f=sqliteD1();
  const put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(value));
  put('ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'}]});
  put('ontology.clients.v3',{extraClients:[{slug:'alpha',name:'Alpha'},{slug:'beta',name:'Beta'}]});
  const credential=await issueIntegrationCredential(f.db,'default','admin@example.test',{name:'Mapa',ownerEmail:'admin@example.test',scopes,companies,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const env={DB:f.db},headers={authorization:`Bearer ${credential.token}`,'content-type':'application/json'};
  const client=new Client({name:'knowledge-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers},fetch:(url,init)=>mcpResponse(new Request(url,init),env)}));
  const request=(path,method='GET',body,key=crypto.randomUUID())=>{
    const url=new URL(`https://delivery.test/api/v1/${path}`);
    return apiResponse(new Request(url,{method,headers:{...headers,'Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})}),env,url.pathname.slice('/api/v1/'.length).split('/'));
  };
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;};
  return {...f,client,call,request,close:async()=>{await client.close();f.sql.close();}};
}

test('MCP exposes native node/edge schemas and builds a complete map without UI discovery',async()=>{
  const f=await fixture();try {
    const tools=(await f.client.listTools()).tools;
    const schema=tools.find(t=>t.name==='knowledge_elements_save').inputSchema.properties.input.properties.node;
    assert.equal(schema.additionalProperties,false);
    assert.ok(schema.required.includes('properties'));
    assert.deepEqual(schema.properties.kind.enum,['class','instance']);
    assert.ok(schema.properties.elementType.enum.includes('process'));
    const empty=await f.call('knowledge_get',{company:'alpha'});
    assert.equal(empty.data.counts.elements,0);assert.ok(!('ontology' in empty.data));assert.ok(!('draft' in empty.data));
    const input={company:'alpha',expectedVersion:0,domains:[{id:'operacao',label:'Operação',color:'#64748b'}],nodes:[node('alpha-process',{domain:'operacao',ownerId:'alpha-person',source:'Reunião confirmada'}),node('alpha-person',{elementType:'person'})],edges:[{id:'alpha-edge',from:'alpha-person',to:'alpha-process',label:'executa'}]};
    const args={idempotencyKey:'build-map',input};
    const built=await f.call('knowledge_graph_upsert',args);
    assert.deepEqual(built.data.counts,{elements:2,connections:1,domains:2});assert.equal(built.data.version,1);
    assert.ok(!('ontology' in built.data));assert.ok(!('draft' in built.data));
    assert.deepEqual(await f.call('knowledge_graph_upsert',args),built);
    const detail=await f.call('knowledge_element_get',{company:'alpha',nodeId:'alpha-process',expectedVersion:1});
    assert.equal(detail.data.ownerId,'alpha-person');assert.equal(detail.data.source,'Reunião confirmada');
    const renamed=await f.call('knowledge_elements_save',{idempotencyKey:'rename',input:{company:'alpha',node:{...detail.data,label:'Processo revisado'},expectedVersion:1}});
    assert.equal(renamed.data.version,2);assert.deepEqual(renamed.data.affected.elements.ids,['alpha-process']);
    const connection=await f.call('knowledge_connection_get',{company:'alpha',edgeId:'alpha-edge'});assert.equal(connection.data.from,'alpha-person');
    const api=await (await f.request('openapi.json')).json();
    assert.ok(api.paths['/knowledge/{company}/graph/upsert']);assert.ok(api.paths['/knowledge/{company}/domains']);
    const legacy=await (await f.request('knowledge/alpha')).json();assert.equal(legacy.data.ontology.nodes.length,2);assert.ok(legacy.data.draft);
    const noDraft=await (await f.request('knowledge/alpha?view=full&includeDraft=false')).json();assert.ok(!('draft' in noDraft.data));
  }finally{await f.close();}
});

test('large maps have bounded reads/writes, filtered pagination and revision-bound cursors',async()=>{
  const f=await fixture();try {
    for(let block=0;block<3;block++) {
      const nodes=Array.from({length:100},(_,i)=>node(`alpha-${block*100+i}`,{label:`Operação ${block*100+i}`,description:'x'.repeat(1000),properties:['y'.repeat(1000)],elementType:i%2?'process':'system'}));
      const saved=await f.call('knowledge_graph_upsert',{idempotencyKey:`block-${block}`,input:{company:'alpha',nodes,expectedVersion:block}});
      assert.ok(JSON.stringify(saved).length<5000);assert.equal(saved.data.affected.elements.count,100);assert.equal(saved.data.affected.elements.truncated,true);
    }
    const summary=await f.call('knowledge_get',{company:'alpha'});assert.equal(summary.data.counts.elements,300);assert.ok(JSON.stringify(summary).length<2000);
    const first=await f.call('knowledge_elements_list',{company:'alpha',q:'Operação',elementType:'process',limit:7});
    assert.equal(first.total,150);assert.equal(first.data.length,7);assert.ok(first.nextCursor);assert.ok(!('description' in first.data[0]));
    const second=await f.call('knowledge_elements_list',{company:'alpha',q:'Operação',elementType:'process',limit:7,cursor:first.nextCursor,expectedVersion:first.snapshotVersion});
    assert.equal(new Set([...first.data,...second.data].map(n=>n.id)).size,14);
    const changedFilter=await f.request(`knowledge/alpha/elements?cursor=${encodeURIComponent(first.nextCursor)}`);assert.equal(changedFilter.status,422);
    const full=await f.call('knowledge_elements_list',{company:'alpha',limit:1,view:'full'});assert.equal(full.data[0].description.length,1000);
    await f.call('knowledge_domains_save',{idempotencyKey:'domain',input:{company:'alpha',domain:{id:'organizacao',label:'Organização revisada',color:'#000000'},expectedVersion:3}});
    assert.equal((await f.call('knowledge_domains_list',{company:'alpha'})).data[0].label,'Organização revisada');
    const stale=await f.request(`knowledge/alpha/elements?q=Opera%C3%A7%C3%A3o&elementType=process&cursor=${encodeURIComponent(first.nextCursor)}`);assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'snapshot_changed');
    for(const query of ['limit=0','limit=101','limit=abc','expectedVersion=','cursor=garbage','unknown=true'])assert.equal((await f.request(`knowledge/alpha/elements?${query}`)).status,422,query);
  }finally{await f.close();}
});

test('batch validation is atomic, additive, scoped and rejects stale or removed references',async()=>{
  const f=await fixture();try {
    const original=await f.call('knowledge_elements_save',{idempotencyKey:'first',input:{company:'alpha',node:node('alpha-existing')}});
    const invalid=await f.request('knowledge/alpha/graph/upsert','POST',{domains:[{id:'new',label:'Novo',color:'#000000'}],nodes:[node('alpha-new')],edges:[{id:'bad',from:'alpha-new',to:'missing',label:'liga'}],responseMode:'compact'},'invalid');
    assert.equal(invalid.status,422);
    const graph=await (await f.request('knowledge/alpha')).json();assert.equal(graph.data.version,original.data.version);assert.equal(graph.data.ontology.nodes.length,1);assert.equal(graph.data.ontology.domains.length,1);
    assert.equal((await f.request('knowledge/alpha/graph/upsert','POST',{nodes:[node('alpha-new')],expectedVersion:0})).status,409);
    assert.equal((await f.request('knowledge/alpha/graph/upsert','POST',{nodes:[node('duplicate'),node('duplicate')]})).status,422);
    assert.equal((await f.request('knowledge/alpha/graph/upsert','POST',{})).status,422);
    assert.equal((await f.request('knowledge/beta/graph/upsert','POST',{nodes:[node('beta-new')]})).status,403);
    const valid=await f.request('knowledge/alpha/graph/upsert','POST',{nodes:[node('alpha-new')],responseMode:'compact',expectedVersion:1},'additive');assert.equal(valid.status,200);
    assert.equal((await valid.json()).data.counts.elements,2);
    await f.call('knowledge_elements_remove',{idempotencyKey:'remove',input:{company:'alpha',nodeId:'alpha-new'}});
    assert.equal((await f.request('knowledge/alpha/graph/upsert','POST',{nodes:[node('alpha-new')]})).status,422);
    assert.equal((await f.request('knowledge/alpha/graph/upsert/extra','POST',{})).status,404);
    assert.equal((await f.request('knowledge/alpha/elements/id/extra')).status,404);
  }finally{await f.close();}
  const reader=await fixture(['knowledge:read']);try {
    assert.ok(!(await reader.client.listTools()).tools.some(t=>t.name==='knowledge_graph_upsert'));
    assert.equal((await reader.request('knowledge/alpha/graph/upsert','POST',{nodes:[node('alpha-new')]})).status,403);
  }finally{await reader.close();}
});

test('bulk relationship edits validate the final graph and reject duplicate relations atomically',async()=>{
  const f=await fixture();try {
    await f.call('knowledge_graph_upsert',{idempotencyKey:'relations-start',input:{company:'alpha',nodes:[node('alpha-a'),node('alpha-b')],edges:[{id:'alpha-e1',from:'alpha-a',to:'alpha-b',label:'produz'},{id:'alpha-e2',from:'alpha-a',to:'alpha-b',label:'consome'}]}});
    await f.call('knowledge_graph_upsert',{idempotencyKey:'relations-swap',input:{company:'alpha',edges:[{id:'alpha-e1',from:'alpha-a',to:'alpha-b',label:'consome'},{id:'alpha-e2',from:'alpha-a',to:'alpha-b',label:'produz'}]}});
    const before=await f.call('knowledge_get',{company:'alpha'});
    const rejected=await f.client.callTool({name:'knowledge_graph_upsert',arguments:{idempotencyKey:'relations-duplicate',input:{company:'alpha',nodes:[node('alpha-a',{label:'Must not persist'})],edges:[{id:'alpha-e1',from:'alpha-a',to:'alpha-b',label:'produz'}]}}});
    assert.equal(rejected.isError,true);
    const malformed=await f.request('knowledge/alpha/graph/upsert','POST',{edges:[{id:'alpha-e1',from:'alpha-a',to:'alpha-b',label:'produz'},{id:'alpha-e3',from:'alpha-a',to:'alpha-b',label:42}]});
    assert.equal(malformed.status,422);
    assert.equal((await f.call('knowledge_get',{company:'alpha'})).data.version,before.data.version);
    assert.equal((await f.call('knowledge_element_get',{company:'alpha',nodeId:'alpha-a'})).data.label,'alpha-a');
  }finally{await f.close();}
});

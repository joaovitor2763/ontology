import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
// The library's class-handler branch is unused on the Next Node host.
registerHooks({resolve(specifier,context,next){return specifier==='cloudflare:workers'?{url:new URL('../src/server/operations/oauth-worker-entrypoint.ts',import.meta.url).href,shortCircuit:true}:next(specifier,context);}});
const {oauthResponse,oauthEnvironment,oauthOptions,resolveOAuthIdentity,validateOAuthGrant,OAUTH_GUARD}=await import('../src/server/operations/oauth.ts');
const {getOAuthApi}=await import('@cloudflare/workers-oauth-provider');
const {resolveOperationPrincipal,authorizeOperation}=await import('../src/server/operations/principal.ts');
const {mcpResponse}=await import('../src/server/operations/mcp.ts');
const {Client,StreamableHTTPClientTransport}=await import('@modelcontextprotocol/client');
const origin='https://delivery.test';
async function fixture(){
 const f=sqliteD1();f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}));
 const env={DB:f.db,AUTH_MODE:'dev',AUTH_ORIGIN:origin,DEV_USER_EMAIL:'admin@example.com',DEV_USER_NAME:'Pessoa'};
 const providerEnv=oauthEnvironment(env),helpers=getOAuthApi(oauthOptions(origin),providerEnv);
 const client=await helpers.createClient({clientName:'Teste',redirectUris:['http://localhost:8765/callback'],tokenEndpointAuthMethod:'none',grantTypes:['authorization_code','refresh_token'],responseTypes:['code']});
 return {...f,env,providerEnv,helpers,client};
}
async function authorize(f,scope='clients:read',includeResource=true){
 const verifier='a'.repeat(64),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const url=new URL(origin+'/oauth/authorize');url.search=new URLSearchParams({client_id:f.client.clientId,redirect_uri:f.client.redirectUris[0],response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:origin+'/mcp',scope,state:'state-1'}).toString();
 if(!includeResource) url.searchParams.delete('resource');
 const consent=await oauthResponse(new Request(url),f.env),body=await consent.text();assert.equal(consent.status,200,body);
 const cookie=consent.headers.get('set-cookie').split(';')[0],nonce=cookie.split('=')[1];
 assert.match(body,/Autorizar Teste/);assert.match(body,/Autorizar acesso/);
 const approve=()=>oauthResponse(new Request(origin+'/oauth/authorize',{method:'POST',headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams([['nonce',nonce],['decision','allow'],...scope.split(' ').map(value=>['scope',value])])}),f.env);
 return {verifier,url,cookie,nonce,approve};
}
async function issue(f,scope='clients:read'){
 const flow=await authorize(f,scope),approved=await flow.approve();assert.equal(approved.status,302,await approved.clone().text());
 const callback=new URL(approved.headers.get('location'));assert.equal(callback.searchParams.get('state'),'state-1');
 const token=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:f.client.clientId,redirect_uri:f.client.redirectUris[0],code:callback.searchParams.get('code'),code_verifier:flow.verifier,resource:origin+'/mcp'})}),f.env);
 const result=await token.json();assert.equal(token.status,200,JSON.stringify(result));return result;
}
test('OAuth discovery and DCR use provider metadata; PKCE S256 and resource are enforced',async()=>{
 const f=await fixture();const metadata=await oauthResponse(new Request(origin+'/.well-known/oauth-authorization-server'),f.env);
 assert.deepEqual((await metadata.json()).code_challenge_methods_supported,['S256']);
 const flow=await authorize(f);const plain=new URL(flow.url);plain.searchParams.set('code_challenge_method','plain');assert.equal((await oauthResponse(new Request(plain),f.env)).status,400);
 const alien=new URL(flow.url);alien.searchParams.set('resource','https://other.test/mcp');assert.equal((await oauthResponse(new Request(alien),f.env)).status,400);
 const registration=await oauthResponse(new Request(origin+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Cliente registrado',redirect_uris:['http://localhost:6789/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})}),f.env);
 assert.equal(registration.status,201,await registration.clone().text());f.sql.close();
});
test('consent binds browser, member and requested scopes; no automatic authorization',async()=>{
 const f=await fixture(),flow=await authorize(f);
 assert.equal((await f.helpers.listUserGrants('default.admin')).items.length,0);
 const bad=await oauthResponse(new Request(origin+'/oauth/authorize',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce:flow.nonce,decision:'allow',scope:'clients:read'})}),f.env);assert.equal(bad.status,403);
 const escalation=await oauthResponse(new Request(origin+'/oauth/authorize',{method:'POST',headers:{origin,cookie:flow.cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce:flow.nonce,decision:'allow',scope:'clients:write'})}),f.env);assert.equal(escalation.status,400);
 assert.equal((await flow.approve()).status,302);assert.equal((await flow.approve()).status,403);f.sql.close();
});
test('personal OAuth principal enforces scopes and durable grant revocation even with cached token data',async()=>{
 const f=await fixture(),issued=await issue(f),request=new Request(origin+'/api/v1/clients',{headers:{authorization:`Bearer ${issued.access_token}`}});
 const principal=await resolveOperationPrincipal(request,f.env);assert.equal(principal.kind,'oauth');assert.equal(principal.memberId,'admin');
 await authorizeOperation(f.db,'default',principal,{action:'clientes.ver',scope:'clients:read'});
 await assert.rejects(authorizeOperation(f.db,'default',principal,{action:'clientes.criar',scope:'clients:write'}),{code:'insufficient_scope'});
 const durable=JSON.parse(JSON.stringify(principal));assert.ok(durable.oauthGrant);assert.equal(JSON.stringify(durable).includes(issued.access_token),false);
 await f.providerEnv.OAUTH_KV.delete(`grant:${principal.oauthGrant.userId}:${principal.oauthGrant.grantId}`);
 assert.ok(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(OAUTH_GUARD).version>=1);
 await assert.rejects(resolveOAuthIdentity(request,f.env),{code:'invalid_token'});
 await assert.rejects(validateOAuthGrant(f.db,'default',durable.oauthGrant),{code:'invalid_token'});f.sql.close();
});
test('OAuth rejects inactive members and bootstrap; KV data is isolated per workspace',async()=>{
 const f=await fixture(),issued=await issue(f),request=new Request(origin+'/mcp',{headers:{authorization:`Bearer ${issued.access_token}`}});
 await assert.rejects(resolveOAuthIdentity(request,{...f.env,WORKSPACE_ID:'other'}),{code:'invalid_token'});
 f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.workspace.v3'").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}],deactivatedIds:['admin']}));
 await assert.rejects(resolveOAuthIdentity(request,f.env),{code:'inactive_member'});
 f.sql.prepare("UPDATE state_documents SET body='{}' WHERE key='ontology.workspace.v3'").run();
 const flow=new URL(origin+'/oauth/authorize');flow.search=new URLSearchParams({client_id:f.client.clientId,redirect_uri:f.client.redirectUris[0],response_type:'code',code_challenge:'x'.repeat(43),code_challenge_method:'S256',scope:'clients:read'}).toString();
 assert.equal((await oauthResponse(new Request(flow),f.env)).status,403);f.sql.close();
});
test('provider rejects a wrong PKCE verifier and permits refresh without widening scopes',async()=>{
 const f=await fixture(),flow=await authorize(f),approved=await flow.approve(),code=new URL(approved.headers.get('location')).searchParams.get('code');
 const failed=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:f.client.clientId,redirect_uri:f.client.redirectUris[0],code,code_verifier:'b'.repeat(64),resource:origin+'/mcp'})}),f.env);
 assert.equal(failed.status,400);assert.equal((await failed.json()).error,'invalid_grant');
 const issued=await issue(f);
 const refreshed=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:f.client.clientId,refresh_token:issued.refresh_token,resource:origin+'/mcp'})}),f.env);
 const token=await refreshed.json();assert.equal(refreshed.status,200,JSON.stringify(token));
 const identity=await resolveOAuthIdentity(new Request(origin+'/api/v1/clients',{headers:{authorization:`Bearer ${token.access_token}`}}),f.env);
 assert.deepEqual(identity.scopes,['clients:read']);f.sql.close();
});
test('official MCP SDK dispatch forwards personal OAuth to REST under the canonical resource',async()=>{
 const f=await fixture(),issued=await issue(f);
 const transport=new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${issued.access_token}`}},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)});
 const client=new Client({name:'oauth-sdk-test',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 await client.connect(transport);
 const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='clients_list'));assert.ok(!tools.tools.some(t=>t.name==='clients_create'));
 const result=await client.callTool({name:'clients_list',arguments:{limit:1}});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.data.length,1);
 await client.close();f.sql.close();
});

test('clients omitting resource still receive canonical Delivery audience on code exchange and refresh',async()=>{
 const f=await fixture(),flow=await authorize(f,'clients:read',false),approved=await flow.approve();
 assert.equal(approved.status,302);
 const code=new URL(approved.headers.get('location')).searchParams.get('code');
 const exchange=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:f.client.clientId,redirect_uri:f.client.redirectUris[0],code,code_verifier:flow.verifier})}),f.env);
 assert.equal(exchange.status,200);const issued=await exchange.json();
 assert.equal(issued.resource,origin+'/mcp');
 const identity=await resolveOAuthIdentity(new Request(origin+'/mcp',{headers:{authorization:`Bearer ${issued.access_token}`}}),f.env);
 assert.equal(identity.memberId,'admin');assert.deepEqual(identity.scopes,['clients:read']);
 const refreshed=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:f.client.clientId,refresh_token:issued.refresh_token})}),f.env);
 assert.equal(refreshed.status,200);const token=await refreshed.json();assert.equal(token.resource,origin+'/mcp');
 const next=await resolveOAuthIdentity(new Request(origin+'/api/v1/clients',{headers:{authorization:`Bearer ${token.access_token}`}}),f.env);
 assert.deepEqual(next.scopes,['clients:read']);
 const wrong=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:f.client.clientId,refresh_token:token.refresh_token,resource:'https://other.test/mcp'})}),f.env);
 assert.equal(wrong.status,400);assert.equal((await wrong.json()).error,'invalid_target');f.sql.close();
});

test('personal OAuth MCP synchronizes RSVP through the same REST command without adopting the Google etag',async t=>{
 const f=await fixture(),issued=await issue(f,'meetings:write'),{seal}=await import('../src/server/google.ts'),{apiResponse}=await import('../src/server/operations/http.ts');
 const env={...f.env,GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:crypto.randomUUID(),GOOGLE_TOKEN_KEY:crypto.randomUUID()};
 f.sql.prepare("INSERT INTO google_connections(workspace_id,user_email,account_email,scopes,refresh_token_enc,created_at,updated_at) VALUES('default',?,?,?,?,?,?)").run('admin@example.com','admin@example.com','calendar',await seal(env.GOOGLE_TOKEN_KEY,crypto.randomUUID()),'now','now');
 const meeting={id:'rsvp-meeting',company:'santa-clara',title:'Reunião',startsAt:'2027-01-01T12:00:00Z',durationMin:30,attendeeIds:[],actions:[],decisions:[],notes:'Notas preservadas',summary:'',kind:'alinhamento',organizerEmail:'admin@example.com',google:{eventId:'fixture-event',calendarId:'primary',organizer:'admin@example.com',etag:'original-revision'}};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.engagement.v2',1,?)").run(JSON.stringify({extraMeetings:[meeting]}));
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{if(String(url).includes('oauth2.googleapis.com/token'))return Response.json({access_token:crypto.randomUUID()});assert.match(String(url),/^https:\/\/www.googleapis.com\/calendar\/v3\//);calls++;return Response.json({etag:'externally-changed',status:'confirmed',attendees:[{email:'guest@example.test',responseStatus:'accepted'}]});};
 t.after(()=>{globalThis.fetch=original;});
 const client=new Client({name:'rsvp-oauth-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${issued.access_token}`}},fetch:(url,init)=>mcpResponse(new Request(url,init),env)}));
  assert.ok((await client.listTools()).tools.some(t=>t.name==='meetings_sync_responses'));
  const args={idempotencyKey:'rsvp',input:{meetingId:meeting.id}};
  const result=await client.callTool({name:'meetings_sync_responses',arguments:args});assert.ok(!result.isError,JSON.stringify(result));
  assert.equal(result.structuredContent.data.meeting.google.responses['guest@example.test'],'accepted');assert.equal(result.structuredContent.data.meeting.google.etag,'original-revision');
  assert.deepEqual((await client.callTool({name:'meetings_sync_responses',arguments:args})).structuredContent,result.structuredContent);
  const alias=await apiResponse(new Request(origin+'/api/v1/meetings/rsvp-meeting/sync-responses',{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':'other-call'},body:'{}'}),env,['meetings','rsvp-meeting','sync-responses']);
  assert.equal(alias.status,200,await alias.clone().text());assert.equal((await alias.json()).data.meeting.notes,'Notas preservadas');assert.equal(calls,1);
 }finally{await client.close();f.sql.close();}
});

test('personal OAuth exposes artifact sync only with document scope and dispatches through REST alias',async t=>{
 const f=await fixture(),limited=await issue(f,'meetings:write');
 const {seal}=await import('../src/server/google.ts'),{apiResponse}=await import('../src/server/operations/http.ts');
 const objects=new Map();
 const env={...f.env,GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:crypto.randomUUID(),GOOGLE_TOKEN_KEY:crypto.randomUUID(),FILES:{
  async get(key){const value=objects.get(key);return value===undefined?null:{text:async()=>String(value),json:async()=>JSON.parse(String(value)),arrayBuffer:async()=>new TextEncoder().encode(String(value)).buffer};},
  async put(key,value){objects.set(key,typeof value==='string'?value:new TextDecoder().decode(value));return {key};},
  async head(key){return objects.has(key)?{key}:null;},
 }};
 f.sql.prepare("INSERT INTO google_connections(workspace_id,user_email,account_email,scopes,refresh_token_enc,created_at,updated_at) VALUES('default',?,?,?,?,?,?)").run('admin@example.com','admin@example.com','meet',await seal(env.GOOGLE_TOKEN_KEY,crypto.randomUUID()),'now','now');
 const meeting={id:'artifacts-meeting',company:'santa-clara',title:'Reunião',startsAt:'2026-01-01T12:00:00Z',durationMin:30,attendeeIds:[],actions:[],decisions:[],notes:'Notas preservadas',summary:'',kind:'alinhamento',organizerEmail:'admin@example.com',google:{eventId:'fixture-event',meetLink:'https://meet.google.com/abc-defg-hij',calendarId:'primary',organizer:'admin@example.com',etag:'original-revision'}};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.engagement.v2',1,?)").run(JSON.stringify({extraMeetings:[meeting]}));
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{if(String(url).includes('oauth2.googleapis.com/token'))return Response.json({access_token:crypto.randomUUID()});assert.match(String(url),/^https:\/\/meet.googleapis.com\/v2\/conferenceRecords/);calls++;return Response.json({conferenceRecords:[]});};
 t.after(()=>{globalThis.fetch=original;});
 const clients=[];
 async function connect(token){const client=new Client({name:'artifacts-oauth-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${token}`}},fetch:(url,init)=>mcpResponse(new Request(url,init),env)}));return client;}
 try{
  const restricted=await connect(limited.access_token);assert.ok(!(await restricted.listTools()).tools.some(t=>t.name==='meetings_sync_artifacts'));
  const denied=await apiResponse(new Request(origin+'/api/v1/meetings/artifacts-meeting/sync-artifacts',{method:'POST',headers:{authorization:`Bearer ${limited.access_token}`,'content-type':'application/json','idempotency-key':'denied'},body:'{}'}),env,['meetings','artifacts-meeting','sync-artifacts']);assert.equal(denied.status,403);assert.equal(calls,0);
  const issued=await issue(f,'meetings:write documents:write');
  const client=await connect(issued.access_token);assert.ok((await client.listTools()).tools.some(t=>t.name==='meetings_sync_artifacts'));
  const args={idempotencyKey:'artifacts',input:{meetingId:meeting.id}};
  const result=await client.callTool({name:'meetings_sync_artifacts',arguments:args});assert.ok(!result.isError,JSON.stringify(result));
  assert.equal(result.structuredContent.data.meeting.notes,'Notas preservadas');assert.equal(result.structuredContent.data.meeting.google.artifactStatus,'not_generated');
  assert.deepEqual((await client.callTool({name:'meetings_sync_artifacts',arguments:args})).structuredContent,result.structuredContent);
  const alias=await apiResponse(new Request(origin+'/api/v1/meetings/artifacts-meeting/sync-artifacts',{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':'other-artifacts-call'},body:'{}'}),env,['meetings','artifacts-meeting','sync-artifacts']);assert.equal(alias.status,200,await alias.clone().text());assert.equal(calls,1);
 }finally{for(const client of clients)await client.close();f.sql.close();}
});

test('connected apps JSON lists current grants and revokes through the same CSRF-protected flow',async()=>{
 const f=await fixture();try{
 const issued=await issue(f);
 const response=await oauthResponse(new Request(origin+'/oauth/grants?format=json'),f.env),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.endpoint,origin+'/mcp');assert.equal(body.data.length,1);assert.deepEqual(body.data[0].scopes,['clients:read']);assert.equal(JSON.stringify(body).includes(issued.access_token),false);
 const post=headers=>oauthResponse(new Request(origin+'/oauth/grants?format=json',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams({nonce:body.nonce,grant:body.data[0].id})}),f.env);
 assert.equal((await post({origin})).status,403);
 const headers={origin,cookie:response.headers.get('set-cookie').split(';')[0]};
 assert.equal((await post(headers)).status,200);assert.equal((await post(headers)).status,403);
 const empty=await oauthResponse(new Request(origin+'/oauth/grants?format=json'),f.env);assert.deepEqual((await empty.json()).data,[]);
 await assert.rejects(resolveOAuthIdentity(new Request(origin+'/mcp',{headers:{authorization:'Bearer '+issued.access_token}}),f.env),{code:'invalid_token'});
 }finally{f.sql.close();}
});

test('omitted OAuth scope requires a consent access choice and preserves it on refresh',async()=>{
 const {integrationScopes}=await import('../src/server/operations/credentials.ts');
 for(const access of ['read','operate']){
  const f=await fixture();
  try{
   const flow=await authorize(f,'');
   const submit=value=>oauthResponse(new Request(origin+'/oauth/authorize',{method:'POST',headers:{origin,cookie:flow.cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce:flow.nonce,decision:'allow',...(value?{access:value}:{})})}),f.env);
   assert.equal((await submit()).status,400);
   assert.equal((await submit('invalid')).status,400);
   assert.equal((await f.helpers.listUserGrants('default.admin')).items.length,0);
   const approved=await submit(access);assert.equal(approved.status,302,await approved.clone().text());
   const code=new URL(approved.headers.get('location')).searchParams.get('code');
   const exchange=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:f.client.clientId,redirect_uri:f.client.redirectUris[0],code,code_verifier:flow.verifier})}),f.env);
   const token=await exchange.json();assert.equal(exchange.status,200,JSON.stringify(token));
   const expected=integrationScopes.filter(s=>access==='operate'||s.endsWith(':read'));
   assert.deepEqual(token.scope.split(' '),expected);
   const refresh=await oauthResponse(new Request(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:f.client.clientId,refresh_token:token.refresh_token})}),f.env);
   assert.equal(refresh.status,200);assert.deepEqual((await refresh.json()).scope.split(' '),expected);
  }finally{f.sql.close();}
 }
});

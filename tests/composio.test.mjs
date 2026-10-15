import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { configSave,configGet,safeRedirect,READ_TOOLS,executeRead,seal,toolkit,originAllowed,canConfigureComposio,createAuthLink,readJsonBounded,setupManagedAuth } from "../src/server/composio.ts";

test("Composio stores credentials encrypted and returns only safe config metadata",async()=>{
 const {db,sql}=sqliteD1();const env={DB:db,INTEGRATION_SECRET_KEY:"test-key-for-encryption-at-least-32-characters"};
 await configSave(env,"w1","comp_test_01234567890123456789",{gmail:"auth_gmail_123"});
 const raw=sql.prepare("SELECT api_key_enc FROM composio_settings WHERE workspace_id=?").get("w1").api_key_enc;
 assert.equal(raw.includes("comp_test"),false);
 assert.deepEqual(await configGet(env,"w1"),{configured:true,apiKeyHint:"••••••••",authConfigs:{gmail:"auth_gmail_123"},updatedAt:sql.prepare("SELECT updated_at FROM composio_settings WHERE workspace_id=?").get("w1").updated_at});
 assert.equal((await configGet(env,"w2")).configured,false);
});
test("connected account lookup is scoped by workspace, member and toolkit",async()=>{
 const {db}=sqliteD1();await db.prepare("INSERT INTO composio_connections VALUES(?,?,?,?,?,?,?)").bind("w","member-a","gmail","acct-a","ACTIVE","now","now").run();
 const own=(workspace,member,tool)=>db.prepare("SELECT connected_account_id FROM composio_connections WHERE workspace_id=? AND member_id=? AND toolkit_slug=?").bind(workspace,member,tool).first();
 assert.equal((await own("w","member-a","gmail")).connected_account_id,"acct-a");
 assert.equal(await own("w","member-b","gmail"),null);
 assert.equal(await own("other","member-a","gmail"),null);
});
test("admin policy and mutation origin checks are deny-by-default",()=>{assert.equal(canConfigureComposio("admin"),true);for(const role of ["gestor","ai_master","leitor",undefined])assert.equal(canConfigureComposio(role),false);assert.equal(originAllowed(new Request("https://app.test/api",{headers:{origin:"https://app.test"}})),true);assert.equal(originAllowed(new Request("https://app.test/api",{headers:{origin:"https://evil.test"}})),false);assert.equal(originAllowed(new Request("https://app.test/api")),false);});
test("redirects reject non-HTTPS and untrusted hosts",()=>{
 assert.equal(safeRedirect("https://connect.composio.dev/abc"),"https://connect.composio.dev/abc");
 for(const value of ["http://connect.composio.dev","https://evil.test","javascript:alert(1)","not url"])assert.equal(safeRedirect(value),null);
});
test("hosted connect-link uses server-derived user id and configured auth only",async()=>{const sealed=await seal("x","secret-api-key");const rows={api_key_enc:sealed,auth_configs:JSON.stringify({gmail:"authcfg_123"})};const env={DB:{prepare(){return{bind(){return this},first:async()=>rows}}},INTEGRATION_SECRET_KEY:"x"};const old=globalThis.fetch;let sent;globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({redirect_url:"https://connect.composio.dev/session/abc",connected_account_id:"ca-123"});};try{const link=await createAuthLink(env,"workspace-1","ontology:workspace-1:member-7","https://app.test","gmail");assert.equal(sent.user_id,"ontology:workspace-1:member-7");assert.equal(sent.auth_config_id,"authcfg_123");assert.equal(link.redirect,"https://connect.composio.dev/session/abc");}finally{globalThis.fetch=old;}});
test("Composio response bodies are size-bounded",async()=>{await assert.rejects(readJsonBounded(new Response("123456789"),4),/limite/);assert.deepEqual(await readJsonBounded(Response.json({ok:true})),{ok:true});});
test("read uses only an allowlisted action and server-discovered explicit version",async()=>{
 const calls=[];const sealed=await seal("x","api-key-test");const env={DB:{prepare(){return{bind(){return this},first:async()=>({api_key_enc:sealed,auth_configs:"{}"})}}},INTEGRATION_SECRET_KEY:"x"};
 const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{calls.push([String(url),init]);if(String(url).includes("/tools/") && !String(url).includes("/tools/execute/"))return Response.json({slug:READ_TOOLS.gmail.slug,version:"20250905_00",input_parameters:{properties:{max_results:{},query:{}}}});return Response.json({successful:true,data:{messages:[]}})};
 try{assert.deepEqual(await executeRead(env,"w","gmail","acct","uid"),{messages:[]});const body=JSON.parse(calls[1][1].body);assert.equal(body.version,"20250905_00");assert.equal(body.connected_account_id,"acct");assert.equal(String(calls[1][0]).includes("GMAIL_FETCH_EMAILS"),true);assert.equal(toolkit("arbitrary"),false);}finally{globalThis.fetch=original;}
});

test('managed auth setup creates only missing configs and persists confirmed IDs without exposing the key',async()=>{
 const {db,sql}=sqliteD1();const env={DB:db,INTEGRATION_SECRET_KEY:'test-key-for-encryption-at-least-32-characters'};
 await configSave(env,'w','comp_test_01234567890123456789',{gmail:'existing-gmail',googlecalendar:'',outlook:''});
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);assert.equal(body.auth_config.type,'use_composio_managed_auth');return Response.json({auth_config:{id:`managed-${body.toolkit.slug}`}});};
 try{await setupManagedAuth(env,'w');await setupManagedAuth(env,'w');assert.equal(calls.length,2);assert.equal((await configGet(env,'w')).authConfigs.outlook,'managed-outlook');assert.equal(sql.prepare('SELECT api_key_enc FROM composio_settings').get().api_key_enc.includes('comp_test'),false);}finally{globalThis.fetch=original;}
});
test('saving advanced settings can retain a stored key; managed setup never retries an uncertain creation automatically',async()=>{
 const {db}=sqliteD1();const env={DB:db,INTEGRATION_SECRET_KEY:'test-key-for-encryption-at-least-32-characters'};
 await configSave(env,'w','comp_test_01234567890123456789',{gmail:'manual-gmail'});await configSave(env,'w','',{gmail:'manual-gmail'});
 const old=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;throw new Error('network interrupted');};
 try{await assert.rejects(setupManagedAuth(env,'w'));assert.equal(count,1);assert.equal((await configGet(env,'w')).authConfigs.gmail,'manual-gmail');}finally{globalThis.fetch=old;}
});
test('Outlook mail reads select only the server allowlist and bound schema properties',async()=>{
 const sealed=await seal('x','api-key-test');const env={DB:{prepare(){return{bind(){return this},first:async()=>({api_key_enc:sealed,auth_configs:'{}'})}}},INTEGRATION_SECRET_KEY:'x'};
 const old=globalThis.fetch;let executed;
 globalThis.fetch=async(url,init)=>{if(!String(url).includes('/execute/'))return Response.json({slug:'OUTLOOK_LIST_MESSAGES',version:'20250905_00',input_parameters:{properties:{top:{},user_id:{}}}});executed={url:String(url),body:JSON.parse(init.body)};return Response.json({successful:true,data:{messages:[]}});};
 try{await executeRead(env,'w','outlook','owned-account','member','mail');assert.ok(executed.url.endsWith('/OUTLOOK_LIST_MESSAGES'));assert.deepEqual(executed.body.arguments,{top:10,user_id:'me'});}finally{globalThis.fetch=old;}
});

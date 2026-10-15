import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {saveZApiConfig,zApiPublicConfig,receiveZApi,zApiHistory,zApiMessagePage,normalizeChannel,parseZApiMessage,readRequestJson,zApiGroup,pruneZApi,testZApi} from '../src/server/z-api.ts';
import {zApiAdmin} from '../src/server/z-api-access.ts';
const key='local-test-key-with-at-least-32-characters';
const input={instanceId:'instance-test',instanceToken:'private-instance-token',clientToken:'private-client-token',enabled:true,mappings:[{channel:'5511999999999',company:'client-one'}]};
async function fixture(){const {db,sql}=sqliteD1();const env={DB:db,WORKSPACE_ID:'w',INTEGRATION_SECRET_KEY:key};await saveZApiConfig(env,input);const config=await zApiPublicConfig(env,'https://app.test');return {env,db,sql,config,secret:config.webhookUrl.split('/').at(-1)};}
const payload=(extra={})=>({instanceId:'instance-test',type:'ReceivedCallback',phone:'5511999999999',messageId:'message-one',momment:Date.parse('2026-09-01T12:00:00Z'),senderName:'Pessoa demonstrativa',fromMe:false,text:{message:'Mensagem sintética'},...extra});
test('Z-API encrypts tokens; public admin config only reveals its separate webhook URL',async()=>{const f=await fixture();const raw=f.sql.prepare('SELECT * FROM z_api_settings').get();assert.equal(raw.credentials_enc.includes(input.instanceToken),false);assert.equal(raw.webhook_secret_enc.includes(f.secret),false);assert.equal(JSON.stringify(f.config).includes(input.clientToken),false);assert.equal(f.config.enabled,true);assert.equal(f.config.retentionDays,90);assert.deepEqual(await zApiGroup(f.db,'w','client-one'),{id:'z-api:5511999999999'});assert.equal(await zApiGroup(f.db,'other','client-one'),null);await saveZApiConfig(f.env,{...input,instanceToken:'',clientToken:''});assert.equal((await zApiPublicConfig(f.env,'https://app.test')).webhookUrl,f.config.webhookUrl);});
test('invalid secret, instance and disabled state reject capture; unrelated channels are not stored',async()=>{const f=await fixture();assert.equal((await receiveZApi(f.env,'a'.repeat(64),payload())).status,403);assert.equal((await receiveZApi(f.env,f.secret,payload({instanceId:'wrong'}))).status,403);assert.equal((await receiveZApi(f.env,f.secret,payload({phone:'5511888888888'}))).accepted,false);assert.equal(f.sql.prepare('SELECT count(*) n FROM z_api_messages').get().n,0);await saveZApiConfig(f.env,{...input,enabled:false});assert.equal((await receiveZApi(f.env,f.secret,payload())).status,403);});
test('capture is deduplicated, scoped, and includes messages sent by the connected number',async()=>{const f=await fixture();assert.equal((await receiveZApi(f.env,f.secret,payload())).accepted,true);await receiveZApi(f.env,f.secret,payload());await receiveZApi(f.env,f.secret,payload({messageId:'sent',fromMe:true,momment:Date.parse('2026-09-01T12:01:00Z')}));assert.equal(f.sql.prepare('SELECT count(*) n FROM z_api_messages').get().n,2);const page=await zApiHistory(f.env,'5511999999999');assert.equal(page.messages.length,2);assert.equal(page.messages[1].fromMe,true);assert.equal((await zApiHistory({...f.env,WORKSPACE_ID:'other'},'5511999999999').catch(()=>({messages:[]}))).messages.length,0);});
test('changing conversation ownership never reveals messages belonging to the former client',async()=>{const f=await fixture();await receiveZApi(f.env,f.secret,payload());await saveZApiConfig(f.env,{...input,mappings:[{channel:'5511999999999',company:'client-two'}]});assert.equal((await zApiHistory(f.env,'5511999999999')).messages.length,0);await receiveZApi(f.env,f.secret,payload({messageId:'new-owner'}));assert.equal((await zApiHistory(f.env,'5511999999999')).messages[0].id,'new-owner');});
test('history and job imports use stable timestamp/id pagination and bounded pages',async()=>{const f=await fixture();for(let i=0;i<55;i++)await receiveZApi(f.env,f.secret,payload({messageId:String(i).padStart(3,'0')}));const one=await zApiHistory(f.env,'5511999999999');assert.equal(one.messages.length,50);assert.ok(one.nextCursor);const two=await zApiHistory(f.env,'5511999999999',JSON.parse(one.nextCursor));assert.equal(two.messages.length,5);assert.equal(new Set([...one.messages,...two.messages].map(m=>m.id)).size,55);const imports=await zApiMessagePage(f.env,'5511999999999',{since:'2026-09-01T00:00:00Z',until:'2026-09-02T00:00:00Z',at:'2026-09-01T12:00:00Z',id:'052'});assert.deepEqual(imports.map(m=>m.id),['053','054']);});
test('payload normalization rejects invalid dates, ignores events and never stores media URLs',()=>{assert.equal(normalizeChannel('+55 (11) 99999-9999'),'5511999999999');assert.equal(normalizeChannel('120363047916699348-group'),'120363047916699348@g.us');assert.equal(normalizeChannel("x' OR 1=1"),null);assert.equal(parseZApiMessage(payload({momment:'bad'})),null);assert.equal(parseZApiMessage(payload({type:'DeliveryCallback'})),null);const media=parseZApiMessage(payload({text:undefined,image:{imageUrl:'https://private.test/image'}}));assert.equal(media.text.includes('private.test'),false);assert.match(media.text,/Mídia não arquivada/);assert.equal(parseZApiMessage(payload({text:{message:'x'.repeat(20000)}})).text.length,16000);});
test('request bodies are bounded before parsing; retention removes old captures',async()=>{await assert.rejects(readRequestJson(new Response('x'.repeat(100)),20),/body_too_large/);const f=await fixture();await receiveZApi(f.env,f.secret,payload());f.sql.prepare('UPDATE z_api_messages SET received_at=?').run('2000-01-01T00:00:00Z');await pruneZApi(f.env);assert.equal(f.sql.prepare('SELECT count(*) n FROM z_api_messages').get().n,0);});
test('configuration routes require an active admin and same-origin mutation',async()=>{const {db,sql}=sqliteD1();sql.prepare('INSERT INTO workspaces VALUES(?,?,?)').run('w','test',new Date().toISOString());sql.prepare('INSERT INTO state_documents(workspace_id,key,body,version,updated_at,updated_by) VALUES(?,?,?,?,?,?)').run('w','ontology.workspace.v3',JSON.stringify({extraMembers:[{id:'a',email:'admin@example.test',access:'admin'},{id:'r',email:'reader@example.test',access:'leitor'}]}),1,new Date().toISOString(),'test');const env={DB:db,WORKSPACE_ID:'w',AUTH_MODE:'dev',DEV_USER_EMAIL:'admin@example.test'};assert.equal('error' in await zApiAdmin(new Request('http://localhost/api/z-api/config',{method:'PUT'}),env,true),true);assert.equal('error' in await zApiAdmin(new Request('http://localhost/api/z-api/config',{method:'PUT',headers:{origin:'http://localhost'}}),env,true),false);assert.equal((await zApiAdmin(new Request('http://localhost/api/z-api/config'),{...env,DEV_USER_EMAIL:'reader@example.test'})).error.status,403);});
test('instance checks use secrets only on the server and return only safe booleans',async()=>{const f=await fixture();const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('https://api.z-api.io/instances/'));assert.equal(init.headers['Client-Token'],input.clientToken);return Response.json({connected:true,smartphoneConnected:true,token:'must-not-escape'});};try{assert.deepEqual(await testZApi(f.env),{connected:true,smartphoneConnected:true});}finally{globalThis.fetch=original;}});

test('authorized WhatsApp API cache is partitioned by client when a Z-API channel is reassigned',async()=>{
 const {apiResponse}=await import('../src/server/operations/http.ts');
 const {issueIntegrationCredential}=await import('../src/server/operations/credentials.ts');
 const {db,sql}=sqliteD1();const env={DB:db,INTEGRATION_SECRET_KEY:key};
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'}]}));
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,'{}')").run();
 await saveZApiConfig(env,{...input,mappings:[{channel:'5511999999999',company:'santa-clara'}]});
 const config=await zApiPublicConfig(env,'https://app.test');await receiveZApi(env,config.webhookUrl.split('/').at(-1),payload());
 const credential=await issueIntegrationCredential(db,'default','admin@example.test',{name:'Test',ownerEmail:'admin@example.test',scopes:['engagement:read'],expiresAt:new Date(Date.now()+600000).toISOString()});
 const read=company=>apiResponse(new Request('https://app.test/api/v1/whatsapp/messages?company='+company,{headers:{authorization:'Bearer '+credential.token}}),env,['whatsapp','messages']);
 const first=await read('santa-clara');assert.equal(first.status,200,await first.clone().text());assert.equal((await first.json()).data.messages.length,1);
 await saveZApiConfig(env,{...input,mappings:[{channel:'5511999999999',company:'banco-litoral'}]});
 const second=await read('banco-litoral');assert.equal(second.status,200,await second.clone().text());assert.equal((await second.json()).data.messages.length,0);
});

test('Z-API preserves image/video captions alongside text and allowlisted metadata',()=>{
 for(const type of ['image','video']){
  const message=parseZApiMessage(payload({text:{message:'Contexto separado'},[type]:{caption:'Legenda sintética',mimeType:type+'/TEST; parameter=discard',width:600,height:315,seconds:13,[type+'Url']:'https://private.test/never-store',thumbnailUrl:'https://private.test/thumbnail'}}));
  assert.equal(message.attachment.type,type);assert.equal(message.attachment.caption,'Legenda sintética');
  assert.equal(message.attachment.mimeType,type+'/test');assert.equal(message.attachment.width,600);
  assert.match(message.text,/Contexto separado/);assert.match(message.text,/Legenda sintética/);
  assert.equal(JSON.stringify(message).includes('private.test'),false);
 }
});
test('Z-API normalizes document filenames, voice-note durations and sticker types',()=>{
 const doc=parseZApiMessage(payload({text:undefined,document:{fileName:'../../pasta/relatório.pdf',title:'Relatório de exemplo',pageCount:3,caption:'Revisão necessária',mimeType:'application/pdf',documentUrl:'https://private.test/document',token:'never-store'}}));
 assert.deepEqual(doc.attachment,{type:'document',caption:'Revisão necessária',fileName:'relatório.pdf',title:'Relatório de exemplo',mimeType:'application/pdf',pageCount:3});
 assert.match(doc.text,/relatório.pdf/);assert.match(doc.text,/Revisão necessária/);
 const audio=parseZApiMessage(payload({text:undefined,audio:{seconds:10,ptt:true,mimeType:'audio/ogg; codecs=opus',audioUrl:'https://private.test/audio'}}));
 assert.deepEqual(audio.attachment,{type:'audio',mimeType:'audio/ogg',durationSeconds:10,isVoiceNote:true});assert.match(audio.text,/10s/);
 const sticker=parseZApiMessage(payload({text:undefined,sticker:{mimeType:'image/webp',stickerUrl:'https://private.test/sticker'}}));
 assert.deepEqual(sticker.attachment,{type:'sticker',mimeType:'image/webp'});
 assert.equal(JSON.stringify([doc,audio,sticker]).includes('private.test'),false);
});
test('Z-API metadata rejects malformed fields and bounds natural-language descriptions',()=>{
 const bad=parseZApiMessage(payload({text:undefined,audio:{caption:'a'.repeat(10000),fileName:'x'.repeat(1000),title:{bad:true},mimeType:'bad mime',seconds:-2,ptt:'true',width:Infinity,height:0,pageCount:1.5,thumbnailUrl:'ignored'}}));
 assert.equal(bad.attachment.caption.length,8000);assert.equal(bad.attachment.fileName.length,255);
 for(const field of ['title','mimeType','durationSeconds','isVoiceNote','width','height','pageCount'])assert.equal(field in bad.attachment,false);
 assert.equal(parseZApiMessage(payload({text:undefined,image:'not-an-object'})),null);
 assert.equal(parseZApiMessage(payload({text:undefined,image:[]})),null);
 assert.equal(parseZApiMessage(payload({text:undefined,image:null})),null);
 assert.equal(parseZApiMessage(payload({text:undefined,image:{caption:'Legenda\u0000\u202e ok'}})).attachment.caption,'Legenda ok');
 assert.equal(parseZApiMessage(payload()).attachment,undefined);
});
test('Z-API metadata survives history and job imports without URLs or duplicate overwrite',async()=>{
 const f=await fixture();const event=payload({text:undefined,image:{caption:'Legenda original',mimeType:'image/jpeg',imageUrl:'https://private.test/image',thumbnailUrl:'https://private.test/thumb',unknown:{secret:'never-store'}}});
 await receiveZApi(f.env,f.secret,event);await receiveZApi(f.env,f.secret,{...event,image:{caption:'Não substituir'}});
 const history=(await zApiHistory(f.env,'5511999999999')).messages[0];
 const jobs=await zApiMessagePage(f.env,'5511999999999',{since:'2026-09-01T00:00:00Z',until:'2026-09-02T00:00:00Z'});
 assert.deepEqual(jobs[0].attachment,history.attachment);assert.equal(history.attachment.caption,'Legenda original');
 const stored=JSON.stringify(f.sql.prepare('SELECT * FROM z_api_messages').all());
 for(const excluded of ['private.test','never-store','thumbnailUrl','unknown','imageUrl'])assert.equal(stored.includes(excluded),false);
 await saveZApiConfig(f.env,{...input,mappings:[{channel:'5511999999999',company:'client-two'}]});
 assert.equal((await zApiHistory(f.env,'5511999999999')).messages.length,0);
});
test('additive Z-API migration preserves existing captured messages without inventing metadata',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync}=await import('node:fs');const sql=new DatabaseSync(':memory:');
 try{
  sql.exec(readFileSync('migrations/0045_z_api.sql','utf8'));
  sql.prepare('INSERT INTO z_api_messages VALUES(?,?,?,?,?,?,?,?,?,?)').run('w','instance','old','channel','client','2026-09-01T00:00:00Z','Pessoa','Texto antigo',0,'2026-09-01T00:00:00Z');
  sql.exec(readFileSync('migrations/0046_z_api_attachment_metadata.sql','utf8'));
  const old=sql.prepare('SELECT body,attachment_json FROM z_api_messages').get();assert.equal(old.body,'Texto antigo');assert.equal(old.attachment_json,null);
  assert.throws(()=>sql.prepare('UPDATE z_api_messages SET attachment_json=?').run('not-json'));
 }finally{sql.close();}
});

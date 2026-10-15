import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyAccessIdentity, googleSessionApproved, authenticate } from '../src/server/auth.ts';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';

const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), kid: 'access-test', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });
const env = { AUTH_MODE: 'access', CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', CF_ACCESS_AUD: 'test-audience' };
const sign = (extra = {}, issuer = env.CF_ACCESS_TEAM_DOMAIN, audience = env.CF_ACCESS_AUD, expiry = '5m') => new SignJWT({ email: 'Admin@Example.com', name: 'Admin', ...extra })
 .setProtectedHeader({ alg: 'RS256', kid: 'access-test' }).setIssuer(issuer).setAudience(audience).setSubject('user-id').setIssuedAt().setExpirationTime(expiry).sign(pair.privateKey);

test('Access validates issuer, audience, signature, expiry and email without trusting headers', async () => {
 assert.deepEqual(await verifyAccessIdentity(await sign(), env, keys), { email: 'admin@example.com', name: 'Admin' });
 await assert.rejects(verifyAccessIdentity(await sign({}, 'https://attacker.cloudflareaccess.com'), env, keys));
 await assert.rejects(verifyAccessIdentity(await sign({}, undefined, 'other'), env, keys));
 await assert.rejects(verifyAccessIdentity(await sign({}, undefined, undefined, '-1s'), env, keys));
 await assert.rejects(verifyAccessIdentity(await sign({ email: 'invalid' }), env, keys));
 await assert.rejects(verifyAccessIdentity(await sign(), { ...env, CF_ACCESS_TEAM_DOMAIN: 'http://127.0.0.1' }, keys));
 const other = await generateKeyPair('RS256');
 const forged = await new SignJWT({email:'admin@example.com'}).setProtectedHeader({alg:'RS256',kid:'access-test'}).setIssuer(env.CF_ACCESS_TEAM_DOMAIN).setAudience(env.CF_ACCESS_AUD).setSubject('user-id').setIssuedAt().setExpirationTime('5m').sign(other.privateKey);
 await assert.rejects(verifyAccessIdentity(forged, env, keys));
 assert.equal(await authenticate(new Request('https://app.example.com/api/state', {headers:{'cf-access-authenticated-user-email':'admin@example.com'}}), env), null);
});

test('Cloudflare identity is not approval: only designated bootstrap and active roster members qualify', async () => {
 const {sql,db} = sqliteD1();
 sql.prepare('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)').run('access-test','Access test',new Date().toISOString());
 const source = {...env,DB:db,WORKSPACE_ID:'access-test',AUTH_BOOTSTRAP_EMAIL:'admin@example.com'};
 assert.equal(await googleSessionApproved(source,'outsider@example.com'),false);
 assert.equal(await googleSessionApproved(source,'admin@example.com'),true);
 sql.prepare('INSERT INTO state_documents(workspace_id,key,body,version,updated_at,updated_by) VALUES(?,?,?,?,?,?)').run('access-test','ontology.workspace.v3',JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'},{id:'member',email:'member@example.com',access:'leitor'}],deactivatedIds:['member']}),1,new Date().toISOString(),'test');
 const fresh = () => ({...source,DB:{...db}});
 assert.equal(await googleSessionApproved(fresh(),'admin@example.com'),true);
 assert.equal(await googleSessionApproved(fresh(),'outsider@example.com'),false);
 assert.equal(await googleSessionApproved(fresh(),'member@example.com'),false);
});

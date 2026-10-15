import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseConfig,databaseName,deploy} from '../scripts/deploy.mjs';

test('deploy config parser preserves string URLs and punctuation while accepting JSONC',()=>{
 const result=parseConfig('{ // comment\n "url":"https://app.test/a, }", /* block */ "items":[1,2,], "quote":"escaped \\\" // text", }');
 assert.equal(result.url,'https://app.test/a, }');assert.deepEqual(result.items,[1,2]);assert.equal(result.quote,'escaped " // text');
 assert.equal(databaseName({name:'my-company',d1_databases:[{binding:'DB'}]}),'my-company-db');
 assert.throws(()=>databaseName({name:'bad;name',d1_databases:[{binding:'DB'}]}));
});
function withConfig(config,fn){const old=process.cwd();const dir=mkdtempSync(join(tmpdir(),'ontology-deploy-'));try{process.chdir(dir);writeFileSync('wrangler.jsonc',JSON.stringify(config));fn();}finally{process.chdir(old);rmSync(dir,{recursive:true,force:true});}}
const uuid='12345678-1234-1234-1234-123456789abc';
test('first deployment creates D1 before migrations, and only publishes after migrations succeed',()=>{
 withConfig({name:'example',d1_databases:[{binding:'DB',migrations_dir:'migrations'}]},()=>{
  const calls=[];
  deploy((args)=>{calls.push(args);if(args.includes('list'))return '[]';if(args.includes('create'))writeFileSync('wrangler.jsonc',JSON.stringify({name:'example',d1_databases:[{binding:'DB',database_name:'example-db',database_id:uuid}]}));});
  assert.equal(calls[0][2],'list');assert.equal(calls[1][2],'create');assert.equal(calls[1][3],'example-db');assert.deepEqual(calls[2],['wrangler','d1','migrations','apply','DB','--remote']);assert.deepEqual(calls[3],['opennextjs-cloudflare','deploy']);
 });
});
test('subsequent fresh builds reuse named D1 instead of creating another database',()=>{
 withConfig({name:'example',d1_databases:[{binding:'DB'}]},()=>{
  const calls=[];deploy(args=>{calls.push(args);if(args.includes('list'))return JSON.stringify([{name:'example-db',uuid}]);});
  assert.equal(calls.some(args=>args.includes('create')),false);assert.equal(JSON.parse(readFileSync('wrangler.jsonc','utf8')).d1_databases[0].database_id,uuid);
 });
});
test('existing configured DB migrates first; migration failure stops deployment',()=>{
 withConfig({name:'example',d1_databases:[{binding:'DB',database_id:uuid}]},()=>{
  const calls=[];assert.throws(()=>deploy(args=>{calls.push(args);throw new Error('migration failed');}),/migration failed/);assert.equal(calls.length,1);assert.equal(calls[0][2],'migrations');
 });
});

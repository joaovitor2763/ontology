import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const root=new URL('../',import.meta.url);
test('official deploy migrates D1 before publishing the Worker',async()=>{
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 assert.equal(pkg.scripts.deploy,'npm run deploy:production');
 assert.equal(pkg.scripts['deploy:production'],'opennextjs-cloudflare build && node scripts/deploy.mjs');
 const script=await readFile(new URL('scripts/deploy.mjs',root),'utf8');
 const migration=script.indexOf("run(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote'])");
 const publication=script.indexOf("run(['opennextjs-cloudflare', 'deploy'])");
 assert.ok(migration>=0&&publication>migration,'apply migrations before publishing code');
 assert.equal(pkg.scripts['deploy:staging'],undefined,'public template has no implicit organization staging target');
});
